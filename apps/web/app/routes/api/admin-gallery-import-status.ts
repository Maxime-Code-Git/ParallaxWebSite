import type { LoaderFunctionArgs } from "react-router";
import {
  requireValidAdminSession,
  createAdminHeaders,
} from "../../lib/admin-auth.server";
import { getImportJobStatus, parseImportRejections } from "../../lib/gallery-import.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireValidAdminSession(request);

  const importId = params.importId;
  if (!importId) {
    return Response.json({ error: "Identifiant manquant." }, { status: 400, headers: createAdminHeaders() });
  }

  const job = getImportJobStatus(importId);
  if (!job || job.gallery_id !== params.id) {
    return Response.json({ error: "Tâche introuvable." }, { status: 404, headers: createAdminHeaders() });
  }

  return Response.json(
    {
      id: job.id,
      galleryId: job.gallery_id,
      status: job.status,
      progress_total: job.progress_total,
      progress_current: job.progress_current,
      scanned_photos: job.scanned_photos,
      scanned_videos: job.scanned_videos,
      rejected_files_count: job.rejected_files,
      rejected_files: parseImportRejections(job.rejection_report),
      error_message: job.error_message,
    },
    { headers: createAdminHeaders() }
  );
}
