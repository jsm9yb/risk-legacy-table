import { useState } from "react";
import Hub from "./hub/Hub.tsx";
import SandboxGame from "./game/SandboxGame.tsx";
import LanApp from "./net/LanApp.tsx"; // new (1-web-a)

export interface LocalConfig {
  players: { id: string; name: string }[];
  seed: number;
}

type View = { kind: "hub" } | { kind: "local"; cfg: LocalConfig } | { kind: "lan" }; // new (1-web-a)

export default function App() {
  const [view, setView] = useState<View>({ kind: "hub" }); // new
  if (view.kind === "local") return <SandboxGame config={view.cfg} onExit={() => setView({ kind: "hub" })} />; // new
  if (view.kind === "lan") return <LanApp onExit={() => setView({ kind: "hub" })} />; // new
  return <Hub onStart={(cfg) => setView({ kind: "local", cfg })} onLan={() => setView({ kind: "lan" })} />; // new
}
