import { redirect } from "react-router";

export async function loader() {
  return redirect("/fr", 302);
}

export default function RootRedirect() {
  return null;
}
