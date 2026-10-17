import { z } from "zod";
import { getDb } from "@/lib/db";
import { handBack, operatorSend, takeOver } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(["takeover", "handback", "send"]), text: z.string().max(1000).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  const db = await getDb();
  const { action, text } = parsed.data;
  if (action === "takeover") await takeOver(db, id);
  if (action === "handback") await handBack(db, id);
  if (action === "send") return Response.json(await operatorSend(db, id, text ?? ""));
  return Response.json({ ok: true });
}
