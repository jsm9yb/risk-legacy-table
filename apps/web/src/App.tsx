import { useState } from "react";
import Hub from "./hub/Hub.tsx";
import LocalCampaign from "./local/LocalCampaign.tsx";
import LanApp from "./net/LanApp.tsx"; // new (1-web-a)
import { loadLocalCampaign } from "./local/campaignStore.ts";
import TableDemo from "./game/TableDemo.tsx";
import type { InitialCampaignCustomization } from "@risk/rules";

export interface LocalConfig {
  players: { id: string; name: string }[];
  seed: number;
  worldName?: string;
  customization?: InitialCampaignCustomization;
  resume?: boolean;
}

type View = { kind: "hub" } | { kind: "local"; cfg: LocalConfig } | { kind: "lan" }; // new (1-web-a)

export default function App() {
  if (new URLSearchParams(window.location.search).has("table-demo")) return <TableDemo />;
  if (import.meta.env.VITE_MULTIPLAYER_ONLY === "true") return <LanApp onExit={() => {}} />;
  const [view, setView] = useState<View>({ kind: "hub" }); // new
  if (view.kind === "local") return <LocalCampaign config={view.cfg} onExit={() => setView({ kind: "hub" })} />; // new
  if (view.kind === "lan") return <LanApp onExit={() => setView({ kind: "hub" })} />; // new
  return <Hub
    onStart={(cfg) => setView({ kind: "local", cfg })}
    onResume={() => {
      const save = loadLocalCampaign();
      if (save) setView({ kind: "local", cfg: { players: save.players, seed: save.seed, worldName: save.metadata.worldName, resume: true } });
    }}
    onLan={() => setView({ kind: "lan" })}
  />; // new
}
