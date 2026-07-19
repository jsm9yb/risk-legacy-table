import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { contentPack } from "@risk/content";
import type { CampaignPreparationAction, CampaignState } from "@risk/rules";
import boardSvg from "../../../../packages/map/assets/board.svg?raw";
import ResourceCard from "./cards/ResourceCard.tsx";
import { territoryName } from "./labels.ts";

type DropTarget = { cardId: string; slot: 1 | 2 };
type PendingPlacement = DropTarget & { stickerId: string };

export default function PrepareWorldScreen({ campaign, dispatch, onExit, viewerId, adminOverride = true }: {
  campaign: CampaignState;
  dispatch: (action: CampaignPreparationAction) => void;
  onExit: () => void;
  viewerId?: string;
  adminOverride?: boolean;
}) {
  const preparation = campaign.preparation!;
  const current = preparation.participants[preparation.actorIndex];
  const actingPlayerId = viewerId ?? current.playerId;
  const canPlace = !viewerId || viewerId === current.playerId;
  const placed = preparation.resourceStickers.filter((sticker) => sticker.cardId).length;
  const nextSticker = preparation.resourceStickers.find((sticker) => !sticker.cardId);
  const [carrying, setCarrying] = useState(false);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number }>();
  const [activeTarget, setActiveTarget] = useState<DropTarget>();
  const [pending, setPending] = useState<PendingPlacement>();
  const [confirmRandomize, setConfirmRandomize] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const dragRef = useRef<{ pointerId: number; stickerId: string }>();

  const slotsByCard = useMemo(() => Object.fromEntries(contentPack.cards.territoryCards.map((card) => [card.id, {
    1: preparation.resourceStickers.find((sticker) => sticker.cardId === card.id && sticker.slot === 1)?.stickerId,
    2: preparation.resourceStickers.find((sticker) => sticker.cardId === card.id && sticker.slot === 2)?.stickerId,
  }])), [preparation.resourceStickers]);

  const legalSlot = useCallback((cardId: string): 1 | 2 | undefined => {
    const slots = slotsByCard[cardId] as Record<1 | 2, string | undefined> | undefined;
    if (!slots) return undefined;
    if (!slots[1]) return 1;
    if (!slots[2]) return 2;
    return undefined;
  }, [slotsByCard]);

  const openPlacement = useCallback((target: DropTarget, stickerId = nextSticker?.stickerId) => {
    if (!stickerId || legalSlot(target.cardId) !== target.slot) return;
    setPending({ stickerId, ...target });
    setCarrying(false);
    setDragPosition(undefined);
    setActiveTarget(undefined);
    const card = contentPack.cards.territoryCards.find((candidate) => candidate.id === target.cardId)!;
    setAnnouncement(`${territoryName(card.territoryId)} will increase from ${target.slot} to ${target.slot + 1} resources. Confirm to make this permanent.`);
  }, [legalSlot, nextSticker?.stickerId]);

  const pointerTarget = useCallback((x: number, y: number): DropTarget | undefined => {
    const element = document.elementFromPoint?.(x, y);
    const card = element?.closest<HTMLElement>("[data-card-id]");
    const cardId = card?.dataset.cardId;
    if (!cardId) return undefined;
    const slot = legalSlot(cardId);
    return slot ? { cardId, slot } : undefined;
  }, [legalSlot]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      setDragPosition({ x: event.clientX, y: event.clientY });
      setActiveTarget(pointerTarget(event.clientX, event.clientY));
    };
    const finish = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const target = pointerTarget(event.clientX, event.clientY);
      dragRef.current = undefined;
      setDragPosition(undefined);
      if (target) openPlacement(target, drag.stickerId);
      else {
        setCarrying(false);
        setActiveTarget(undefined);
        setAnnouncement("Coin returned to the sticker sheet");
      }
    };
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dragRef.current = undefined;
      setCarrying(false);
      setDragPosition(undefined);
      setActiveTarget(undefined);
      setPending(undefined);
      setAnnouncement("Sticker placement cancelled");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("keydown", cancel);
    };
  }, [openPlacement, pointerTarget]);

  const activeTerritoryId = activeTarget
    ? contentPack.cards.territoryCards.find((card) => card.id === activeTarget.cardId)?.territoryId
    : undefined;

  const randomizeRemaining = () => {
    const counts = new Map(contentPack.cards.territoryCards.map((card) => [card.id, preparation.resourceStickers.filter((sticker) => sticker.cardId === card.id).length]));
    const placements = preparation.resourceStickers.filter((sticker) => !sticker.cardId).map((sticker) => {
      const available = contentPack.cards.territoryCards.filter((card) => (counts.get(card.id) ?? 0) < 2);
      const card = available[Math.floor(Math.random() * available.length)];
      const slot = ((counts.get(card.id) ?? 0) + 1) as 1 | 2;
      counts.set(card.id, slot);
      return { stickerId: sticker.stickerId, cardId: card.id, slot };
    });
    dispatch({ type: "preparation.randomizeResourceStickers", playerId: actingPlayerId, placements });
    setConfirmRandomize(false);
    setAnnouncement(`Admin override randomly placed ${placements.length} Coin stickers. Review the Resource deck before sealing.`);
  };

  return (
    <div className="min-h-full bg-ink text-text flex flex-col" data-prepare-world-stage={preparation.stage}>
      <header className="sticky top-0 z-30 bg-ink/95 border-b border-line px-4 py-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onExit} className="font-mono text-xs text-muted hover:text-text">← CAMPAIGNS</button>
        <div className="min-w-0 flex-1 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">Prepare the World · permanent</p>
          <h1 className="font-display font-black tracking-widest text-xl">{campaign.worldName}</h1>
        </div>
        <div className="text-right min-w-36">
          <p className="font-display font-bold tracking-wider text-sm">{current?.name ?? "Preparing seats"}</p>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">
            {preparation.stage === "resource_stickers" ? `Sticker ${placed + 1} of 12` : preparation.stage.replaceAll("_", " ")}
          </p>
        </div>
      </header>

      <p className="sr-only" aria-live="polite">{announcement}</p>

      {preparation.stage === "resource_stickers" && (
        <main className="flex-1 min-h-0 grid lg:grid-cols-[minmax(0,1fr)_230px] lg:grid-rows-[minmax(0,1fr)_auto] gap-3 p-3 overflow-hidden">
          <div className="overflow-auto rounded-sm border border-line bg-panel/30 p-2" aria-label="All 42 Territory cards">
            <div className="grid grid-cols-6 sm:grid-cols-7 gap-1.5 min-w-[620px] min-h-full place-content-center">
              {contentPack.cards.territoryCards.map((card) => {
                const slots = slotsByCard[card.id] as Record<1 | 2, string | undefined>;
                const slot = legalSlot(card.id);
                const highlighted = activeTarget?.cardId === card.id;
                return <div key={card.id} className={highlighted ? "rounded-md ring-2 ring-signal ring-offset-2 ring-offset-ink" : "rounded-md"}
                  onPointerEnter={() => carrying && slot && setActiveTarget({ cardId: card.id, slot })}
                  onFocusCapture={() => carrying && slot && setActiveTarget({ cardId: card.id, slot })}>
                  <ResourceCard cardId={card.id} size="prep" resources={1} selected={highlighted}
                    resourceStickerSlots={{
                      filledBy: slots,
                      activeDropSlot: highlighted ? activeTarget.slot : carrying ? slot : undefined,
                      onDropSlot: carrying ? (selected) => openPlacement({ cardId: card.id, slot: selected }) : undefined,
                    }} />
                </div>;
              })}
            </div>
          </div>

          <aside className="border border-signal/50 bg-panel rounded-sm p-3 flex lg:flex-col items-center gap-3 overflow-auto" aria-label="World Coin sticker sheet">
            <div className="text-center"><h2 className="font-display font-black tracking-widest text-sm">COIN SHEET</h2><p className="font-mono text-[9px] text-muted">{12 - placed} REMAIN</p></div>
            {adminOverride && <button type="button" onClick={() => setConfirmRandomize(true)}
              className="w-full border border-danger/70 text-danger rounded-sm px-2 py-1.5 font-mono text-[9px] uppercase tracking-wider hover:bg-danger/10">
              Randomize remaining · admin override
            </button>}
            <div className="grid grid-cols-3 lg:grid-cols-4 gap-2">
              {preparation.resourceStickers.map((sticker) => sticker.cardId
                ? <span key={sticker.stickerId} data-sticker-hole={sticker.stickerId} className="w-10 aspect-square rounded-full border border-dashed border-line/70 bg-ink/50" aria-label={`${sticker.stickerId} placed`} />
                : <button key={sticker.stickerId} type="button" data-sticker-id={sticker.stickerId}
                    disabled={!canPlace || sticker.stickerId !== nextSticker?.stickerId}
                    aria-pressed={carrying && sticker.stickerId === nextSticker?.stickerId}
                    aria-label={`${sticker.stickerId}${sticker.stickerId === nextSticker?.stickerId ? ", next sticker" : ""}`}
                    onClick={() => {
                      setCarrying(true);
                      setAnnouncement(`Picked up ${sticker.stickerId}. Choose any highlighted Territory card or its next empty pip.`);
                    }}
                    onPointerDown={(event) => {
                      if (!canPlace || sticker.stickerId !== nextSticker?.stickerId) return;
                      event.preventDefault();
                      dragRef.current = { pointerId: event.pointerId, stickerId: sticker.stickerId };
                      setCarrying(true);
                      setDragPosition({ x: event.clientX, y: event.clientY });
                    }}
                    className="w-10 aspect-square touch-none rounded-full border-2 border-[#8a6d1c] bg-[#e0b73b] text-[#6f3f21] font-display font-black text-xs shadow disabled:opacity-30 disabled:grayscale focus:ring-2 focus:ring-signal">¢</button>)}
            </div>
            <p className="text-[10px] text-muted text-center">Drag the current Coin onto a Territory card, or select it and choose the card's highlighted pip. Touch, pen, mouse, and keyboard are supported.</p>
            <PreparationMap territoryId={activeTerritoryId} />
          </aside>

          <section className="lg:col-span-2 border border-line bg-panel/75 rounded-sm px-4 py-3 grid md:grid-cols-[auto_1fr] gap-3 items-center" aria-labelledby="resource-card-rules">
            <h2 id="resource-card-rules" className="font-display font-black tracking-widest text-sm text-signal">HOW RESOURCE CARDS WORK</h2>
            <p className="text-xs text-muted leading-relaxed">
              Unlike classic Risk, these cards are not equal. Coins on a Territory card are its <strong className="text-text">resource value</strong>. Trade cards whose combined resources meet a troop threshold; higher-value cards reach those thresholds faster. Every card starts at 1 resource, and these twelve permanent stickers create cards worth 2 or 3.
            </p>
          </section>
        </main>
      )}

      {preparation.stage === "review" && <Review campaign={campaign} dispatch={dispatch} viewerId={viewerId} />}

      {dragPosition && (
        <div aria-hidden className="fixed z-[70] pointer-events-none w-12 h-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#8a6d1c] bg-[#e0b73b] text-[#6f3f21] grid place-items-center font-display font-black text-lg shadow-2xl shadow-black/70"
          style={{ left: dragPosition.x, top: dragPosition.y }}>¢</div>
      )}

      {pending && (
        <div role="dialog" aria-modal="true" aria-label="Confirm permanent sticker" className="fixed inset-0 z-50 bg-ink/80 grid place-items-center p-4">
          <div className="bg-panel border border-signal rounded-sm p-5 max-w-sm w-full">
            <h2 className="font-display font-black tracking-widest text-xl">PLACE PERMANENTLY?</h2>
            <p className="text-sm text-muted mt-2">{territoryName(contentPack.cards.territoryCards.find((card) => card.id === pending.cardId)!.territoryId)} will have {pending.slot + 1} resources. This placement cannot be undone.</p>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setPending(undefined)} className="border border-line px-3 py-2 rounded-sm text-sm">CANCEL</button>
              <button type="button" onClick={() => {
                dispatch({ type: "preparation.placeResourceSticker", playerId: actingPlayerId, ...pending });
                setPending(undefined);
                setAnnouncement(`${pending.stickerId} committed. ${preparation.participants[(preparation.actorIndex + 1) % preparation.participants.length].name} is next.`);
              }} className="bg-signal text-ink px-3 py-2 rounded-sm font-display font-bold tracking-wider text-sm">COMMIT STICKER</button>
            </div>
          </div>
        </div>
      )}

      {confirmRandomize && (
        <div role="dialog" aria-modal="true" aria-label="Confirm admin randomization" className="fixed inset-0 z-50 bg-ink/80 grid place-items-center p-4">
          <div className="bg-panel border border-danger rounded-sm p-5 max-w-sm w-full">
            <p className="font-mono text-[10px] uppercase tracking-widest text-danger">Admin override</p>
            <h2 className="font-display font-black tracking-widest text-xl mt-1">RANDOMIZE ALL REMAINING COINS?</h2>
            <p className="text-sm text-muted mt-2">This immediately distributes all {12 - placed} remaining permanent Coin stickers among legal Territory-card slots and advances to review.</p>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setConfirmRandomize(false)} className="border border-line px-3 py-2 rounded-sm text-sm">CANCEL</button>
              <button type="button" onClick={randomizeRemaining} className="bg-danger text-ink px-3 py-2 rounded-sm font-display font-bold tracking-wider text-sm">RANDOMIZE COINS</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PreparationMap({ territoryId }: { territoryId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll(".prep-map-active").forEach((element) => element.classList.remove("prep-map-active"));
    if (territoryId) root.querySelector(`[id="${territoryId}"]`)?.classList.add("prep-map-active");
  }, [territoryId]);
  return <section className="w-full mt-auto" aria-label="Territory map reference">
    <div className="flex items-baseline justify-between mb-1"><h3 className="font-display font-bold tracking-widest text-xs">MAP REFERENCE</h3><span className="font-mono text-[9px] text-signal">{territoryId ? territoryName(territoryId) : "DRAG OVER A CARD"}</span></div>
    <style>{`.prep-reference-map .territory { opacity: .26; filter: saturate(.35); transition: opacity 120ms ease, filter 120ms ease, stroke 120ms ease; } .prep-reference-map .prep-map-active { opacity: 1 !important; filter: saturate(1.4) brightness(1.2) drop-shadow(0 0 5px #e0b73b) !important; stroke: #fff3a8 !important; stroke-width: 2.5 !important; } .prep-reference-map svg { width: 100%; height: 100%; }`}</style>
    <div ref={ref} aria-hidden="true" className="prep-reference-map aspect-[749.819/519.068] overflow-hidden rounded-sm border border-line bg-[#1b2429] pointer-events-none"
      dangerouslySetInnerHTML={{ __html: boardSvg }} />
  </section>;
}

function Review({ campaign, dispatch, viewerId }: { campaign: CampaignState; dispatch: (action: CampaignPreparationAction) => void; viewerId?: string }) {
  const preparation = campaign.preparation!;
  const reviewer = preparation.participants[preparation.actorIndex];
  const canReview = !viewerId || viewerId === reviewer.playerId;
  const counts = new Map<string, number>();
  for (const sticker of preparation.resourceStickers) counts.set(sticker.cardId!, (counts.get(sticker.cardId!) ?? 0) + 1);
  const distribution = { 1: 0, 2: 0, 3: 0 };
  for (const card of contentPack.cards.territoryCards) distribution[(1 + (counts.get(card.id) ?? 0)) as 1 | 2 | 3]++;
  return <main className="w-full max-w-6xl mx-auto p-5 lg:p-8">
    <h2 className="font-display font-black tracking-widest text-3xl text-center">REVIEW THE RESOURCE DECK</h2>
    <p className="text-sm text-muted text-center mt-2">All twelve stickers are committed. Verify the highlighted cards before sealing the world.</p>
    <div className="flex justify-center gap-3 my-5 font-mono text-xs">
      {([1, 2, 3] as const).map((value) => <span key={value} className="border border-line rounded-sm px-3 py-2">{value} RESOURCE: {distribution[value]}</span>)}
    </div>
    <div className="flex flex-wrap justify-center gap-2" aria-label="Modified Territory cards">
      {[...counts].map(([cardId, stickers]) => <ResourceCard key={cardId} cardId={cardId} resources={1 + stickers} size="sm" selected />)}
    </div>
    <div className="flex justify-center mt-7">
      {!preparation.reviewConfirmedBy
        ? <button type="button" disabled={!canReview} onClick={() => dispatch({ type: "preparation.confirmReview", playerId: reviewer.playerId })} className="bg-signal text-ink rounded-sm px-6 py-3 font-display font-black tracking-widest disabled:opacity-40">CONFIRM REVIEW</button>
        : <button type="button" disabled={!canReview} onClick={() => dispatch({ type: "preparation.seal", playerId: reviewer.playerId })} className="bg-ok text-ink rounded-sm px-6 py-3 font-display font-black tracking-widest disabled:opacity-40">SEAL PREPARATION</button>}
    </div>
  </main>;
}
