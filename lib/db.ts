// One small interface over Postgres. Production uses DATABASE_URL (any Postgres, e.g. Neon);
// local dev and tests use PGlite, an in-process Postgres, so the demo runs with zero setup.
import { mkdirSync } from "node:fs";
import { Pool } from "pg";
import { SCHEMA } from "./schema";
import { seed } from "./seed";

export type Row = Record<string, unknown>;

export interface Db {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

async function fromPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  return {
    query: async <T,>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows,
    exec: async (sql: string) => {
      await pg.exec(sql);
    },
  };
}

function fromPool(connectionString: string): Db {
  const pool = new Pool({ connectionString, max: 3 });
  return {
    query: async <T,>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[],
    exec: async (sql: string) => {
      await pool.query(sql);
    },
  };
}

export async function prepare(db: Db): Promise<Db> {
  await db.exec(SCHEMA);
  const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from contacts");
  if (n === 0) await seed(db);
  return db;
}

// Fresh in-memory database, used by the tests.
export async function createMemoryDb(): Promise<Db> {
  return prepare(await fromPglite());
}

// Reused across hot reloads in dev and across requests in one server process.
const g = globalThis as unknown as { __replyDeskDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!g.__replyDeskDb) {
    const url = process.env.DATABASE_URL;
    g.__replyDeskDb = (url ? Promise.resolve(fromPool(url)) : fromPglite(process.env.PGLITE_DIR ?? ".data/pglite")).then(prepare);
    // A failed start shouldn't be cached for the life of the process.
    g.__replyDeskDb.catch(() => {
      g.__replyDeskDb = undefined;
    });
  }
  return g.__replyDeskDb;
}
