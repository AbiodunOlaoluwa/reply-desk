import type { Db } from "./db";
import { defaultSettings } from "./seed";

export type Settings = {
  sendingEnabled: boolean; // the kill switch: false stops every automated and AI send
  autoSend: boolean; // false: every AI draft waits in the approval queue
  dryRun: boolean; // run every check, send nothing
  dailyCap: number; // max automated + AI messages per UTC day
  minConfidence: number; // below this, drafts wait for a person
};

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.query<{ key: string; value: unknown }>("select key, value from settings");
  const s = { ...defaultSettings } as Record<string, unknown>;
  for (const r of rows) s[r.key] = typeof r.value === "string" ? JSON.parse(r.value) : r.value;
  return s as Settings;
}

const KEYS: (keyof Settings)[] = ["sendingEnabled", "autoSend", "dryRun", "dailyCap", "minConfidence"];

export async function updateSettings(db: Db, patch: Partial<Settings>) {
  for (const key of KEYS) {
    if (patch[key] === undefined) continue;
    const value = patch[key];
    if (key === "dailyCap" && !(Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1000)) continue;
    if (key === "minConfidence" && !(typeof value === "number" && value >= 0 && value <= 1)) continue;
    if (["sendingEnabled", "autoSend", "dryRun"].includes(key) && typeof value !== "boolean") continue;
    await db.query("insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value", [
      key,
      JSON.stringify(value),
    ]);
  }
  return getSettings(db);
}
