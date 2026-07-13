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

/**
 * Serializes authoritative commits per game session while allowing unrelated
 * sessions to progress independently. Failed tasks never poison the queue.
 */
export class SessionActionQueue {
  private tails = new Map<string, Promise<void>>();

  run<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(sessionId);
    const result = previous
      ? previous.catch(() => undefined).then(task)
      : Promise.resolve().then(task);
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(sessionId, tail);
    void tail.finally(() => {
      if (this.tails.get(sessionId) === tail) this.tails.delete(sessionId);
    });
    return result;
  }
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
  return !!state.winner
    && (!state.rewards || state.rewards.committed)
    && (!state.worldCompletion || !!state.worldCompletion.name)
    && !state.comebackChoice
    && !state.missilePowerChoice
    && !state.missionChoice
    && (state.comebackQueue?.length ?? 0) === 0
    && (state.contentRequired?.length ?? 0) === 0;
}
