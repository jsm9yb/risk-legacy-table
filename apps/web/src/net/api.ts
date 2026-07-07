// new (1-web-a): thin REST client for @risk/server. Token lives in React state only
// (no browser storage — SPEC §11 fixed contract).

export interface AuthUser { id: string; username: string; displayName: string }
export interface AuthResult { token: string; user: AuthUser }
export interface CampaignSummary { id: string; worldName: string; gameNumber: number; role: string; inviteCode?: string }
export interface ContentRequirement { moduleId: string; items: string[] } // new (12)
export interface CampaignLegacy { worldName: string; gameNumber: number; unlockedModules: string[]; contentRequired: ContentRequirement[] } // new (12)

async function req<T>(serverUrl: string, path: string, opts: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${serverUrl}${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: {
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error ?? `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  register: (serverUrl: string, username: string, password: string, displayName?: string) =>
    req<AuthResult>(serverUrl, "/api/register", { body: { username, password, displayName } }),
  login: (serverUrl: string, username: string, password: string) =>
    req<AuthResult>(serverUrl, "/api/login", { body: { username, password } }),
  campaigns: (serverUrl: string, token: string) =>
    req<CampaignSummary[]>(serverUrl, "/api/campaigns", { token }),
  createCampaign: (serverUrl: string, token: string, worldName: string) =>
    req<{ id: string; worldName: string; inviteCode: string }>(serverUrl, "/api/campaigns", { token, body: { worldName } }),
  joinCampaign: (serverUrl: string, token: string, inviteCode: string, asSpectator = false) =>
    req<{ id: string; worldName: string }>(serverUrl, "/api/campaigns/join", { token, body: { inviteCode, asSpectator } }),
  campaignLegacy: (serverUrl: string, token: string, campaignId: string) => // new (12)
    req<CampaignLegacy>(serverUrl, `/api/campaigns/${campaignId}/state`, { token }),
  supplyContent: (serverUrl: string, token: string, campaignId: string, moduleId: string, item: string, content: unknown) => // new (12)
    req<{ ok: true; contentRequired: ContentRequirement[] }>(serverUrl, `/api/campaigns/${campaignId}/content`, { token, body: { moduleId, item, content } }),
};
