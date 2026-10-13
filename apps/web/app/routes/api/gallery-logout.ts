import { redirect, type ActionFunctionArgs } from "react-router";
import {
  getGallerySession,
  destroyGallerySession,
  GALLERY_PRIVATE_HEADERS,
} from "../../lib/gallery-auth.server";
import { validateOrigin } from "../../lib/security.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...GALLERY_PRIVATE_HEADERS, Allow: "POST" },
    });
  }

  if (!validateOrigin(request)) {
    return new Response("Forbidden", {
      status: 403,
      headers: GALLERY_PRIVATE_HEADERS,
    });
  }

  const session = await getGallerySession(request);
  const cookie = await destroyGallerySession(session);

  const referer = request.headers.get("Referer") || "";
  const isEn = referer.includes("/en/") || request.url.includes("/en");
  const target = isEn ? "/en/client-area" : "/fr/espace-client";

  return redirect(target, {
    status: 303,
    headers: {
      ...GALLERY_PRIVATE_HEADERS,
      "Set-Cookie": cookie,
    },
  });
}
