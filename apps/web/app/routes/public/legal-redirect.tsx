import { redirect, type LoaderFunctionArgs } from "react-router";
import { normalizeLegalPathname } from "./legal-page";

export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const path = normalizeLegalPathname(url.pathname);

  let target = "/fr";
  if (path === "/en/mentions-legales") {
    target = "/en/legal-notice";
  } else if (path === "/en/confidentialite") {
    target = "/en/privacy-policy";
  } else if (path === "/en/cgv") {
    target = "/en/terms";
  } else if (path === "/fr/politique-de-confidentialite") {
    target = "/fr/confidentialite";
  }

  return redirect(target, {
    status: 301,
    headers: {
      "Cache-Control": "public, max-age=86400",
    },
  });
}
