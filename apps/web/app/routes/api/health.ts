import type { LoaderFunctionArgs } from "react-router";

export async function loader(_args?: LoaderFunctionArgs) {
  return Response.json(
    { status: "ok", timestamp: new Date().toISOString() },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Content-Type": "application/json",
      },
    }
  );
}
