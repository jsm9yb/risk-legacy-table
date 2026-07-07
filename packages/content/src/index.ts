import { z } from "zod";
import packJson from "../data/pack.risk-legacy-private-v1.json" with { type: "json" };
import { manifest } from "@risk/map";

export const HandlerId = z.enum([
  "modifyCombatDie", "alterRecruitment", "extraManeuver", "legalStartOverride", "onConquer", "onEndTurn",
]);
export const TriggerHook = z.enum([
  "AfterScarPlaced", "AfterFactionEliminated", "AfterSideboardRefill", "EndGameRewardsCommitted", "AfterSignatureAdded",
]);
const Verified = z.object({ verification: z.enum(["confirmed", "pending"]) });

export const ContentPackSchema = z.object({
  packId: z.string(),
  version: z.number().int(),
  seededAt: z.string(),
  notes: z.string(),
  factions: z.array(z.object({
    id: z.string(), name: z.string(), color: z.string(),
    startingPowers: z.array(z.string()).length(2),
  })).length(5),
  powers: z.array(z.object({ id: z.string(), name: z.string(), handler: HandlerId, text: z.string() }).merge(Verified).passthrough()), // new (9): passthrough keeps per-power effect data
  scars: z.array(z.object({
    id: z.string(), name: z.string(), target: z.enum(["territory", "faction"]),
    handler: HandlerId, durability: z.number().int().positive().optional(),
  }).merge(Verified).passthrough()),
  cards: z.object({
    territoryCards: z.array(z.object({
      id: z.string(), kind: z.literal("territory"), territoryId: z.string(), resources: z.number().int().min(1),
    })).length(42),
    coinCards: z.array(z.object({
      id: z.string(), kind: z.literal("coin"), resources: z.number().int().min(1),
    })).length(10),
  }),
  troopPayoutTable: z.record(z.string(), z.number().int().positive()),
  cityPopulations: z.object({ none: z.literal(0), minor: z.number(), major: z.number(), world_capital: z.number() }),
  ruleConstants: z.record(z.string(), z.object({ value: z.any(), verification: z.enum(["confirmed", "pending"]) }).passthrough()),
  unlockModules: z.array(z.object({
    id: z.string(), name: z.string(), trigger: z.string(),
    implementationStatus: z.enum(["content_seeded", "rules_text_seeded", "handlers_complete", "playable"]),
    locked: z.boolean(),
  }).passthrough()),
});
export type ContentPack = z.infer<typeof ContentPackSchema>;

export const contentPack: ContentPack = ContentPackSchema.parse(packJson);

/** Cross-validate pack against map manifest + invariants (Slice 3 acceptance checks). */
export function validateContentPack(pack: ContentPack = contentPack): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tids = new Set(manifest.territories.map((t) => t.id));
  const seenT = new Set<string>();
  for (const c of pack.cards.territoryCards) {
    if (!tids.has(c.territoryId)) errors.push(`Card ${c.id}: unknown territory ${c.territoryId}`);
    if (seenT.has(c.territoryId)) errors.push(`Duplicate territory card for ${c.territoryId}`);
    seenT.add(c.territoryId);
  }
  if (seenT.size !== 42) errors.push(`Territory cards cover ${seenT.size}/42 territories`);
  const cardIds = new Set([...pack.cards.territoryCards, ...pack.cards.coinCards].map((c) => c.id));
  if (cardIds.size !== 52) errors.push("Duplicate card ids in resource decks");
  for (const row of ["2", "3", "4", "5", "6", "7", "8", "9", "10"]) {
    if (!(row in pack.troopPayoutTable)) errors.push(`Payout table missing row ${row}`);
  }
  const expected = { "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6, "8": 7, "9": 8, "10": 10 } as const;
  for (const [k, v] of Object.entries(expected)) {
    if (pack.troopPayoutTable[k] !== v) errors.push(`Payout row ${k} expected ${v}, got ${pack.troopPayoutTable[k]}`);
  }
  const powerIds = new Set(pack.powers.map((p) => p.id));
  for (const f of pack.factions) for (const p of f.startingPowers) {
    if (!powerIds.has(p)) errors.push(`Faction ${f.id}: unknown power ${p}`);
  }
  for (const [key, rc] of Object.entries(pack.ruleConstants)) {
    if (rc.verification === "pending") warnings.push(`ruleConstants.${key} pending verification against rulebook/FAQ`);
  }
  for (const p of pack.powers) if (p.verification === "pending") warnings.push(`power ${p.id} effect text/behavior pending verification`);
  for (const s of pack.scars) if (s.verification === "pending") warnings.push(`scar ${s.id} effect behavior pending verification`);
  for (const m of pack.unlockModules) {
    if (!m.locked && m.implementationStatus !== "playable") errors.push(`Module ${m.id} unlocked but not playable`);
  }
  return { errors, warnings };
}

/** Convenience accessors */
export const ruleValue = <T>(key: string): T => (contentPack.ruleConstants[key] as any).value as T;
/** City population by type, read from pack data (rules are data, not code). */ // new
export const cityPopulation = (type: "minor" | "major" | "world_capital"): number => contentPack.cityPopulations[type]; // new
export function troopsForResources(resources: number, table = contentPack.troopPayoutTable): number {
  if (resources < 2) return 0;
  const capped = Math.min(resources, 10);
  return table[String(capped)];
}
