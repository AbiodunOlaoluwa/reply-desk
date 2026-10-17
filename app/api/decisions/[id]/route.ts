import { z } from "zod";
import { getDb } from "@/lib/db";
import { approveDecision, discardDecision } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(["approve", "discard"]), text: z.string().max(1000).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!Number.isInteger(id) || !parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  const db = await getDb();
  const result = parsed.data.action === "approve" ? await approveDecision(db, id, parsed.data.text) : await discardDecision(db, id);
  return Response.json(result);
}
