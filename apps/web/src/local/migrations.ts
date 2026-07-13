export const CURRENT_LOCAL_SAVE_VERSION = 2 as const;
export const CURRENT_GAME_SCHEMA_VERSION = 1 as const;
export const CURRENT_CAMPAIGN_SCHEMA_VERSION = 1 as const;

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

export function migrateLocalSave(input: unknown): MigrationResult {
  if (!record(input)) return { error: "Save is not a JSON object" };
  const version = typeof input.version === "number" ? input.version : 0;
  if (version > CURRENT_LOCAL_SAVE_VERSION) return { fromVersion: version, error: `Save version ${version} is newer than this client supports` };
  if (version < 1) return { fromVersion: version, error: "Save has no supported schema version" };
  const value = version === 1 ? migrateV1(input) : structuredClone(input);
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

