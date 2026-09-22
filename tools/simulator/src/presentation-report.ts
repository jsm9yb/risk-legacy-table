import { existsSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

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

const architecturePath = join(root, "apps/web/src/assets/table/architecture/atlas.webp");
const architectureManifestPath = join(root, "apps/web/src/assets/table/architecture/atlas.json");
const architectureManifest = JSON.parse((await import("node:fs")).readFileSync(architectureManifestPath, "utf8")) as {
  meta: { width: number; height: number; frameCount: number };
  frames: Record<string, { x: number; y: number; width: number; height: number }>;
};
const architectureFrames = Object.values(architectureManifest.frames);
const architectureContractPass = architectureManifest.meta.frameCount === 35
  && architectureFrames.length === 35
  && architectureFrames.every((frame) => frame.width === 128 && frame.height === 128
    && frame.x >= 0 && frame.y >= 0
    && frame.x + frame.width <= architectureManifest.meta.width
    && frame.y + frame.height <= architectureManifest.meta.height);
rows.push({ bundle: "table-architecture-atlas", bytes: statSync(architecturePath).size, budget: Math.round(1.2 * 1024 * 1024), pass: statSync(architecturePath).size <= 1.2 * 1024 * 1024 });
rows.push({ bundle: "architecture-frame-contract", bytes: architectureFrames.length * 1024, budget: 35 * 1024, pass: architectureContractPass });

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
