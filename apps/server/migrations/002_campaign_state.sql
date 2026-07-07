-- 10b: persisted cross-game CampaignState.
-- campaigns.state        = the live folded CampaignState JSON (updated when a game's rewards commit)
-- game_sessions.campaign_state = the snapshot used to seed that session (replay stays deterministic)
ALTER TABLE campaigns ADD COLUMN state TEXT;
ALTER TABLE game_sessions ADD COLUMN campaign_state TEXT;
