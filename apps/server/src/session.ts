import { createGame, type CampaignState, type GameState } from "@risk/rules";

export interface ReadyLobbyPlayer {
  userId: string;
  name: string;
}

export interface PreparedSession {
  state: GameState;
  campaignId: string;
  players: { id: string; name: string }[];
  campaign: CampaignState;
}

export function prepareSessionState({
  sessionId,
  campaignId,
  seed,
  campaign,
  readyPlayers,
}: {
  sessionId: string;
  campaignId: string;
  seed: number;
  campaign: CampaignState;
  readyPlayers: ReadyLobbyPlayer[];
}): PreparedSession {
  const players = readyPlayers.map((p) => ({ id: p.userId, name: p.name }));
  return {
    state: createGame({ gameId: sessionId, seed, players, campaign }),
    campaignId,
    players,
    campaign,
  };
}

export function legacyDone(state: GameState): boolean {
  return !!state.winner && (!state.rewards || state.rewards.committed);
}
