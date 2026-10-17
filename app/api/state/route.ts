import { getDb } from "@/lib/db";
import { getModel } from "@/lib/model";
import { getState } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const contact = new URL(req.url).searchParams.get("contact") ?? undefined;
  const state = await getState(await getDb(), contact);
  return Response.json({ ...state, model: getModel().name });
}
