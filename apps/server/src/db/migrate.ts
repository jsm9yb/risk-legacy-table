import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../../migrations");

export async function runMigrations(pool: pg.Pool) {
  await pool.query("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  const applied = new Set((await pool.query("SELECT name FROM _migrations")).rows.map((r: any) => r.name));
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    await pool.query(sql);
    await pool.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    console.log(`applied ${file}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  runMigrations(pool).then(() => { console.log("migrations complete"); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
