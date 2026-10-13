import { redirect } from "react-router";
import * as crypto from "node:crypto";
import { isLocalPreviewMode } from "../lib/env.server";
import { computeCredentialVersion, getAdminConfig } from "../lib/auth.server";
import { getSession, commitSession, SESSION_MAX_AGE_SECONDS } from "../lib/session.server";

export async function loader() {
  if (!isLocalPreviewMode()) {
    throw new Response("Not Found", { status: 404 });
  }

  // Ensure admin configuration is valid before authenticating
  getAdminConfig();

  const session = await getSession();
  session.set("adminId", "admin");
  session.set("credentialVersion", computeCredentialVersion());
  session.set("createdAt", Date.now());
  session.set("expiresAt", Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  session.set("csrfToken", crypto.randomBytes(32).toString("hex"));

  const cookieHeader = await commitSession(session);

  return redirect("/admin/dashboard", {
    status: 303,
    headers: {
      "Set-Cookie": cookieHeader,
    },
  });
}
