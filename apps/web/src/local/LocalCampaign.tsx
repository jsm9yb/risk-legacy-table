import { useState } from "react";
import { isCampaignPrepared, type CampaignPreparationAction } from "@risk/rules";
import type { LocalConfig } from "../App.tsx";
import PrepareWorldScreen from "../game/PrepareWorldScreen.tsx";
import SandboxGame from "../game/SandboxGame.tsx";
import {
  applyLocalPreparationAction,
  createNextLocalGame,
  loadLocalCampaign,
  startLocalCampaign,
  type LocalCampaignSave,
} from "./campaignStore.ts";

export default function LocalCampaign({ config, onExit }: { config: LocalConfig; onExit: () => void }) {
  const [save, setSave] = useState<LocalCampaignSave | null>(() => config.resume ? loadLocalCampaign() : startLocalCampaign(config));
  const [error, setError] = useState<string>();

  if (!save) return (
    <div className="min-h-full grid place-items-center p-6"><div role="alert" className="border border-danger bg-panel p-5 rounded-sm">
      <p>No local campaign could be loaded.</p><button type="button" onClick={onExit} className="text-signal mt-3">RETURN TO HUB</button>
    </div></div>
  );

  if (!isCampaignPrepared(save.campaignState)) {
    const dispatch = (action: CampaignPreparationAction) => {
      try {
        let next = applyLocalPreparationAction(save, action);
        if (isCampaignPrepared(next.campaignState)) next = createNextLocalGame(next, next.seed);
        setSave(next);
        setError(undefined);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    return <>
      <PrepareWorldScreen campaign={save.campaignState} dispatch={dispatch} onExit={onExit} />
      {error && <div role="alert" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] bg-danger text-ink px-4 py-2 rounded-sm font-mono text-xs">{error}</div>}
    </>;
  }

  // The preparation reducer creates the active game at seal time. A prepared legacy
  // save without an active game is handed to SandboxGame, which creates the next game.
  return <SandboxGame config={{ ...config, players: save.players, seed: save.seed, worldName: save.metadata.worldName, resume: true }} onExit={onExit} />;
}
