-- Prevent campaign forks: a campaign may have only one unresolved game session.
CREATE UNIQUE INDEX one_active_game_session_per_campaign
  ON game_sessions(campaign_id)
  WHERE status = 'active';
