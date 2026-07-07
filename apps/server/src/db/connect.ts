import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { Database } from "./schema.ts";

export function createDb(connectionString = process.env.DATABASE_URL): Kysely<Database> {
  if (!connectionString) throw new Error("DATABASE_URL is required (see .env.example)");
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  });
}

/** For tests: wrap an existing pg-compatible Pool (e.g. pg-mem). */
export function createDbFromPool(pool: pg.Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
