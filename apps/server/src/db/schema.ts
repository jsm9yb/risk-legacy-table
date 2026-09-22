import type { Generated } from "kysely";

export interface Database {
  users: { id: string; username: string; display_name: string; password_hash: string; created_at: Generated<Date> };
  auth_sessions: { token: string; user_id: string; created_at: Generated<Date> };
  campaigns: {
    id: string; owner_id: string; world_name: string; invite_code: string;
    ruleset_version: Generated<string>; spoiler_mode: Generated<boolean>;
    game_number: Generated<number>; completed: Generated<boolean>;
    warnings_acknowledged: Generated<boolean>; created_at: Generated<Date>;
    state: string | null; // folded CampaignState JSON
  };
  campaign_members: { campaign_id: string; user_id: string; role: Generated<string>; joined_at: Generated<Date> };
  campaign_actions: { campaign_id: string; seq: number; actor_id: string | null; kind: string; payload: string; created_at: Generated<Date> };
  game_sessions: { id: string; campaign_id: string; game_number: number; seed: string; status: Generated<string>; created_at: Generated<Date>; campaign_state: string | null }; // seeding snapshot for deterministic replay
  game_seats: { session_id: string; user_id: string; seat_order: number; faction_id: string | null; result: string | null };
  game_actions: { session_id: string; seq: number; actor_id: string | null; kind: string; payload: string; reason: string | null; created_at: Generated<Date> };
  snapshots: { session_id: string; seq: number; state: string; created_at: Generated<Date> };
  content_packs: { pack_id: string; version: number; body: string; validation_status: string; seeded_at: Generated<Date> };
  content_overrides: { id: string; campaign_id: string; author_id: string; path: string; value: string; reason: string; created_at: Generated<Date> };
  audit_log: { id: string; campaign_id: string | null; session_id: string | null; actor_id: string | null; type: string; detail: string; created_at: Generated<Date> };
}
