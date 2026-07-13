import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  advanceCampaignScenarioToFirstTurn,
  applyGameToCampaign,
  completeCampaignScenarioGame,
  createCampaignScenarios,
  createGame,
} from "@risk/rules";

const outputDir = resolve(process.argv[2] ?? ".codex-tmp/campaign-scenarios");
const players = [
  { id: "qa1", name: "Ada" },
  { id: "qa2", name: "Lin" },
  { id: "qa3", name: "Rex" },
];

mkdirSync(outputDir, { recursive: true });

for (const scenario of createCampaignScenarios()) {
  let validation:
    | {
      status: "starts";
      nextGameNumber: number;
      reachesFirstTurn: true;
      suppliedContent: string[];
      setupChoices: number;
      eventDeckCount: number;
      activeMission?: string;
      comebackPowers: number;
      capturedPrivateMissions: number;
      alienIslandConnections?: [string, string];
      fullCycle: {
        winner: string;
        finishedGameNumber: number;
        foldedGameNumber: number;
        followingGameNumber: number;
        persistedModules: number;
      };
    }
    | { status: "blocked_on_import"; reason: string };
  try {
    const game = createGame({
      gameId: `qa-${scenario.id}`,
      seed: 3000 + scenario.campaign.gameNumber,
      players,
      campaign: scenario.campaign,
    });
    const flow = advanceCampaignScenarioToFirstTurn(game);
    const finished = completeCampaignScenarioGame(flow.state);
    const folded = applyGameToCampaign(scenario.campaign, finished);
    const following = createGame({
      gameId: `qa-following-${scenario.id}`,
      seed: 9000 + folded.gameNumber,
      players,
      campaign: JSON.parse(JSON.stringify(folded)),
    });
    validation = {
      status: "starts",
      nextGameNumber: game.gameNumber,
      reachesFirstTurn: true,
      suppliedContent: flow.suppliedContent,
      setupChoices: flow.setupChoices.length,
      eventDeckCount: flow.state.legacyCards.eventDeck.length,
      activeMission: flow.state.legacyCards.activeMission?.title,
      comebackPowers: Object.keys(flow.state.comebackPowers).length,
      capturedPrivateMissions: Object.keys(flow.state.capturedPrivateMissions).length,
      alienIslandConnections: flow.state.alienIsland?.connections,
      fullCycle: {
        winner: finished.winner!,
        finishedGameNumber: finished.gameNumber,
        foldedGameNumber: folded.gameNumber,
        followingGameNumber: following.gameNumber,
        persistedModules: following.unlockedModules.length,
      },
    };
  } catch (error) {
    validation = { status: "blocked_on_import", reason: error instanceof Error ? error.message : String(error) };
  }
  if (validation.status !== scenario.expectedStart) {
    throw new Error(`${scenario.id}: expected ${scenario.expectedStart}, got ${validation.status}`);
  }
  writeFileSync(resolve(outputDir, `${scenario.id}.json`), JSON.stringify({ ...scenario, validation }, null, 2));
  console.log(`${scenario.id}: ${validation.status}`);
}

console.log(`Wrote ${createCampaignScenarios().length} campaign fixtures to ${outputDir}`);
