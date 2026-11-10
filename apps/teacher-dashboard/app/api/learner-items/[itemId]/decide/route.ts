import { handleDecision } from "@/lib/decide-route";

// A decision is never cached and always runs on the server, where STUDIUM_REVIEW_TOKEN lives.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { itemId: string } }): Promise<Response> {
  return handleDecision(request, params.itemId);
}
