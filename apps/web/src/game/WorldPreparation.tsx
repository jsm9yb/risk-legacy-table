import { contentPack } from "@risk/content";
import type { InitialCampaignCustomization } from "@risk/rules";
import FactionEmblem from "./FactionEmblem.tsx";
import { powerById, territoryName } from "./labels.ts";

export function randomResourceStickerCards() {
  const ids = contentPack.cards.territoryCards.map((card) => card.id);
  for (let index = ids.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [ids[index], ids[swap]] = [ids[swap], ids[index]];
  }
  return ids.slice(0, 12);
}

export function emptyWorldPreparation(): InitialCampaignCustomization {
  return { factionPowerChoices: {}, resourceStickerCardIds: randomResourceStickerCards() };
}

export function worldPreparationReady(value: InitialCampaignCustomization) {
  return contentPack.factions.every((faction) => !!value.factionPowerChoices?.[faction.id])
    && value.resourceStickerCardIds?.length === 12;
}

export default function WorldPreparation({ value, onChange }: {
  value: InitialCampaignCustomization;
  onChange: (value: InitialCampaignCustomization) => void;
}) {
  const choices = value.factionPowerChoices ?? {};
  const chosen = contentPack.factions.filter((faction) => choices[faction.id]).length;
  const stickerCards = value.resourceStickerCardIds ?? [];

  return (
    <section aria-labelledby="prepare-world-title" className="border border-signal/45 bg-ink/35 rounded-sm p-4 mb-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Before Game 1 · permanent</p>
          <h4 id="prepare-world-title" className="font-display font-black tracking-widest text-lg">PREPARE THE WORLD</h4>
          <p className="text-xs text-muted mt-1">Choose one green power for every base faction, then review where the twelve starting Resource stickers land. These choices cannot be changed after launch.</p>
        </div>
        <span className="font-mono text-[10px] text-muted whitespace-nowrap">{chosen}/5 powers</span>
      </div>

      <div className="space-y-3">
        {contentPack.factions.map((faction) => (
          <div key={faction.id} className="grid sm:grid-cols-[180px_1fr] gap-2 items-start">
            <div className="flex items-center gap-2 pt-1">
              <FactionEmblem factionId={faction.id} size="xs" />
              <span className="font-display font-bold tracking-wide text-sm">{faction.name}</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {faction.startingPowers.map((powerId) => {
                const power = powerById(powerId);
                const selected = choices[faction.id] === powerId;
                return (
                  <button key={powerId} type="button" aria-pressed={selected}
                    onClick={() => onChange({ ...value, factionPowerChoices: { ...choices, [faction.id]: powerId } })}
                    className={`rounded-sm border p-2 text-left ${selected ? "border-signal bg-signal/10" : "border-line hover:border-signal"}`}>
                    <span className={`block font-display font-bold tracking-wide text-xs ${selected ? "text-signal" : "text-text"}`}>{power?.name ?? powerId}</span>
                    <span className="block text-[11px] leading-snug text-muted mt-0.5">{power?.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-line mt-4 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display font-bold tracking-widest text-sm">12 RESOURCE STICKERS</span>
          <span className="text-xs text-muted">shuffled across twelve different Territory cards</span>
          <button type="button" onClick={() => onChange({ ...value, resourceStickerCardIds: randomResourceStickerCards() })}
            className="ml-auto font-mono text-[10px] uppercase tracking-widest text-signal">shuffle again</button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2" aria-label="Starting Resource sticker targets">
          {stickerCards.map((cardId) => {
            const card = contentPack.cards.territoryCards.find((candidate) => candidate.id === cardId);
            return <span key={cardId} className="font-mono text-[10px] border border-line rounded-full px-2 py-1 text-muted">{territoryName(card?.territoryId ?? cardId)} +1</span>;
          })}
        </div>
      </div>
    </section>
  );
}
