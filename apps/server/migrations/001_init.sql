-- Slice 0 initial schema. App-generated text UUIDs (crypto.randomUUID) keep this portable to pg-mem tests.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  world_name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  ruleset_version TEXT NOT NULL DEFAULT 'risk-legacy-private-v1',
  spoiler_mode BOOLEAN NOT NULL DEFAULT FALSE,
  game_number INTEGER NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  warnings_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE campaign_members (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'player', -- host | player | spectator
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, user_id)
);

CREATE TABLE game_sessions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  game_number INTEGER NOT NULL,
  seed BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active | completed | abandoned
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE game_seats (
  session_id TEXT NOT NULL REFERENCES game_sessions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  seat_order INTEGER NOT NULL,
  faction_id TEXT,
  result TEXT, -- won | held_on | eliminated
  PRIMARY KEY (session_id, user_id)
);

-- Append-only action/event ledger. Past rows are never mutated; corrections append.
CREATE TABLE game_actions (
  session_id TEXT NOT NULL REFERENCES game_sessions(id),
  seq INTEGER NOT NULL,
  actor_id TEXT,
  kind TEXT NOT NULL, -- action | correction
  payload TEXT NOT NULL, -- JSON
  reason TEXT, -- required for corrections
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE snapshots (
  session_id TEXT NOT NULL REFERENCES game_sessions(id),
  seq INTEGER NOT NULL,
  state TEXT NOT NULL, -- JSON GameState
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE content_packs (
  pack_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  seeded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pack_id, version)
);

CREATE TABLE content_overrides (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  path TEXT NOT NULL, -- e.g. ruleConstants.startingTroopsByPlayerCount
  value TEXT NOT NULL, -- JSON
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  session_id TEXT,
  actor_id TEXT,
  type TEXT NOT NULL,
  detail TEXT NOT NULL, -- JSON
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
