// new (1-web-a): LAN campaign flow — register/login, campaign list/create/join (REST),
// Socket.IO lobby with presence/ready, host game launch. Networked game screen is 1-web-b.
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, type AuthResult, type CampaignSummary, type ContentRequirement } from "./api.ts";
import NetworkedGame from "./NetworkedGame.tsx"; // new (1-web-b)

interface LobbyMember { userId: string; name: string; role: string; ready: boolean; connected: boolean }

function Field({ label, value, onChange, type = "text", testId }: { label: string; value: string; onChange: (v: string) => void; type?: string; testId?: string }) {
  return (
    <label className="flex items-center gap-2 mb-2">
      <span className="font-mono text-xs text-muted w-24 uppercase">{label}</span>
      <input type={type} value={value} data-testid={testId} onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-ink border border-line rounded-sm px-3 py-1.5 text-sm focus:border-signal outline-none" />
    </label>
  );
}

function Btn({ onClick, children, tone = "default" }: { onClick: () => void; children: React.ReactNode; tone?: "default" | "primary" }) {
  const cls = tone === "primary" ? "bg-signal text-ink hover:brightness-110" : "border border-line hover:border-signal";
  return <button onClick={onClick} className={`px-3 py-1.5 rounded-sm text-sm font-medium ${cls}`}>{children}</button>;
}

export default function LanApp({ onExit }: { onExit: () => void }) {
  const [serverUrl, setServerUrl] = useState(`http://${window.location.hostname}:8787`);
  const [auth, setAuth] = useState<AuthResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [lobby, setLobby] = useState<{ campaign: CampaignSummary; members: LobbyMember[] } | null>(null);
  const [contentRequired, setContentRequired] = useState<ContentRequirement[]>([]); // new (12)
  const [sessionId, setSessionId] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const refreshCampaigns = (a: AuthResult) => api.campaigns(serverUrl, a.token).then(setCampaigns).catch(fail);

  // One socket per authenticated session; lobby join/leave rides on it.
  useEffect(() => {
    if (!auth) return;
    const socket = io(serverUrl, { auth: { token: auth.token } });
    socketRef.current = socket;
    socket.on("lobby:state", (members: LobbyMember[]) => setLobby((l) => (l ? { ...l, members } : l)));
    socket.on("game:created", ({ sessionId }: { sessionId: string }) => setSessionId(sessionId));
    socket.on("connect_error", (e: Error) => setError(e.message));
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [auth, serverUrl]);

  const enterLobby = (campaign: CampaignSummary) => {
    setError(null);
    socketRef.current?.emit("lobby:join", { campaignId: campaign.id }, (res: any) => {
      if (res?.error) return setError(res.error);
      setLobby({ campaign, members: res?.members ?? [] });
    });
    if (auth) api.campaignLegacy(serverUrl, auth.token, campaign.id).then((l) => setContentRequired(l.contentRequired)).catch(fail); // new (12)
  };

  // new (1-web-b): a created session takes over the whole screen with the networked game
  if (auth && sessionId && socketRef.current) {
    return <NetworkedGame socket={socketRef.current} sessionId={sessionId} viewerId={auth.user.id}
      onExit={() => { setSessionId(null); setLobby(null); refreshCampaigns(auth); }} />;
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
            onRefresh={() => refreshCampaigns(auth)} onOpen={enterLobby} onError={fail} />
        )}

        {auth && lobby && (
          <>
            {lobby.campaign.role === "host" && contentRequired.length > 0 && ( // new (12): import wizard for paused unlocks
              <ContentWizard serverUrl={serverUrl} auth={auth} campaignId={lobby.campaign.id}
                entries={contentRequired} onUpdated={setContentRequired} onError={fail} />
            )}
            <LobbyPanel auth={auth} lobby={lobby}
              onReady={(ready) => socketRef.current?.emit("lobby:ready", { campaignId: lobby.campaign.id, ready })}
              onLaunch={() => socketRef.current?.emit("game:create", { campaignId: lobby.campaign.id }, (res: any) => {
                if (res?.error) return setError(res.error);
                if (res?.sessionId) setSessionId(res.sessionId);
              })}
              onBack={() => { setLobby(null); setSessionId(null); refreshCampaigns(auth); }} />
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

function CampaignsPanel({ serverUrl, auth, campaigns, onRefresh, onOpen, onError }: {
  serverUrl: string; auth: AuthResult; campaigns: CampaignSummary[] | null;
  onRefresh: () => void; onOpen: (c: CampaignSummary) => void; onError: (e: unknown) => void;
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
                <span className="ml-auto"><Btn tone="primary" onClick={() => onOpen(c)}>OPEN LOBBY</Btn></span>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="bg-panel border border-line rounded-sm p-6 grid grid-cols-2 gap-6">
        <div>
          <h3 className="font-display font-bold tracking-wide mb-2">NEW CAMPAIGN</h3>
          <Field label="World name" value={worldName} onChange={setWorldName} testId="world-name" />
          <Btn tone="primary" onClick={() => api.createCampaign(serverUrl, auth.token, worldName).then(onRefresh).catch(onError)}>CREATE</Btn>
        </div>
        <div>
          <h3 className="font-display font-bold tracking-wide mb-2">JOIN BY INVITE</h3>
          <Field label="Invite code" value={inviteCode} onChange={setInviteCode} testId="invite-code" />
          <Btn onClick={() => api.joinCampaign(serverUrl, auth.token, inviteCode).then(onRefresh).catch(onError)}>JOIN</Btn>
        </div>
      </section>
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
            <textarea data-testid={`content-${key}`} value={text[key] ?? ""}
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

function LobbyPanel({ auth, lobby, onReady, onLaunch, onBack }: {
  auth: AuthResult; lobby: { campaign: CampaignSummary; members: LobbyMember[] };
  onReady: (ready: boolean) => void; onLaunch: () => void; onBack: () => void;
}) {
  const me = lobby.members.find((m) => m.userId === auth.user.id);
  const isHost = me?.role === "host";
  const readyCount = lobby.members.filter((m) => m.role !== "spectator" && m.ready).length;
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
            {m.role !== "spectator" && <span className={m.ready ? "text-signal" : "text-muted"}>{m.ready ? "READY" : "not ready"}</span>}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {me && me.role !== "spectator" && (
          <Btn tone="primary" onClick={() => onReady(!me.ready)}>{me.ready ? "UNREADY" : "READY"}</Btn>
        )}
        {isHost && <Btn onClick={onLaunch}>LAUNCH GAME ({readyCount} ready)</Btn>}
      </div>{/* new (1-web-b): game:created now mounts NetworkedGame instead of a banner */}
    </section>
  );
}
