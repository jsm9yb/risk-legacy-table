CREATE TABLE IF NOT EXISTS campaign_actions (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  actor_id TEXT REFERENCES users(id),
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, seq)
);

CREATE INDEX IF NOT EXISTS campaign_actions_campaign_created_idx
  ON campaign_actions(campaign_id, created_at);
