import type { Action, GameState } from "./types.ts";

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

/** Reveals and permanent choices cannot be undone by resetting a phase. */
export function locksRewind(previous: GameState, next: GameState, action: Action): boolean {
  return action.type === "draft.pick" || action.type === "draft.takeStartingCoin"
    || action.type === "scar.play" || action.type === "weakness.play" || action.type === "end.draw"
    || action.type === "reward.choose" || action.type === "module.supplyContent"
    || action.type === "mission.foundWorldCapital" || action.type === "mission.complete"
    || action.type === "event.resolve" || action.type === "mission.choose"
    || action.type === "privateMission.capture" || action.type === "privateMission.activate"
    || action.type === "faction.claimPrivateMission" || action.type === "missilePower.choose"
    || action.type === "alien.placeIsland" || action.type === "comeback.choose"
    || next.phase === "game_over"
    || next.log.some((event) => event.seq > previous.eventSeq && event.type === "DiceRolled");
}
