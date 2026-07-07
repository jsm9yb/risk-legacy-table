/**
 * Authoritative game server: lightweight accounts, private campaigns with invite
 * codes, Socket.IO lobbies with presence/ready/spectators, and event-sourced
 * game sessions. All actions validate through @risk/rules; clients receive
 * hidden-state-filtered views only. Corrections append; history is immutable.
 */
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDb } from "./db/connect.ts";
import { createGame, applyAction, RuleViolation, initialCampaign, applyGameToCampaign, supplyModuleContent, filterStateFor, type GameState, type Action, type CampaignState } from "@risk/rules"; // new (10b, 1-web-b, 12)
import { contentPack, validateContentPack } from "@risk/content";
import { corsOriginFor, parseCorsOrigins } from "./http.ts";
import { legacyDone, prepareSessionState } from "./session.ts";

const PORT = Number(process.env.PORT ?? 8787);
const ORIGINS = parseCorsOrigins(process.env.CORS_ORIGINS ?? "http://localhost:5173");
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";
mkdirSync(BACKUP_DIR, { recursive: true });

// Content validation gates server start (Slice 3): errors block, warnings logged for host acknowledgement.
const cv = validateContentPack();
if (cv.errors.length) {
  console.error("Content pack validation failed:\n" + cv.errors.join("\n"));
  process.exit(1);
}
console.log(`Content pack ${contentPack.packId} ok (${cv.warnings.length} warnings pending host acknowledgement)`);

const db = createDb();
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const origin = corsOriginFor(ORIGINS, req.headers.origin);
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  if (origin && origin !== "*") res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); // new (1-web-a)
  if (req.method === "OPTIONS") return res.sendStatus(204); // new (1-web-a): answer preflights — browser POSTs with JSON/Authorization were 404ing
  next();
});

// ---------- Auth (lightweight real accounts, scrypt) ----------

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(pw, salt, 32).toString("hex");
}
function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  return timingSafeEqual(Buffer.from(hash, "hex"), scryptSync(pw, salt, 32));
}

async function userFromToken(token?: string) {
  if (!token) return null;
  const row = await db
    .selectFrom("auth_sessions")
    .innerJoin("users", "users.id", "auth_sessions.user_id")
    .select(["users.id", "users.username", "users.display_name"])
    .where("auth_sessions.token", "=", token)
    .executeTakeFirst();
  return row ?? null;
}

function bearer(req: express.Request): string | undefined {
  return req.headers.authorization?.replace(/^Bearer /, "");
}

app.post("/api/register", async (req, res) => {
  const { username, password, displayName } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: "username and password required" });
  const id = randomUUID();
  try {
    await db.insertInto("users").values({ id, username, display_name: displayName ?? username, password_hash: hashPassword(password) }).execute();
  } catch {
    return res.status(409).json({ error: "username taken" });
  }
  const token = randomBytes(24).toString("hex");
  await db.insertInto("auth_sessions").values({ token, user_id: id }).execute();
  res.json({ token, user: { id, username, displayName: displayName ?? username } });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  const user = await db.selectFrom("users").selectAll().where("username", "=", username ?? "").executeTakeFirst();
  if (!user || !verifyPassword(password ?? "", user.password_hash)) return res.status(401).json({ error: "invalid credentials" });
  const token = randomBytes(24).toString("hex");
  await db.insertInto("auth_sessions").values({ token, user_id: user.id }).execute();
  res.json({ token, user: { id: user.id, username: user.username, displayName: user.display_name } });
});

// ---------- Campaigns ----------

app.post("/api/campaigns", async (req, res) => {
  const me = await userFromToken(bearer(req));
  if (!me) return res.status(401).json({ error: "auth required" });
  const { worldName } = req.body ?? {};
  if (!worldName) return res.status(400).json({ error: "worldName required" });
  const id = randomUUID();
  const invite = randomBytes(4).toString("hex");
  await db.insertInto("campaigns").values({ id, owner_id: me.id, world_name: worldName, invite_code: invite }).execute();
  await db.insertInto("campaign_members").values({ campaign_id: id, user_id: me.id, role: "host" }).execute();
  await audit(id, null, me.id, "CampaignCreated", { worldName });
  res.json({ id, worldName, inviteCode: invite });
});

app.post("/api/campaigns/join", async (req, res) => {
  const me = await userFromToken(bearer(req));
  if (!me) return res.status(401).json({ error: "auth required" });
  const { inviteCode, asSpectator } = req.body ?? {};
  const c = await db.selectFrom("campaigns").selectAll().where("invite_code", "=", inviteCode ?? "").executeTakeFirst();
  if (!c) return res.status(404).json({ error: "invalid invite code" });
  await db
    .insertInto("campaign_members")
    .values({ campaign_id: c.id, user_id: me.id, role: asSpectator ? "spectator" : "player" })
    .onConflict((oc) => oc.columns(["campaign_id", "user_id"]).doNothing())
    .execute();
  res.json({ id: c.id, worldName: c.world_name });
});

app.get("/api/campaigns", async (req, res) => {
  const me = await userFromToken(bearer(req));
  if (!me) return res.status(401).json({ error: "auth required" });
  const rows = await db
    .selectFrom("campaign_members")
    .innerJoin("campaigns", "campaigns.id", "campaign_members.campaign_id")
    .select(["campaigns.id", "campaigns.world_name", "campaigns.game_number", "campaigns.invite_code", "campaign_members.role", "campaigns.owner_id"])
    .where("campaign_members.user_id", "=", me.id)
    .execute();
  res.json(rows.map((r) => ({
    id: r.id, worldName: r.world_name, gameNumber: r.game_number, role: r.role,
    inviteCode: r.owner_id === me.id ? r.invite_code : undefined,
  })));
});

// new (12): campaign legacy summary for members — contentRequired drives the import wizard
app.get("/api/campaigns/:id/state", async (req, res) => {
  const me = await userFromToken(bearer(req));
  if (!me) return res.status(401).json({ error: "auth required" });
  const member = await db.selectFrom("campaign_members").selectAll()
    .where("campaign_id", "=", req.params.id).where("user_id", "=", me.id).executeTakeFirst();
  if (!member) return res.status(403).json({ error: "not a campaign member" });
  const c = await db.selectFrom("campaigns").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!c) return res.status(404).json({ error: "no campaign" });
  const state: CampaignState = c.state ? JSON.parse(c.state) : initialCampaign(c.world_name);
  res.json({
    worldName: state.worldName || c.world_name,
    gameNumber: state.gameNumber,
    unlockedModules: state.unlockedModules,
    contentRequired: state.contentRequired ?? [],
  });
});

// new (12): import wizard — the host supplies card text for a paused content_required item.
// The supplied text also appends to content_overrides (immutable record of what was entered).
app.post("/api/campaigns/:id/content", async (req, res) => {
  const me = await userFromToken(bearer(req));
  if (!me) return res.status(401).json({ error: "auth required" });
  const c = await db.selectFrom("campaigns").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!c) return res.status(404).json({ error: "no campaign" });
  if (c.owner_id !== me.id) return res.status(403).json({ error: "host only" });
  const { moduleId, item, content } = req.body ?? {};
  if (!moduleId || !item || content === undefined || content === "") return res.status(400).json({ error: "moduleId, item, and non-empty content required" });
  const state: CampaignState = c.state ? JSON.parse(c.state) : initialCampaign(c.world_name);
  try {
    const next = supplyModuleContent(state, moduleId, item, content);
    await db.updateTable("campaigns").set({ state: JSON.stringify(next) }).where("id", "=", c.id).execute();
    await db.insertInto("content_overrides").values({
      id: randomUUID(), campaign_id: c.id, author_id: me.id,
      path: `${moduleId}.${item}`, value: JSON.stringify(content), reason: "import wizard: module content_required",
    }).execute();
    await audit(c.id, null, me.id, "ModuleContentSupplied", { moduleId, item });
    res.json({ ok: true, contentRequired: next.contentRequired });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get("/api/content/public", (_req, res) => {
  // Locked modules stay out of normal client payloads; spoiler/admin access is a host-only later slice.
  const { unlockModules, ...rest } = contentPack;
  res.json({ ...rest, unlockModules: unlockModules.map((m) => ({ id: m.id, name: m.name, locked: m.locked })) });
});

async function audit(campaignId: string | null, sessionId: string | null, actorId: string | null, type: string, detail: unknown) {
  await db.insertInto("audit_log").values({
    id: randomUUID(), campaign_id: campaignId, session_id: sessionId, actor_id: actorId,
    type, detail: JSON.stringify(detail),
  }).execute();
}

// ---------- Game sessions (event-sourced; state rebuilt by replay) ----------

interface LiveSession {
  state: GameState;
  campaignId: string;
  players: { id: string; name: string }[];
  campaign?: CampaignState; // new (10b): the snapshot this session was seeded from
}
const live = new Map<string, LiveSession>();

async function loadSession(sessionId: string): Promise<LiveSession | null> {
  const cached = live.get(sessionId);
  if (cached) return cached;
  const row = await db.selectFrom("game_sessions").selectAll().where("id", "=", sessionId).executeTakeFirst();
  if (!row) return null;
  const seats = await db.selectFrom("game_seats")
    .innerJoin("users", "users.id", "game_seats.user_id")
    .select(["users.id", "users.display_name", "game_seats.seat_order"])
    .where("session_id", "=", sessionId).orderBy("seat_order").execute();
  const players = seats.map((s) => ({ id: s.id, name: s.display_name }));
  const campaign = row.campaign_state ? (JSON.parse(row.campaign_state) as CampaignState) : undefined; // new (10b): replay with the creation-time snapshot
  let state = createGame({ gameId: sessionId, seed: Number(row.seed), players, campaign }); // new
  const actions = await db.selectFrom("game_actions").selectAll()
    .where("session_id", "=", sessionId).where("kind", "=", "action").orderBy("seq").execute();
  for (const a of actions) state = applyAction(state, JSON.parse(a.payload) as Action);
  const sess = { state, campaignId: row.campaign_id, players, campaign }; // new
  live.set(sessionId, sess);
  return sess;
}

/** Hidden-information filtering: per-viewer state (spectators get public-only). Policy lives in @risk/rules. */
const filterState = filterStateFor; // new (1-web-b): moved to packages/rules so client tests share the exact policy

// ---------- Socket.IO lobbies + live play ----------

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: ORIGINS } });

interface LobbyMember { userId: string; name: string; role: string; ready: boolean; connected: boolean }
const lobbies = new Map<string, Map<string, LobbyMember>>(); // campaignId -> members

io.use(async (socket, next) => {
  const me = await userFromToken(socket.handshake.auth?.token);
  if (!me) return next(new Error("auth required"));
  (socket.data as any).user = me;
  next();
});

io.on("connection", (socket) => {
  const user = (socket.data as any).user as { id: string; display_name: string };

  socket.on("lobby:join", async ({ campaignId }, ack) => {
    const member = await db.selectFrom("campaign_members").selectAll()
      .where("campaign_id", "=", campaignId).where("user_id", "=", user.id).executeTakeFirst();
    if (!member) return ack?.({ error: "not a campaign member" });
    socket.join(`lobby:${campaignId}`);
    const lobby = lobbies.get(campaignId) ?? new Map();
    lobbies.set(campaignId, lobby);
    lobby.set(user.id, { userId: user.id, name: user.display_name, role: member.role, ready: lobby.get(user.id)?.ready ?? false, connected: true });
    io.to(`lobby:${campaignId}`).emit("lobby:state", [...lobby.values()]);
    ack?.({ ok: true, members: [...lobby.values()] });
  });

  socket.on("lobby:ready", ({ campaignId, ready }) => {
    const m = lobbies.get(campaignId)?.get(user.id);
    if (!m || m.role === "spectator") return;
    m.ready = !!ready;
    io.to(`lobby:${campaignId}`).emit("lobby:state", [...lobbies.get(campaignId)!.values()]);
  });

  socket.on("game:create", async ({ campaignId }, ack) => {
    const c = await db.selectFrom("campaigns").selectAll().where("id", "=", campaignId).executeTakeFirst();
    if (!c) return ack?.({ error: "no campaign" });
    if (c.owner_id !== user.id) return ack?.({ error: "host only" });
    const lobby = lobbies.get(campaignId);
    const players = [...(lobby?.values() ?? [])].filter((m) => m.role !== "spectator" && m.ready);
    if (players.length < 3) return ack?.({ error: "need 3+ ready players (starter rules: 3-5)" }); // new (BUG-1): matches the engine's createGame minimum — a 2p session would crash on replay
    if (players.length > 5) return ack?.({ error: "max 5 players" });
    const active = await db.selectFrom("game_sessions").select("id")
      .where("campaign_id", "=", campaignId).where("status", "=", "active").executeTakeFirst();
    if (active) return ack?.({ error: "campaign already has an active game" });
    const sessionId = randomUUID();
    const seed = Math.floor(Math.random() * 2 ** 31); // server randomness; logged in session row + engine events
    const campaignState: CampaignState = c.state ? JSON.parse(c.state) : initialCampaign(c.world_name); // new (10b): seed from the persisted campaign
    let prepared: LiveSession;
    try {
      prepared = prepareSessionState({ sessionId, campaignId, seed, campaign: campaignState, readyPlayers: players });
    } catch (e) {
      if (e instanceof RuleViolation) return ack?.({ error: e.message });
      console.error(e);
      return ack?.({ error: "internal error" });
    }
    try {
      await db.insertInto("game_sessions").values({
        id: sessionId, campaign_id: campaignId, game_number: c.game_number + 1, seed: String(seed),
        campaign_state: JSON.stringify(campaignState), // new: creation-time snapshot keeps replay deterministic
      }).execute();
      await db.updateTable("campaigns").set({ game_number: c.game_number + 1 }).where("id", "=", campaignId).execute();
      let order = 0;
      for (const p of players) {
        await db.insertInto("game_seats").values({ session_id: sessionId, user_id: p.userId, seat_order: order++, faction_id: null, result: null }).execute();
      }
    } catch (e) {
      if ((e as { code?: string }).code === "23505") return ack?.({ error: "campaign already has an active game" });
      console.error(e);
      return ack?.({ error: "internal error" });
    }
    live.set(sessionId, prepared);
    await audit(campaignId, sessionId, user.id, "GameSessionCreated", { seed, players: players.map((p) => p.userId) });
    io.to(`lobby:${campaignId}`).emit("game:created", { sessionId });
    ack?.({ ok: true, sessionId });
  });

  socket.on("game:join", async ({ sessionId }, ack) => {
    const sess = await loadSession(sessionId);
    if (!sess) return ack?.({ error: "no session" });
    const member = await db.selectFrom("campaign_members").selectAll()
      .where("campaign_id", "=", sess.campaignId).where("user_id", "=", user.id).executeTakeFirst();
    if (!member) return ack?.({ error: "not a campaign member" });
    socket.join(`game:${sessionId}`);
    const isSeated = sess.players.some((p) => p.id === user.id);
    ack?.({ ok: true, state: filterState(sess.state, isSeated ? user.id : null), seated: isSeated });
  });

  socket.on("game:action", async ({ sessionId, action }, ack) => {
    const sess = await loadSession(sessionId);
    if (!sess) return ack?.({ error: "no session" });
    const a = action as Action;
    if (a.playerId !== user.id) return ack?.({ error: "cannot act for another player" });
    try {
      const prev = sess.state; // new (10b): pre-action state gates the one-shot completion/fold blocks
      const next = applyAction(prev, a);
      const seq = (await db.selectFrom("game_actions").select(db.fn.countAll().as("n"))
        .where("session_id", "=", sessionId).executeTakeFirst())!.n as unknown as number;
      await db.insertInto("game_actions").values({
        session_id: sessionId, seq: Number(seq) + 1, actor_id: user.id, kind: "action", payload: JSON.stringify(a), reason: null,
      }).execute();
      sess.state = next;
      // Per-viewer hidden-state filtering: emit individually
      const room = io.sockets.adapter.rooms.get(`game:${sessionId}`) ?? new Set();
      for (const sid of room) {
        const sock = io.sockets.sockets.get(sid);
        const viewer = (sock?.data as any)?.user;
        const seated = sess.players.some((p) => p.id === viewer?.id);
        sock?.emit("game:state", filterState(sess.state, seated ? viewer.id : null));
      }
      if (next.phase === "game_over" && next.winner && prev.phase !== "game_over") { // new: fire once at the winning action (reward.choose actions follow inside game_over)
        for (const [fid, result] of Object.entries(next.results ?? {})) {
          const pid = Object.values(next.players).find((p) => p.factionId === fid)?.id;
          if (pid) await db.updateTable("game_seats").set({ result, faction_id: fid }).where("session_id", "=", sessionId).where("user_id", "=", pid).execute();
        }
        await audit(sess.campaignId, sessionId, null, "GameWon", { winner: next.winner, reason: next.winReason, results: next.results });
      }
      // new (10b): once end-game rewards resolve (or none open, post-Game-15), fold the finished
      // game into the persisted CampaignState and export — the seed for the next game:create.
      if (legacyDone(next) && !legacyDone(prev)) { // new
        const folded = applyGameToCampaign(sess.campaign ?? initialCampaign(""), next); // new
        await db.updateTable("campaigns").set({ state: JSON.stringify(folded) }).where("id", "=", sess.campaignId).execute(); // new
        await db.updateTable("game_sessions").set({ status: "completed" }).where("id", "=", sessionId).execute();
        await audit(sess.campaignId, sessionId, null, "CampaignStateFolded", { gameNumber: folded.gameNumber, signatures: folded.signatures }); // new
        // Automatic app-level campaign export after completed games (backup direction)
        writeFileSync(join(BACKUP_DIR, `export-${sess.campaignId}-${sessionId}.json`), JSON.stringify({ campaignId: sess.campaignId, sessionId, finalState: next, campaignState: folded }, null, 2)); // new: now includes the folded campaign
      }
      ack?.({ ok: true });
    } catch (e) {
      if (e instanceof RuleViolation) return ack?.({ error: e.message });
      console.error(e);
      ack?.({ error: "internal error" });
    }
  });

  socket.on("disconnect", () => {
    for (const [campaignId, lobby] of lobbies) {
      const m = lobby.get(user.id);
      if (m) {
        m.connected = false;
        io.to(`lobby:${campaignId}`).emit("lobby:state", [...lobby.values()]);
      }
    }
  });
});

httpServer.listen(PORT, () => console.log(`risk-legacy server on :${PORT}`));
