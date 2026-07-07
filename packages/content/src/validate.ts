import { validateContentPack, contentPack } from "./index.ts";
const { errors, warnings } = validateContentPack();
console.log(`Content pack ${contentPack.packId} v${contentPack.version}`);
for (const w of warnings) console.warn(`WARN  ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);
if (errors.length) process.exit(1);
console.log(`OK: 42 territory cards, 10 coin cards, ${contentPack.factions.length} factions, ${warnings.length} warnings (host acknowledgement required to start a campaign with warnings).`);
