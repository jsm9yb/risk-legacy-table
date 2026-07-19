// new (1-web-a): LAN campaign flow — register/login, campaign list/create/join (REST),
// Socket.IO lobby with presence/ready, host game launch. Networked game screen is 1-web-b.
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, type AuthResult, type CampaignSummary, type ContentRequirement } from "./api.ts";
import NetworkedGame from "./NetworkedGame.tsx"; // new (1-web-b)
import LegacyVault from "../game/LegacyVault.tsx";
import PrepareWorldScreen from "../game/PrepareWorldScreen.tsx";
import { campaignPreparationStatus, type CampaignPreparationAction, type CampaignState } from "@risk/rules";

interface LobbyMember { userId: string; name: string; role: string; ready: boolean; connected: boolean; seat: number | null }

function Field({ label, value, onChange, type = "text", testId }: { label: string; value: string; onChange: (v: string) => void; type?: string; testId?: string }) {
  return (
    <label className="flex items-center gap-2 mb-2">
      <span className="font-mono text-xs text-muted w-24 uppercase">{label}</span>
      <input type={type} value={value} data-testid={testId} onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-ink border border-line rounded-sm px-3 py-1.5 text-sm focus:border-signal outline-none" />
    </label>
  );
}

function Btn({ onClick, children, tone = "default", disabled }: {
  onClick: () => void;
  children: React.ReactNode;
  tone?: "default" | "primary";
  disabled?: boolean;
}) {
  const cls = tone === "primary" ? "bg-signal text-ink hover:brightness-110" : "border border-line hover:border-signal";
  return <button type="button" onClick={onClick} disabled={disabled}
    className={`px-3 py-1.5 rounded-sm text-sm font-medium disabled:opacity-40 disabled:pointer-events-none ${cls}`}>{children}</button>;
}

export default function LanApp({ onExit }: { onExit: () => void }) {
  const [serverUrl, setServerUrl] = useState(`http://${window.location.hostname}:8787`);
  const [auth, setAuth] = useState<AuthResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [lobby, setLobby] = useState<{ campaign: CampaignSummary; members: LobbyMember[] } | null>(null);
  const [contentRequired, setContentRequired] = useState<ContentRequirement[]>([]); // new (12)
  const [legacyModules, setLegacyModules] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [preparation, setPreparation] = useState<CampaignState | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const lobbyCampaignRef = useRef<CampaignSummary | null>(null);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const refreshCampaigns = (a: AuthResult) => api.campaigns(serverUrl, a.token).then(setCampaigns).catch(fail);

  // One socket per authenticated session; lobby join/leave rides on it.
  useEffect(() => {
    if (!auth) return;
    const socket = io(serverUrl, { auth: { token: auth.token } });
    socketRef.current = socket;
    socket.on("lobby:state", (members: LobbyMember[]) => setLobby((l) => (l ? { ...l, members } : l)));
    socket.on("game:created", ({ sessionId }: { sessionId: string }) => setSessionId(sessionId));
    socket.on("preparation:state", ({ state }: { state: CampaignState }) => setPreparation(state));
    socket.on("connect_error", (e: Error) => setError(e.message));
    socket.on("disconnect", () => setError("Connection lost — reconnecting to the War Room…"));
    socket.on("connect", () => {
      setError(null);
      const campaign = lobbyCampaignRef.current;
      if (!campaign) return;
      socket.emit("lobby:join", { campaignId: campaign.id }, (res: any) => {
        if (res?.error) return setError(res.error);
        setLobby({ campaign, members: res?.members ?? [] });
      });
      socket.emit("preparation:join", { campaignId: campaign.id }, (res: any) => {
        if (res?.error) return setError(res.error);
        setPreparation(res.state);
      });
      api.campaignLegacy(serverUrl, auth.token, campaign.id).then((legacy) => {
        setContentRequired(legacy.contentRequired);
        setLegacyModules(legacy.unlockedModules);
      }).catch(fail);
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [auth, serverUrl]);

  const enterLobby = (campaign: CampaignSummary) => {
    setError(null);
    setSessionId(null);
    setContentRequired([]);
    setLegacyModules([]);
    lobbyCampaignRef.current = campaign;
    socketRef.current?.emit("lobby:join", { campaignId: campaign.id }, (res: any) => {
      if (res?.error) return setError(res.error);
      setLobby({ campaign, members: res?.members ?? [] });
    });
    socketRef.current?.emit("preparation:join", { campaignId: campaign.id }, (res: any) => {
      if (res?.error) return setError(res.error);
      setPreparation(res.state);
    });
    if (auth) api.campaignLegacy(serverUrl, auth.token, campaign.id).then((legacy) => {
      setContentRequired(legacy.contentRequired);
      setLegacyModules(legacy.unlockedModules);
    }).catch(fail); // new (12)
  };

  // new (1-web-b): a created session takes over the whole screen with the networked game
  if (auth && sessionId && socketRef.current) {
    return <NetworkedGame key={sessionId} socket={socketRef.current} sessionId={sessionId} viewerId={auth.user.id}
      onExit={() => { setSessionId(null); setLobby(null); lobbyCampaignRef.current = null; refreshCampaigns(auth); }} />;
  }

  const preparationStage = preparation ? campaignPreparationStatus(preparation) : lobby?.campaign.preparationStatus;
  if (auth && lobby && preparation && preparationStage !== "not_started" && preparationStage !== "complete") {
    const dispatch = (action: CampaignPreparationAction) => socketRef.current?.emit(
      "preparation:action", { campaignId: lobby.campaign.id, action }, (res: any) => res?.error ? setError(res.error) : setError(null),
    );
    return <PrepareWorldScreen campaign={preparation} dispatch={dispatch} viewerId={auth.user.id}
      adminOverride={lobby.campaign.role === "host"} onExit={() => {
      setLobby(null); setPreparation(null); lobbyCampaignRef.current = null; refreshCampaigns(auth);
    }} />;
  }

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-line px-8 py-5 flex items-baseline gap-4">
        <button onClick={onExit} className="font-mono text-xs text-muted hover:text-text">← HUB</button>
        <h1 className="font-display font-extrabold tracking-wide text-2xl text-signal">LAN CAMPAIGNS</h1>
        {auth && <span className="font-mono text-xs text-muted">signed in as {auth.user.displayName}</span>}
      </header>

      <main className="flex-1 p-8 max-w-3xl w-full mx-auto">
        {error && <div role="alert" className="border border-danger text-danger font-mono text-xs px-4 py-2 rounded-sm mb-4">{error}</div>}

        {!auth && <AuthPanel serverUrl={serverUrl} setServerUrl={setServerUrl}
          onAuthed={(a) => { setError(null); setAuth(a); refreshCampaigns(a); }} onError={fail} />}

        {auth && !lobby && (
          <CampaignsPanel serverUrl={serverUrl} auth={auth} campaigns={campaigns}
            onRefresh={() => refreshCampaigns(auth)} onOpen={enterLobby} onResume={(id) => setSessionId(id)} onError={fail} />
        )}

        {auth && lobby && (
          <>
            {lobby.campaign.role === "host" && contentRequired.length > 0 && ( // new (12): import wizard for paused unlocks
              <ContentWizard key={lobby.campaign.id} serverUrl={serverUrl} auth={auth} campaignId={lobby.campaign.id}
                entries={contentRequired} onUpdated={setContentRequired} onError={fail} />
            )}
            <div className="mb-4">
              <LegacyVault unlockedModules={legacyModules} compact />
            </div>
            <LobbyPanel auth={auth} lobby={lobby}
              preparationStatus={preparationStage ?? "not_started"}
              onSeat={(seat) => socketRef.current?.emit("lobby:seat", { campaignId: lobby.campaign.id, seat }, (res: any) => {
                if (res?.error) setError(res.error);
                else setError(null);
              })}
              onReady={(ready) => socketRef.current?.emit("lobby:ready", { campaignId: lobby.campaign.id, ready })}
              onBeginPreparation={() => socketRef.current?.emit("preparation:begin", { campaignId: lobby.campaign.id }, (res: any) => {
                if (res?.error) return setError(res.error);
                if (res?.state) setPreparation(res.state);
              })}
              onLaunch={() => socketRef.current?.emit("game:create", { campaignId: lobby.campaign.id }, (res: any) => {
                if (res?.error) return setError(res.error);
                if (res?.sessionId) setSessionId(res.sessionId);
              })}
              onBack={() => {
                socketRef.current?.emit("lobby:leave", { campaignId: lobby.campaign.id });
                setLobby(null);
                setSessionId(null);
                setLegacyModules([]);
                setPreparation(null);
                lobbyCampaignRef.current = null;
                refreshCampaigns(auth);
              }} />
          </>
        )}
      </main>
    </div>
  );
}

function AuthPanel({ serverUrl, setServerUrl, onAuthed, onError }: {
  serverUrl: string; setServerUrl: (v: string) => void;
  onAuthed: (a: AuthResult) => void; onError: (e: unknown) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  return (
    <section className="bg-panel border border-line rounded-sm p-6">
      <h2 className="font-display font-bold text-xl tracking-wide mb-1">SIGN IN</h2>
      <p className="text-muted text-sm mb-5">Accounts live on the LAN server (run <code className="font-mono text-xs">npm run dev:server</code> on the host).</p>
      <Field label="Server" value={serverUrl} onChange={setServerUrl} testId="server-url" />
      <Field label="Username" value={username} onChange={setUsername} testId="username" />
      <Field label="Password" value={password} onChange={setPassword} type="password" testId="password" />
      <Field label="Display name" value={displayName} onChange={setDisplayName} testId="display-name" />
      <div className="flex gap-2 mt-4">
        <Btn tone="primary" onClick={() => api.login(serverUrl, username, password).then(onAuthed).catch(onError)}>LOG IN</Btn>
        <Btn onClick={() => api.register(serverUrl, username, password, displayName || undefined).then(onAuthed).catch(onError)}>REGISTER</Btn>
      </div>
    </section>
  );
}

function CampaignsPanel({ serverUrl, auth, campaigns, onRefresh, onOpen, onResume, onError }: {
  serverUrl: string; auth: AuthResult; campaigns: CampaignSummary[] | null;
  onRefresh: () => void; onOpen: (c: CampaignSummary) => void; onResume: (sessionId: string) => void; onError: (e: unknown) => void;
}) {
  const [worldName, setWorldName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  return (
    <div className="space-y-4">
      <section className="bg-panel border border-line rounded-sm p-6">
        <h2 className="font-display font-bold text-xl tracking-wide mb-3">YOUR CAMPAIGNS</h2>
        {campaigns === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-muted">No campaigns yet — create one or join with an invite code.</p>
        ) : (
          <div className="space-y-1.5">
            {campaigns.map((c) => (
              <div key={c.id} className="flex items-center gap-3 border border-line rounded-sm px-3 py-2">
                <span className="text-sm">{c.worldName}</span>
                <span className="font-mono text-xs text-muted">game {c.gameNumber} · {c.role}</span>
                {c.inviteCode && <span className="font-mono text-xs text-muted">invite: <span className="text-signal">{c.inviteCode}</span></span>}
                {c.hasActiveGame && <span className="font-mono text-xs text-signal">active game</span>}
                <span className="ml-auto">
                  {c.activeSessionId ? (
                    <Btn tone="primary" onClick={() => onResume(c.activeSessionId!)}>RESUME GAME</Btn>
                  ) : (
                    <Btn tone="primary" onClick={() => onOpen(c)}>OPEN LOBBY</Btn>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="bg-panel border border-line rounded-sm p-6">
        <div className="grid sm:grid-cols-2 gap-6 mb-5">
          <div>
          <h3 className="font-display font-bold tracking-wide mb-2">NEW CAMPAIGN</h3>
          <Field label="World name" value={worldName} onChange={setWorldName} testId="world-name" />
          <p className="text-xs text-muted">Invite and seat the players first. The table prepares the world together afterward.</p>
          </div>
          <div>
          <h3 className="font-display font-bold tracking-wide mb-2">JOIN BY INVITE</h3>
          <Field label="Invite code" value={inviteCode} onChange={setInviteCode} testId="invite-code" />
          <Btn onClick={() => api.joinCampaign(serverUrl, auth.token, inviteCode).then(onRefresh).catch(onError)}>JOIN</Btn>
          </div>
        </div>
        <div className="flex justify-end">
          <Btn tone="primary" disabled={!worldName.trim()}
            onClick={() => api.createCampaign(serverUrl, auth.token, worldName).then(onRefresh).catch(onError)}>CREATE CAMPAIGN</Btn>
        </div>
      </section>
      <LegacyVault compact />
    </div>
  );
}

// new (12): import wizard — the host types the exact card text for content_required unlock items.
function ContentWizard({ serverUrl, auth, campaignId, entries, onUpdated, onError }: {
  serverUrl: string; auth: AuthResult; campaignId: string;
  entries: ContentRequirement[]; onUpdated: (next: ContentRequirement[]) => void; onError: (e: unknown) => void;
}) {
  const [text, setText] = useState<Record<string, string>>({});
  return (
    <section className="bg-panel border border-signal rounded-sm p-6 mb-4">
      <h2 className="font-display font-bold text-xl tracking-wide mb-1">SEALED CONTENT REQUIRED</h2>
      <p className="text-muted text-sm mb-4">
        A module opened with host-entered card text pending. Type the exact text from the physical cards —
        the paused unlock resumes once each item is supplied.
      </p>
      {entries.flatMap((e) => e.items.map((item) => {
        const key = `${e.moduleId}.${item}`;
        return (
          <div key={key} className="mb-4">
            <p className="font-mono text-xs text-muted mb-1">{e.moduleId} · <span className="text-signal">{item}</span></p>
            <textarea data-testid={`content-${key}`} aria-label={`${e.moduleId} ${item}`} value={text[key] ?? ""}
              onChange={(ev) => setText((t) => ({ ...t, [key]: ev.target.value }))}
              className="w-full bg-ink border border-line rounded-sm px-3 py-2 text-sm font-mono h-20 focus:border-signal outline-none mb-1" />
            <Btn onClick={() =>
              api.supplyContent(serverUrl, auth.token, campaignId, e.moduleId, item, text[key] ?? "")
                .then((r) => onUpdated(r.contentRequired)).catch(onError)
            }>SUPPLY {item.toUpperCase()}</Btn>
          </div>
        );
      }))}
    </section>
  );
}

function LobbyPanel({ auth, lobby, preparationStatus, onSeat, onReady, onBeginPreparation, onLaunch, onBack }: {
  auth: AuthResult; lobby: { campaign: CampaignSummary; members: LobbyMember[] };
  preparationStatus: string;
  onSeat: (seat: number) => void; onReady: (ready: boolean) => void; onBeginPreparation: () => void; onLaunch: () => void; onBack: () => void;
}) {
  const me = lobby.members.find((m) => m.userId === auth.user.id);
  const isHost = me?.role === "host";
  const readyCount = lobby.members.filter((m) => m.role !== "spectator" && m.connected && m.ready).length;
  const seatedCount = lobby.members.filter((m) => m.role !== "spectator" && m.connected && m.seat !== null).length;
  const prepared = preparationStatus === "complete";
  const canLaunch = prepared && readyCount >= 3 && readyCount <= 5;
  return (
    <section className="bg-panel border border-line rounded-sm p-6">
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="font-display font-bold text-xl tracking-wide">LOBBY — {lobby.campaign.worldName}</h2>
        <button onClick={onBack} className="font-mono text-xs text-muted hover:text-text ml-auto">← campaigns</button>
      </div>
      <div className="space-y-1.5 mb-4">
        {lobby.members.map((m) => (
          <div key={m.userId} className="flex items-center gap-3 font-mono text-xs">
            <span className={m.connected ? "" : "opacity-40"}>{m.name}</span>
            <span className="text-muted">{m.role}</span>
            {m.role !== "spectator" && <span className="text-muted">seat {m.seat ?? "unassigned"}</span>}
            {m.role !== "spectator" && <span className={m.ready ? "text-signal" : "text-muted"}>{m.ready ? "READY" : "not ready"}</span>}
          </div>
        ))}
      </div>
      {me?.role !== "spectator" && (
        <div className="mb-5">
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">Choose your seat</h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((seat) => {
              const occupant = lobby.members.find((member) => member.seat === seat);
              const mine = occupant?.userId === auth.user.id;
              const reclaimable = !!occupant && !occupant.connected && !mine;
              return (
                <button key={seat} type="button" disabled={!!occupant && !mine && !reclaimable} onClick={() => onSeat(seat)}
                  className={`border rounded-sm px-3 py-3 text-left disabled:opacity-40 ${mine ? "border-signal bg-signal/10" : "border-line hover:border-signal"}`}>
                  <span className="block font-display font-bold tracking-widest text-sm">SEAT {seat}</span>
                  <span className="block font-mono text-[10px] text-muted truncate">{reclaimable ? `${occupant!.name} offline · reclaim` : occupant?.name ?? "available"}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        {prepared && me && me.role !== "spectator" && (
          <Btn tone="primary" disabled={me.seat === null} onClick={() => onReady(!me.ready)}>{me.ready ? "UNREADY" : me.seat === null ? "CHOOSE A SEAT" : "READY"}</Btn>
        )}
        {isHost && !prepared && <Btn tone="primary" onClick={onBeginPreparation} disabled={seatedCount < 3 || seatedCount > 5}>BEGIN PREPARATION ({seatedCount} seated)</Btn>}
        {isHost && prepared && <Btn onClick={onLaunch} disabled={!canLaunch}>LAUNCH GAME ({readyCount} ready)</Btn>}
      </div>{/* new (1-web-b): game:created now mounts NetworkedGame instead of a banner */}
      {isHost && prepared && !canLaunch && (
        <p className="font-mono text-xs text-muted mt-3">
          {readyCount < 3 ? `${3 - readyCount} more connected player${3 - readyCount === 1 ? "" : "s"} must ready.` : "At most 5 players may join."}
        </p>
      )}
      {!prepared && <p className="font-mono text-xs text-muted mt-3">Seat 3-5 connected players. Beginning preparation snapshots this clockwise order and locks seats until the world is sealed.</p>}
      {prepared && <p className="font-mono text-[10px] text-muted mt-3">Seat order becomes clockwise setup order. Launch includes connected, seated players who are READY.</p>}
    </section>
  );
}
