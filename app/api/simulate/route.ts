// The demo's "prospect phone": builds a provider delivery and sends it through the real webhook path.
import { z } from "zod";
import { getDb } from "@/lib/db";
import { deliver, deliverForged, redeliver } from "@/lib/provider";
import { allow, clientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  contactId: z.string().max(40),
  action: z.enum(["send", "redeliver", "forge"]),
  text: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  if (!allow(clientKey(req))) return Response.json({ error: "Slow down a little: 30 messages a minute." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  const { contactId, action, text } = parsed.data;
  const db = await getDb();
  const [contact] = await db.query<{ id: string; phone: string }>("select id, phone from contacts where id = $1", [contactId]);
  if (!contact) return Response.json({ error: "unknown contact" }, { status: 404 });

  if (action === "redeliver") return Response.json((await redeliver(db, contactId)).body);
  const message = (text ?? "").trim();
  if (!message) return Response.json({ error: "empty message" }, { status: 400 });
  const result = action === "forge" ? await deliverForged(db, contact, message) : await deliver(db, contact, message);
  return Response.json(result.body, { status: result.status === 401 ? 200 : result.status });
}
