import { existsSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, relative } from "node:path";

const root = process.cwd();
const pieceRoot = join(root, "apps/web/src/assets/table/pieces");
const factionBudget = 700 * 1024;
const rows = readdirSync(pieceRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const path = join(pieceRoot, entry.name, "atlas.webp");
    const bytes = statSync(path).size;
    return { bundle: `faction-${entry.name}`, bytes, budget: factionBudget, pass: bytes <= factionBudget };
  });

const boardPath = join(root, "packages/map/assets/board.svg");
rows.push({ bundle: "table-core-board-source", bytes: statSync(boardPath).size, budget: 3 * 1024 * 1024, pass: statSync(boardPath).size <= 3 * 1024 * 1024 });

const dist = join(root, "apps/web/dist/assets");
if (existsSync(dist)) {
  const runtime = readdirSync(dist).find((name) => name.startsWith("PixiTableSceneAdapter-") && name.endsWith(".js"));
  if (runtime) {
    const bytes = gzipSync(await import("node:fs").then((fs) => fs.readFileSync(join(dist, runtime)))).byteLength;
    rows.push({ bundle: "table-runtime-js-gzip", bytes, budget: 650 * 1024, pass: bytes <= 650 * 1024 });
  }
}

for (const row of rows) console.log(`${row.pass ? "PASS" : "FAIL"} ${row.bundle.padEnd(38)} ${(row.bytes / 1024).toFixed(1).padStart(8)} KB / ${(row.budget / 1024).toFixed(0)} KB`);
if (rows.some((row) => !row.pass)) process.exitCode = 1;

