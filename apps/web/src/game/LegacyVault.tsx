import { contentPack } from "@risk/content";

export const LEGACY_PACKET_DETAILS = [
  {
    moduleId: "pack_1_advanced_draft_biohazards",
    label: "PACK 1",
    condition: "Open when the ninth Minor City is founded.",
    contents: "Advanced Draft, Biohazards, and new Events",
  },
  {
    moduleId: "pack_2_comeback_mercenaries",
    label: "PACK 2",
    condition: "Open when a player or faction is eliminated.",
    contents: "Comeback Powers and Mercenaries",
  },
  {
    moduleId: "pack_3_homelands_missions",
    label: "PACK 3",
    condition: "Open when one person signs the board for the second time.",
    contents: "Homelands, Missions, and new Events",
  },
  {
    moduleId: "pack_4_lead_faction_private_missions",
    label: "PACK 4",
    condition: "Open when the World Capital is founded.",
    contents: "Lead Factions and Private Missions",
  },
  {
    moduleId: "pocket_1_nuclear_war_mutants",
    label: "POCKET 1",
    condition: "Open when three Missiles are used in one combat roll.",
    contents: "Nuclear War, Mutants, and Missile Powers",
  },
  {
    moduleId: "pocket_2_alien_landing",
    label: "POCKET 2",
    condition: "Open when a player recruits 30+ troops while holding a Missile.",
    contents: "Alien Landing, Aliens, Weaknesses, and new Events",
  },
] as const;

export function moduleDisplayName(moduleId: string) {
  return contentPack.unlockModules.find((module) => module.id === moduleId)?.name ?? moduleId.replaceAll("_", " ");
}

export function modulePacketDetail(moduleId: string) {
  return LEGACY_PACKET_DETAILS.find((packet) => packet.moduleId === moduleId);
}

export default function LegacyVault({ unlockedModules = [], compact = false }: {
  unlockedModules?: readonly string[];
  compact?: boolean;
}) {
  const unlocked = new Set(unlockedModules);
  const opened = LEGACY_PACKET_DETAILS.filter((packet) => unlocked.has(packet.moduleId)).length;

  return (
    <section aria-labelledby="legacy-vault-title" className={`bg-panel/95 border border-line rounded-sm ${compact ? "p-4" : "p-6"}`}>
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] text-danger uppercase tracking-[0.22em]">Do not open until instructed</p>
          <h3 id="legacy-vault-title" className="font-display font-black tracking-widest text-xl">THE LEGACY VAULT</h3>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            These sealed packets wait beside the board from the first game. Their labels are public; their contents stay hidden until this world fulfills the instruction.
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest border border-line rounded-full px-3 py-1 text-muted">
          {opened}/6 opened
        </span>
      </div>

      <div className={`grid gap-2 ${compact ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
        {LEGACY_PACKET_DETAILS.map((packet) => {
          const isOpen = unlocked.has(packet.moduleId);
          return (
            <article key={packet.moduleId} data-legacy-packet={packet.moduleId}
              aria-label={`${packet.label} ${isOpen ? "opened" : "sealed"}. ${packet.condition}`}
              className={`relative overflow-hidden border rounded-sm px-3 py-3 min-h-24 ${
                isOpen ? "border-signal/70 bg-signal/10" : "border-line bg-ink/55"
              }`}>
              {!isOpen && <div aria-hidden className="absolute inset-x-0 top-1/2 border-t border-dashed border-danger/35 -rotate-3" />}
              <div className="relative flex items-center gap-2">
                <span className={`font-display font-black tracking-[0.16em] text-sm ${isOpen ? "text-signal" : "text-text"}`}>{packet.label}</span>
                <span className={`ml-auto font-mono text-[9px] uppercase tracking-widest ${isOpen ? "text-signal" : "text-danger"}`}>
                  {isOpen ? "opened" : "sealed"}
                </span>
              </div>
              <p className="relative font-mono text-[10px] leading-relaxed text-muted mt-2">{packet.condition}</p>
              {isOpen && <p className="relative text-xs text-text mt-2">Now active: {packet.contents}.</p>}
            </article>
          );
        })}
      </div>

      <div className="mt-2 border border-dashed border-muted/40 rounded-sm px-3 py-2 flex flex-wrap items-center gap-2">
        <span className="font-display font-black tracking-[0.18em] text-xs text-muted">DO NOT OPEN EVER</span>
        <span className="font-mono text-[9px] text-muted ml-auto">optional variant · remains sealed in the standard campaign</span>
      </div>
    </section>
  );
}
