import { useState, type CSSProperties } from "react";
import type { FactionDefinition } from "@risk/content";
import type { FactionHistoryEntry } from "@risk/rules";
import { FACTION_BLURBS, FACTION_CARD_ART, FACTION_CARD_ART_ROTATIONS } from "./factionAssets.ts";
import FactionEmblem from "./FactionEmblem.tsx";
import { powerById, territoryName } from "./labels.ts";

export default function FactionCard({
  faction,
  powerId,
  history,
  currentGame,
  takenBy,
  selected,
  detail = false,
  onSelect,
}: {
  faction: FactionDefinition;
  powerId?: string;
  history: FactionHistoryEntry[];
  currentGame: number;
  takenBy?: string;
  selected?: boolean;
  detail?: boolean;
  onSelect?: () => void;
}) {
  const [showBack, setShowBack] = useState(false);
  const power = powerId ? powerById(powerId) : undefined;
  const art = FACTION_CARD_ART[faction.id];
  const artRotation = FACTION_CARD_ART_ROTATIONS[faction.id];
  const historyByGame = new Map(history.map((entry) => [entry.gameNumber, entry]));

  return (
    <article
      data-table-anchor="faction" data-anchor-id={faction.id} data-anchor-priority={detail ? "2" : "1"}
      className={`physical-faction-card-wrap ${detail ? "physical-faction-card-detail" : ""} ${selected ? "is-selected" : ""} ${takenBy ? "is-taken" : ""}`}
      style={{ "--faction-color": faction.color } as CSSProperties}
    >
      <button
        type="button"
        className="physical-faction-card-select"
        onClick={onSelect}
        disabled={!onSelect || !!takenBy}
        aria-label={takenBy ? `${faction.name}, taken by ${takenBy}` : `Select ${faction.name}`}
      >
        <span className={`physical-faction-card ${showBack ? "show-back" : ""}`}>
          <span className="physical-faction-card-inner">
            <span className="physical-faction-card-face physical-faction-card-front" aria-hidden={showBack}>
              {art ? <img src={art} alt="" draggable={false} data-faction-card-art={faction.id}
                data-art-rotation={artRotation} /> : <span className="physical-faction-card-missing">{faction.name}</span>}
              {faction.startingPowers.length > 0 && (
                <span className={`faction-power-sticker ${power ? "has-power" : "power-unset"}`} title={power?.text}>
                  <span className="faction-power-kicker">STARTING POWER</span>
                  <strong>{power?.name ?? "Not yet chosen"}</strong>
                  {detail && power && <small>{power.text}</small>}
                </span>
              )}
              {takenBy && <span className="faction-card-taken-stamp">TAKEN BY <strong>{takenBy}</strong></span>}
            </span>

            <span className="physical-faction-card-face physical-faction-card-back" aria-hidden={!showBack}>
              <span className="faction-ledger-watermark" style={{ backgroundImage: art ? `url(${art})` : undefined }} />
              <span className="faction-ledger-title">{faction.name}</span>
              <span className="faction-ledger-subtitle">Campaign record</span>
              <span className="faction-ledger-table" aria-label={`${faction.name} campaign history`}>
                <span className="faction-ledger-row faction-ledger-head">
                  <span>#</span><span>Player</span><span>Starting location</span><span>Result</span>
                </span>
                {Array.from({ length: 15 }, (_, index) => index + 1).map((gameNumber) => {
                  const entry = historyByGame.get(gameNumber);
                  const completed = gameNumber < currentGame;
                  return (
                    <span className="faction-ledger-row" key={gameNumber}>
                      <span>{gameNumber}</span>
                      <span className={entry ? "signature-script" : ""}>{entry?.playerName ?? (completed ? "—" : "")}</span>
                      <span>{entry ? territoryName(entry.startingTerritoryId) : ""}</span>
                      <span>{entry ? resultLabel(entry.result) : completed ? "UNUSED" : ""}</span>
                    </span>
                  );
                })}
              </span>
            </span>
          </span>
        </span>
      </button>

      <button
        type="button"
        className="faction-card-flip"
        onClick={() => setShowBack((shown) => !shown)}
        aria-label={showBack ? `View ${faction.name} front` : `View history for ${faction.name}`}
      >
        {showBack ? "FRONT" : "HISTORY"}
      </button>

      {!detail && (
        <span className="physical-faction-card-caption">
          <span className="faction-card-caption-identity">
            <FactionEmblem factionId={faction.id} size="xs" />
            <span>{FACTION_BLURBS[faction.id]}</span>
          </span>
          <strong>{power?.name ?? (faction.startingPowers.length > 0 ? "Choose its permanent power" : "Sealed faction")}</strong>
        </span>
      )}
    </article>
  );
}

function resultLabel(result: FactionHistoryEntry["result"]) {
  if (result === "won") return "WON";
  if (result === "held_on") return "HELD";
  return "KO";
}
