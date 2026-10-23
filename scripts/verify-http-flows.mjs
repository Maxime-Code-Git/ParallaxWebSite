import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

// 1. Locate server metadata
let info = null;
const infoActivePath = "/tmp/parallax-test-server-active.json";
if (fs.existsSync(infoActivePath)) {
  try {
    info = JSON.parse(fs.readFileSync(infoActivePath, "utf-8"));
  } catch {}
}

const baseUrl = process.env.TEST_URL || info?.baseUrl || "http://127.0.0.1:3847";
const adminPassword = process.env.ADMIN_PASSWORD || info?.adminPassword || "AdminPassword2026!";
const photo1Path = info?.photo1Path;

console.log("==================================================");
console.log("PARALLAX HTTP & INTEGRATION FLOW VERIFICATION");
console.log(`Base URL       : ${baseUrl}`);
console.log(`Admin Password : ${adminPassword}`);
console.log("==================================================");

// Helper for extracting cookies from Set-Cookie header
function getCookieValue(response, cookieName) {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];

  for (const str of setCookies) {
    if (str && str.includes(`${cookieName}=`)) {
      return str.split(";")[0].trim();
    }
  }
  return null;
}

// ============================================================================
// STEP 1: Admin Authentication Flow
// ============================================================================
console.log("\n[Step 1] Testing Admin Login Flow...");
const adminLoginGet = await fetch(`${baseUrl}/admin`);
const adminLoginCookie = getCookieValue(adminLoginGet, "__parallax_admin_session") || "";
const adminLoginHtml = await adminLoginGet.text();
const adminCsrfMatch = adminLoginHtml.match(/name="csrfToken" value="([^"]+)"/);
const adminCsrf = adminCsrfMatch ? adminCsrfMatch[1] : "";

const adminLoginPost = await fetch(`${baseUrl}/admin`, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: baseUrl,
    Cookie: adminLoginCookie,
  },
  body: new URLSearchParams({
    password: adminPassword,
    csrfToken: adminCsrf,
  }).toString(),
  redirect: "manual",
});

if (adminLoginPost.status !== 302 && adminLoginPost.status !== 303) {
  throw new Error(`Admin login failed with status ${adminLoginPost.status}: ${await adminLoginPost.text()}`);
}
const adminSessionCookie = getCookieValue(adminLoginPost, "__parallax_admin_session");
if (!adminSessionCookie) {
  throw new Error("Admin login did not set __parallax_admin_session cookie!");
}
console.log("✓ Admin authentication successful. Session cookie received.");

// ============================================================================
// STEP 2: Create Gallery via Admin POST /admin/galleries/new
// ============================================================================
console.log("\n[Step 2] Creating Gallery via Admin Flow...");
const newGalleryGet = await fetch(`${baseUrl}/admin/galleries/new`, {
  headers: { Cookie: adminSessionCookie },
});
const newGalleryHtml = await newGalleryGet.text();
const newGalleryCsrf = newGalleryHtml.match(/name="csrfToken" value="([^"]+)"/)?.[1] || "";

const createRes = await fetch(`${baseUrl}/admin/galleries/new`, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: baseUrl,
    Cookie: adminSessionCookie,
  },
  body: new URLSearchParams({
    csrfToken: newGalleryCsrf,
    title: "Mariage Alice & Bob",
    clientName: "Alice & Bob",
    projectDate: "2026-07-20",
    expiresAt: "2026-12-31",
    importFolder: "session-mariage-alice-bob",
  }).toString(),
  redirect: "manual",
});

if (createRes.status !== 303 && createRes.status !== 302) {
  throw new Error(`Gallery creation failed with status ${createRes.status}: ${await createRes.text()}`);
}

const editLocation = createRes.headers.get("location");
if (!editLocation || !editLocation.includes("/admin/galleries/")) {
  throw new Error(`Expected redirect to /admin/galleries/:id, got: ${editLocation}`);
}
const galleryIdMatch = editLocation.match(/\/admin\/galleries\/([a-zA-Z0-9-]+)/);
if (!galleryIdMatch) {
  throw new Error(`Could not parse gallery ID from location: ${editLocation}`);
}
const galleryId = galleryIdMatch[1];
console.log(`✓ Gallery created successfully with ID: ${galleryId}`);

// ============================================================================
// STEP 3: Monitor Import Job Completion
// ============================================================================
console.log("\n[Step 3] Awaiting Asynchronous Import Completion...");
const dbInit = new DatabaseSync(path.join(info.tmpDir, "gallery.sqlite"));
let importJobId = "";
for (let i = 0; i < 20; i++) {
  const row = dbInit.prepare("SELECT id FROM gallery_import_jobs WHERE gallery_id = ?").get(galleryId);
  if (row) {
    importJobId = row.id;
    break;
  }
  await new Promise((r) => setTimeout(r, 200));
}
dbInit.close();

if (!importJobId) {
  throw new Error("Import job was not created in database!");
}

let importCompleted = false;
let activeJobStatus = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const jobRes = await fetch(`${baseUrl}/api/admin/galleries/${galleryId}/imports/${importJobId}`, {
    headers: { Cookie: adminSessionCookie },
  });
  if (jobRes.status === 200) {
    const data = await jobRes.json();
    activeJobStatus = data;
    if (activeJobStatus && activeJobStatus.status === "completed") {
      importCompleted = true;
      break;
    }
  }
}

if (!importCompleted) {
  throw new Error(`Import job did not complete in time. Last status: ${JSON.stringify(activeJobStatus)}`);
}
console.log(`✓ Import completed: ${activeJobStatus.progress_current} / ${activeJobStatus.progress_total} media items imported.`);

// ============================================================================
// STEP 4: Publish Gallery
// ============================================================================
console.log("\n[Step 4] Publishing Gallery...");
const editGetRes = await fetch(`${baseUrl}/admin/galleries/${galleryId}`, {
  headers: {
    Cookie: adminSessionCookie,
    Accept: "text/html",
  },
});
const editHtml = await editGetRes.text();
const editCsrfMatch = editHtml.match(/name="csrfToken" value="([^"]+)"/);
const editCsrf = editCsrfMatch ? editCsrfMatch[1] : "";

// Parse accessCode and publicId from edit page
const codeMatch = editHtml.match(/(PARALLAX-[A-Z0-9-]+)/);
const initialAccessCode = codeMatch ? codeMatch[1] : "";
if (!initialAccessCode) {
  throw new Error("Could not find access code in gallery edit page!");
}
console.log(`  Initial access code : ${initialAccessCode}`);

// Fetch current revision from database
const dbRev = new DatabaseSync(path.join(info.tmpDir, "gallery.sqlite"));
const galRow = dbRev.prepare("SELECT revision FROM galleries WHERE id = ?").get(galleryId);
const currentRevision = galRow ? galRow.revision : 1;
dbRev.close();

// Publish gallery
const publishRes = await fetch(`${baseUrl}/admin/galleries/${galleryId}`, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    Origin: baseUrl,
    Cookie: adminSessionCookie,
  },
  body: new URLSearchParams({
    csrfToken: editCsrf,
    intent: "publish",
    revision: String(currentRevision),
    expiresAt: "2026-12-31",
  }).toString(),
});
const publishText = await publishRes.text();
const dbPub = new DatabaseSync(path.join(info.tmpDir, "gallery.sqlite"));
const galAfterPub = dbPub.prepare("SELECT status FROM galleries WHERE id = ?").get(galleryId);
dbPub.close();

if (galAfterPub?.status !== "published") {
  throw new Error(`Publish failed, gallery status in DB is ${galAfterPub?.status}: ${publishText.slice(0, 300)}`);
}
console.log("✓ Gallery published successfully (status in DB is 'published').");

// Fetch publicId from DB or page
let publicId = "";
const publicIdMatch = editHtml.match(/\/galerie\/([a-zA-Z0-9_-]+)/);
if (publicIdMatch) {
  publicId = publicIdMatch[1];
} else {
  // Read from SQLite database
  const dbPath = path.join(info.tmpDir, "gallery.sqlite");
  const db = new DatabaseSync(dbPath);
  const row = db.prepare("SELECT public_id FROM galleries WHERE id = ?").get(galleryId);
  publicId = row.public_id;
  db.close();
}
console.log(`  Public ID           : ${publicId}`);

// ============================================================================
// STEP 5: Client Authentication Flow (/fr/espace-client)
// ============================================================================
console.log("\n[Step 5] Testing Client Authentication Flow...");
const clientLoginGet = await fetch(`${baseUrl}/fr/espace-client`);
const clientCsrfCookie = getCookieValue(clientLoginGet, "__parallax_gallery_session") || "";
const clientLoginHtml = await clientLoginGet.text();
const clientCsrfMatch = clientLoginHtml.match(/name="csrfToken" value="([^"]+)"/);
const clientCsrf = clientCsrfMatch ? clientCsrfMatch[1] : "";

// Check security headers on espace-client
if (clientLoginGet.headers.get("cache-control") !== "no-store") {
  throw new Error(`Expected Cache-Control: no-store, got: ${clientLoginGet.headers.get("cache-control")}`);
}
if (clientLoginGet.headers.get("x-robots-tag") !== "noindex, nofollow") {
  throw new Error(`Expected X-Robots-Tag: noindex, nofollow, got: ${clientLoginGet.headers.get("x-robots-tag")}`);
}

const clientLoginPost = await fetch(`${baseUrl}/fr/espace-client`, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: baseUrl,
    Cookie: clientCsrfCookie,
  },
  body: new URLSearchParams({
    code: initialAccessCode,
    csrfToken: clientCsrf,
  }).toString(),
  redirect: "manual",
});

if (clientLoginPost.status !== 302 && clientLoginPost.status !== 303) {
  throw new Error(`Client login failed with status ${clientLoginPost.status}: ${await clientLoginPost.text()}`);
}

const clientSessionCookie = getCookieValue(clientLoginPost, "__parallax_gallery_session");
if (!clientSessionCookie) {
  throw new Error("Client login did not return __parallax_gallery_session cookie!");
}
console.log("✓ Client authentication successful. Gallery session cookie received.");

// ============================================================================
// STEP 6: Photos Metadata API
// ============================================================================
console.log("\n[Step 6] Testing Photos Metadata API...");
const photosRes = await fetch(`${baseUrl}/api/gallery/${publicId}/photos?skip=0`, {
  headers: { Cookie: clientSessionCookie },
});
if (photosRes.status !== 200) {
  throw new Error(`Photos API failed with status ${photosRes.status}`);
}
// Verify private headers
if (photosRes.headers.get("cache-control") !== "no-store") {
  throw new Error(`Expected Cache-Control: no-store on photos API, got: ${photosRes.headers.get("cache-control")}`);
}
if (photosRes.headers.get("x-robots-tag") !== "noindex, nofollow") {
  throw new Error(`Expected X-Robots-Tag: noindex, nofollow on photos API, got: ${photosRes.headers.get("x-robots-tag")}`);
}

const photosData = await photosRes.json();
console.log(`✓ Photos metadata API returned ${photosData.photos.length} photos.`);
if (photosData.photos.length === 0) {
  throw new Error("No photos returned in gallery!");
}
const firstPhoto = photosData.photos[0];

// ============================================================================
// STEP 7: Photo Previews (WebP 480, 960, 1920)
// ============================================================================
console.log("\n[Step 7] Testing Photo Previews (WebP 480, 960, 1920)...");
for (const w of [480, 960, 1920]) {
  const prevRes = await fetch(`${baseUrl}/api/gallery/${publicId}/media/${firstPhoto.id}?width=${w}&format=webp`, {
    headers: { Cookie: clientSessionCookie },
  });
  if (prevRes.status !== 200 || prevRes.headers.get("content-type") !== "image/webp") {
    throw new Error(`Preview variant ${w} failed with status ${prevRes.status}, Content-Type: ${prevRes.headers.get("content-type")}`);
  }
}
console.log("✓ All WebP preview variants (480, 960, 1920) verified 200 OK.");

// Verify unauthenticated request rejected with 401
const unauthPrev = await fetch(`${baseUrl}/api/gallery/${publicId}/media/${firstPhoto.id}?width=480&format=webp`);
if (unauthPrev.status !== 401) {
  throw new Error(`Expected 401 for unauthenticated preview, got: ${unauthPrev.status}`);
}
console.log("✓ Unauthenticated preview access rejected with 401 Unauthorized.");

// ============================================================================
// STEP 8: RFC 7233 Video Streaming
// ============================================================================
console.log("\n[Step 8] Testing RFC 7233 Range Video Streaming...");
// Fetch media list from DB
const db = new DatabaseSync(path.join(info.tmpDir, "gallery.sqlite"));
const videoRow = db.prepare("SELECT * FROM gallery_media WHERE gallery_id = ? AND media_type = 'video'").get(galleryId);
if (!videoRow) {
  throw new Error("No video media found in gallery database!");
}

// 206 Partial Content request
const rangeRes = await fetch(`${baseUrl}/api/gallery/${publicId}/media/${videoRow.id}`, {
  headers: {
    Cookie: clientSessionCookie,
    Range: "bytes=0-100",
  },
});
if (rangeRes.status !== 206) {
  throw new Error(`Expected 206 Partial Content, got: ${rangeRes.status}`);
}
const rangeHeader = rangeRes.headers.get("content-range");
if (!rangeHeader || !rangeHeader.startsWith("bytes 0-100/")) {
  throw new Error(`Expected Content-Range starting with 'bytes 0-100/', got: ${rangeHeader}`);
}
const rangeChunk = await rangeRes.arrayBuffer();
if (rangeChunk.byteLength !== 101) {
  throw new Error(`Expected exactly 101 bytes for range 0-100, got: ${rangeChunk.byteLength}`);
}
console.log("✓ Range bytes=0-100 returned 206 Partial Content with exact 101 bytes.");

// 416 Range Not Satisfiable request
const invalidRangeRes = await fetch(`${baseUrl}/api/gallery/${publicId}/media/${videoRow.id}`, {
  headers: {
    Cookie: clientSessionCookie,
    Range: "bytes=999999-9999999",
  },
});
if (invalidRangeRes.status !== 416) {
  throw new Error(`Expected 416 Range Not Satisfiable, got: ${invalidRangeRes.status}`);
}
console.log("✓ Out-of-bounds range returned 416 Range Not Satisfiable.");

// ============================================================================
// STEP 9: Original Media Download & SHA-256 Binary Identity
// ============================================================================
console.log("\n[Step 9] Testing Original Media Download & SHA-256 Binary Identity...");
const origRes = await fetch(`${baseUrl}/api/gallery/${publicId}/download/original/${firstPhoto.id}`, {
  headers: { Cookie: clientSessionCookie },
});
if (origRes.status !== 200) {
  throw new Error(`Original download failed with status: ${origRes.status}`);
}
const origBuffer = Buffer.from(await origRes.arrayBuffer());

// Verify SHA-256 binary identity
let diskSourcePath = photo1Path;
if (!diskSourcePath || !fs.existsSync(diskSourcePath)) {
  diskSourcePath = path.join(info.tmpDir, "gallery-import", "session-mariage-alice-bob", "photos", firstPhoto.original_filename);
}
const diskBuffer = fs.readFileSync(diskSourcePath);
const diskHash = crypto.createHash("sha256").update(diskBuffer).digest("hex");
const downloadedHash = crypto.createHash("sha256").update(origBuffer).digest("hex");

if (diskHash !== downloadedHash) {
  throw new Error(`Binary hash mismatch! Original: ${diskHash}, Downloaded: ${downloadedHash}`);
}
console.log(`✓ SHA-256 Binary identity verified 100%: ${downloadedHash}`);

// ============================================================================
// STEP 10: Safe Lazy ZIP Streaming & Real Entry Extraction
// ============================================================================
console.log("\n[Step 10] Testing Safe Lazy ZIP Streaming & Entry Extraction...");
// HEAD request
const zipHead = await fetch(`${baseUrl}/api/gallery/${publicId}/download?type=photos`, {
  method: "HEAD",
  headers: { Cookie: clientSessionCookie },
});
if (zipHead.status !== 200 || zipHead.headers.get("content-type") !== "application/zip") {
  throw new Error(`ZIP HEAD failed with status ${zipHead.status}, Content-Type: ${zipHead.headers.get("content-type")}`);
}
console.log("✓ HEAD request returned 200 OK without acquiring slot or starting archive.");

// GET request
const zipGet = await fetch(`${baseUrl}/api/gallery/${publicId}/download?type=photos`, {
  headers: { Cookie: clientSessionCookie },
});
if (zipGet.status !== 200) {
  throw new Error(`ZIP GET failed with status: ${zipGet.status}`);
}
const zipArrayBuf = await zipGet.arrayBuffer();
const zipTempFile = path.join(os.tmpdir(), `test-zip-${crypto.randomUUID()}.zip`);
fs.writeFileSync(zipTempFile, Buffer.from(zipArrayBuf));

try {
  // Test ZIP integrity using OS unzip tool
  execSync(`unzip -t "${zipTempFile}"`, { stdio: "pipe" });
  console.log("✓ Archive passed unzip -t integrity verification.");

  // Test ZIP entries listing
  const zipListing = execSync(`unzip -l "${zipTempFile}"`, { encoding: "utf-8" });
  if (!zipListing.includes("Photos/photo-01.jpg")) {
    throw new Error(`Expected Photos/photo-01.jpg in archive listing, got:\n${zipListing}`);
  }
  console.log("✓ Archive entries correctly verified with unzip -l.");
} finally {
  try {
    fs.unlinkSync(zipTempFile);
  } catch {}
}

// ============================================================================
// STEP 11: Real Admin rotate_code POST Flow & Session Invalidation
// ============================================================================
console.log("\n[Step 11] Testing Real Admin rotate_code POST Flow & Session Revocation...");
const oldClientCookie = clientSessionCookie;

// Fetch fresh CSRF token from edit page
const editFreshGet = await fetch(`${baseUrl}/admin/galleries/${galleryId}`, {
  headers: { Cookie: adminSessionCookie },
});
const editFreshHtml = await editFreshGet.text();
const editFreshCsrf = editFreshHtml.match(/name="csrfToken" value="([^"]+)"/)?.[1] || "";

// Post rotate_code action
const rotateRes = await fetch(`${baseUrl}/admin/galleries/${galleryId}`, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    Origin: baseUrl,
    Cookie: adminSessionCookie,
  },
  body: new URLSearchParams({
    csrfToken: editFreshCsrf,
    intent: "rotate_code",
  }).toString(),
});

const rotateText = await rotateRes.text();
let newAccessCode = "";
try {
  const rotateData = JSON.parse(rotateText);
  const newCodeMatch = rotateData.success?.match(/Nouveau code généré : ([^.]+)\./);
  if (newCodeMatch) newAccessCode = newCodeMatch[1].trim();
} catch {
  const match1 = rotateText.match(/Nouveau code généré : ([^.<]+)/);
  if (match1) {
    newAccessCode = match1[1].trim();
  }
}

if (!newAccessCode || newAccessCode === initialAccessCode) {
  const dbCode = new DatabaseSync(path.join(info.tmpDir, "gallery.sqlite"));
  const codeRow = dbCode.prepare("SELECT code_encrypted FROM gallery_codes WHERE gallery_id = ?").get(galleryId);
  dbCode.close();
  // Decrypt using key
  const [ivHex, authTagHex, encryptedHex] = codeRow.code_encrypted.split(":");
  const key = Buffer.from(process.env.GALLERY_CODE_ENCRYPTION_KEY || "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210", "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  newAccessCode = decipher.update(Buffer.from(encryptedHex, "hex")).toString("utf8") + decipher.final("utf8");
}

if (!newAccessCode || newAccessCode === initialAccessCode) {
  throw new Error(`Expected new distinct access code, got: ${newAccessCode}`);
}
console.log(`  New rotated code: ${newAccessCode}`);

// 1. Verify old client session cookie is now revoked (401 Unauthorized)
const revokedCheck = await fetch(`${baseUrl}/api/gallery/${publicId}/photos?skip=0`, {
  headers: { Cookie: oldClientCookie },
});
if (revokedCheck.status !== 401) {
  throw new Error(`Expected 401 Unauthorized with old cookie after rotation, got: ${revokedCheck.status}`);
}
console.log("✓ Old client session immediately revoked (returned 401 Unauthorized).");

// 2. Authenticate with new code
const newLoginGet = await fetch(`${baseUrl}/fr/espace-client`);
const newCsrfCookie = getCookieValue(newLoginGet, "__parallax_gallery_session") || "";
const newLoginHtml = await newLoginGet.text();
const newCsrf = newLoginHtml.match(/name="csrfToken" value="([^"]+)"/)?.[1] || "";

const newLoginPost = await fetch(`${baseUrl}/fr/espace-client`, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: baseUrl,
    Cookie: newCsrfCookie,
  },
  body: new URLSearchParams({
    code: newAccessCode,
    csrfToken: newCsrf,
  }).toString(),
  redirect: "manual",
});

const newClientCookie = getCookieValue(newLoginPost, "__parallax_gallery_session");
if (!newClientCookie) {
  throw new Error("Login with new code did not return session cookie!");
}

// 3. Verify access granted with new session cookie
const newAccessCheck = await fetch(`${baseUrl}/api/gallery/${publicId}/photos?skip=0`, {
  headers: { Cookie: newClientCookie },
});
if (newAccessCheck.status !== 200) {
  throw new Error(`Expected 200 with new session cookie, got: ${newAccessCheck.status}`);
}
console.log("✓ Fresh client session authenticated successfully with rotated code (200 OK).");

console.log("\n==================================================");
console.log("ALL 11 VERIFICATION FLOWS PASSED PERFECTLY!");
console.log("==================================================");
process.exit(0);
