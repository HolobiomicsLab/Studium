import { handleSignIn, handleSignOut } from "@/lib/session-route";

// Signing in and out always runs on the server, where STUDIUM_DASHBOARD_ACCESS_CODE lives.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleSignIn(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleSignOut(request);
}
