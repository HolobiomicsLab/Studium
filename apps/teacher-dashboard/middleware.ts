import { NextResponse, type NextRequest } from "next/server";
import { gate } from "@/lib/gate";

/** Teacher sign-in gate (lib/gate.ts). Runs in the Edge runtime; lib/session.ts uses Web Crypto only. */
export async function middleware(request: NextRequest): Promise<Response> {
  return (await gate(request)) ?? NextResponse.next();
}

export const config = {
  // Next's build output and the favicon never reach the gate; lib/gate.ts exempts them as well.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
