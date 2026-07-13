import { useState } from "react";
import Hub from "./hub/Hub.tsx";
import SandboxGame from "./game/SandboxGame.tsx";
import LanApp from "./net/LanApp.tsx"; // new (1-web-a)
import { loadLocalCampaign } from "./local/campaignStore.ts";
import TableDemo from "./game/TableDemo.tsx";

export interface LocalConfig {
  players: { id: string; name: string }[];
  seed: number;
  worldName?: string;
  resume?: boolean;
}

type View = { kind: "hub" } | { kind: "local"; cfg: LocalConfig } | { kind: "lan" }; // new (1-web-a)

export default function App() {
  if (new URLSearchParams(window.location.search).has("table-demo")) return <TableDemo />;
  const [view, setView] = useState<View>({ kind: "hub" }); // new
  if (view.kind === "local") return <SandboxGame config={view.cfg} onExit={() => setView({ kind: "hub" })} />; // new
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
