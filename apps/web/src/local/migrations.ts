export const CURRENT_LOCAL_SAVE_VERSION = 4 as const;
export const CURRENT_GAME_SCHEMA_VERSION = 1 as const;
export const CURRENT_CAMPAIGN_SCHEMA_VERSION = 3 as const;

type JsonRecord = Record<string, any>;

export interface MigrationResult {
  value?: JsonRecord;
  fromVersion?: number;
  error?: string;
}

const record = (value: unknown): value is JsonRecord => !!value && typeof value === "object" && !Array.isArray(value);

function migrateV1(save: JsonRecord) {
  return {
    ...save,
    version: CURRENT_LOCAL_SAVE_VERSION,
    schema: {
      save: CURRENT_LOCAL_SAVE_VERSION,
      game: CURRENT_GAME_SCHEMA_VERSION,
      campaign: CURRENT_CAMPAIGN_SCHEMA_VERSION,
    },
    completedSummaries: Array.isArray(save.completedSummaries) ? save.completedSummaries : [],
  };
}

function migrateV2(save: JsonRecord) {
  const next = structuredClone(save);
  const campaign = next.campaignState;
  if (record(campaign) && campaign.preparation === undefined) {
    campaign.preparation = {
      stage: "complete",
      participants: Array.isArray(next.players) ? next.players.map((player: JsonRecord, seat: number) => ({
        playerId: player.id,
        name: player.name,
        seat,
      })) : [],
      actorIndex: 0,
      factionPowerChoices: { ...(campaign.factionPowerChoices ?? {}) },
      resourceStickers: [],
    };
  }
  next.version = CURRENT_LOCAL_SAVE_VERSION;
  next.schema = { save: CURRENT_LOCAL_SAVE_VERSION, game: CURRENT_GAME_SCHEMA_VERSION, campaign: CURRENT_CAMPAIGN_SCHEMA_VERSION };
  return next;
}

function migrateV3(save: JsonRecord) {
  const next = structuredClone(save);
  const campaign = next.campaignState;
  if (record(campaign) && campaign.gameNumber === 0 && record(campaign.preparation) && campaign.preparation.stage !== "complete") {
    if (campaign.preparation.stage !== "review") campaign.preparation.stage = "resource_stickers";
    campaign.preparation.factionPowerChoices = {};
    campaign.factionPowerChoices = {};
  }
  const interactiveFirstWorld = record(campaign)
    && campaign.gameNumber === 0
    && record(campaign.preparation)
    && Array.isArray(campaign.preparation.resourceStickers)
    && campaign.preparation.resourceStickers.length === 12;
  if (interactiveFirstWorld) {
    campaign.factionPowerChoices = {};
    campaign.preparation.factionPowerChoices = {};
    const resetUnchosenSetupPowers = (game: JsonRecord | undefined) => {
      if (!record(game) || game.gameNumber !== 1 || game.phase !== "setup" || !record(game.players)) return;
      const selected = Object.values(game.players).filter(record).some((player) => typeof player.factionId === "string");
      if (!selected) game.factionPowers = {};
    };
    resetUnchosenSetupPowers(next.activeGame);
    if (record(next.rewind) && Array.isArray(next.rewind.checkpoints)) {
      for (const checkpoint of next.rewind.checkpoints) resetUnchosenSetupPowers(checkpoint);
    }
  }
  next.version = CURRENT_LOCAL_SAVE_VERSION;
  next.schema = { save: CURRENT_LOCAL_SAVE_VERSION, game: CURRENT_GAME_SCHEMA_VERSION, campaign: CURRENT_CAMPAIGN_SCHEMA_VERSION };
  return next;
}

export function migrateLocalSave(input: unknown): MigrationResult {
  if (!record(input)) return { error: "Save is not a JSON object" };
  const version = typeof input.version === "number" ? input.version : 0;
  if (version > CURRENT_LOCAL_SAVE_VERSION) return { fromVersion: version, error: `Save version ${version} is newer than this client supports` };
  if (version < 1) return { fromVersion: version, error: "Save has no supported schema version" };
  const v2 = version === 1 ? migrateV1(input) : structuredClone(input);
  const v3 = version < 3 ? migrateV2(v2) : v2;
  const value = version < 4 ? migrateV3(v3) : v3;
  value.schema ??= { save: CURRENT_LOCAL_SAVE_VERSION, game: CURRENT_GAME_SCHEMA_VERSION, campaign: CURRENT_CAMPAIGN_SCHEMA_VERSION };
  value.version = CURRENT_LOCAL_SAVE_VERSION;
  return { value, fromVersion: version };
}

export function validateLocalSaveShape(input: unknown): string[] {
  if (!record(input)) return ["Save is not an object"];
  const errors: string[] = [];
  if (input.version !== CURRENT_LOCAL_SAVE_VERSION) errors.push(`Expected save version ${CURRENT_LOCAL_SAVE_VERSION}`);
  if (typeof input.id !== "string" || !input.id) errors.push("Missing campaign id");
  if (!record(input.metadata) || typeof input.metadata.worldName !== "string") errors.push("Missing campaign metadata");
  if (!Array.isArray(input.players) || input.players.length < 2) errors.push("Missing campaign players");
  if (!record(input.campaignState)) errors.push("Missing campaign state");
  if (input.activeGame !== undefined && !record(input.activeGame)) errors.push("Active game snapshot is invalid");
  if (!Array.isArray(input.completedSummaries)) errors.push("Completed game summaries are invalid");
  return errors;
}
