import type { Db } from "./db";
import { business } from "./facts";

// Fictional prospects. Phone numbers use the reserved 555-01xx range.
export const contactsSeed = [
  { id: "kemi", name: "Kemi Adebayo", company: "Brightpath Studio", phone: "+15550100101" },
  { id: "tom", name: "Tom Reilly", company: "Northgate Design", phone: "+15550100102" },
  { id: "funmi", name: "Funmi Adeyemi", company: "Palmview Interiors", phone: "+15550100103" },
];

export function openerFor(firstName: string) {
  return `Good afternoon, ${firstName}. I'm ${business.operator} from ${business.name}. ${business.name} is ${business.what}: ${business.link}\n\nDo you keep your books in spreadsheets at the moment?\n\nTo opt out, reply stop and I won't message again.`;
}

export const defaultSettings: Record<string, unknown> = {
  sendingEnabled: true,
  autoSend: true,
  dryRun: false,
  dailyCap: 50,
  minConfidence: 0.6,
};

export async function seed(db: Db) {
  for (const c of contactsSeed) {
    await db.query("insert into contacts (id, name, company, phone) values ($1, $2, $3, $4) on conflict do nothing", [
      c.id,
      c.name,
      c.company,
      c.phone,
    ]);
    await db.query(
      "insert into messages (contact_id, direction, actor, body, dedupe_key) values ($1, 'out', 'automation', $2, $3) on conflict do nothing",
      [c.id, openerFor(c.name.split(" ")[0]), `opener:${c.id}`],
    );
  }
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db.query("insert into settings (key, value) values ($1, $2) on conflict do nothing", [key, JSON.stringify(value)]);
  }
}

export async function resetDemo(db: Db) {
  await db.exec("delete from events; delete from decisions; delete from messages; delete from contacts; delete from settings;");
  await seed(db);
}
