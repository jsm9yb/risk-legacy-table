import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Small, printed insignia inspired by the local faction-card scans. These are
// interpretive UI marks, not reproductions of official faction logos. Keep paths
// filter-free: scar SVGs are also parsed by Pixi Graphics at a 10px footprint.
const ink = "#242522";
const paper = "#e6dcc3";
const factions = {
  die_mechaniker: ["Die Mechaniker", "#b28c46", `
    <path d="M42 37 51 27H77L86 37 91 69 81 96 64 104 47 96 37 69Z" fill="${paper}"/>
    <path d="M64 30V52M43 56 56 52 61 64 53 71 43 67ZM85 56 72 52 67 64 75 71 85 67Z" fill="${ink}" stroke="${ink}" stroke-width="3"/>
    <path d="M53 78 56 92M64 76V97M75 78 72 92" stroke="${ink}" stroke-width="5"/>
    <path d="M43 40 51 35M77 35 85 40" stroke="#b28c46" stroke-width="3"/>`],
  enclave_of_the_bear: ["Enclave of the Bear", "#a95549", `
    <path d="M35 66 29 52 34 39 43 43 47 59ZM50 53 44 34 50 23 59 30 60 51ZM68 51 68 30 78 23 83 35 78 54ZM86 61 87 43 97 38 101 51 94 68ZM38 90 44 75 57 60H73L86 75 91 90 81 101 64 95 48 102Z" fill="${paper}"/>
    <path d="M49 88 62 72 69 76 62 86 77 88 67 93Z" fill="${ink}"/>`],
  imperial_balkania: ["Imperial Balkania", "#806080", `
    <path d="M58 39 48 30 55 23 64 28 73 23 80 30 70 39 69 51 101 37 98 52 77 62 96 58 92 70 74 74 87 78 81 88 69 81 74 102 64 96 54 102 59 81 47 88 41 78 54 74 36 70 32 58 51 62 30 52 27 37 59 51Z" fill="${paper}"/>
    <path d="M57 57H71L68 76 64 82 60 76Z" fill="${ink}"/>
    <path d="M57 19H71" stroke="#bfa16b" stroke-width="4"/>`],
  khan_industries: ["Khan Industries", "#527893", `
    <path d="M33 29H53V55L77 29H99L68 63 100 99H76L53 73V99H33Z" fill="${paper}"/>
    <path d="M40 36H47M40 92H47M81 36H88M81 92H88" stroke="${ink}" stroke-width="3"/>
    <path d="M23 49V79M105 49V79" stroke="#527893" stroke-width="4"/>
    <path d="M58 62 64 56 70 62 64 68Z" fill="#527893"/>`],
  saharan_republic: ["Saharan Republic", "#598368", `
    <circle cx="64" cy="63" r="28" fill="none" stroke="#bfa16b" stroke-width="4"/>
    <path d="M64 22 73 54 104 63 73 72 64 104 55 72 24 63 55 54Z" fill="${paper}"/>
    <path d="M64 22V63L55 54ZM104 63H64L73 72ZM64 104V63L55 72Z" fill="#bfa16b"/>
    <path d="M64 54 73 63 64 72 55 63Z" fill="${ink}"/>`],
  mutants: ["Mutants", "#98a05a", `
    <path d="M39 43 54 27 76 31 91 49 88 77 79 85 77 99 51 102 48 84 36 75Z" fill="${paper}"/>
    <path d="M42 52 60 55 58 68 45 66ZM70 54 84 49 81 64 70 67ZM63 69 70 81H57Z" fill="${ink}"/>
    <path d="M53 87V98M63 86V101M72 85V98M60 30 55 42 68 47" stroke="${ink}" stroke-width="4"/>
    <path d="M28 34 38 41M95 34 88 44M27 87 39 80M90 84 101 92" stroke="#98a05a" stroke-width="5"/>`],
  aliens: ["Aliens", "#77a9aa", `
    <path d="M64 26C88 26 98 42 93 61 88 81 73 97 64 104 55 97 40 81 35 61 30 42 40 26 64 26Z" fill="${paper}"/>
    <path d="M39 52C51 51 59 58 60 72 47 71 40 66 39 52ZM89 52C77 51 69 58 68 72 81 71 88 66 89 52ZM60 87H68L64 91Z" fill="${ink}"/>
    <path d="M23 44V81M105 44V81" stroke="#77a9aa" stroke-width="3"/>`],
};

const scars = {
  ammo_shortage: ["Ammo shortage", "#aa3931", `
    <path d="M53 44 64 24 75 44V96H53Z" fill="${paper}"/>
    <path d="M54 51H74M54 87H74" stroke="${ink}" stroke-width="4"/>
    <path d="M30 98 98 30" stroke="${ink}" stroke-width="18"/>
    <path d="M30 98 98 30" stroke="${paper}" stroke-width="10"/>`],
  biohazard: ["Biohazard", "#a3aa50", `
    <circle cx="64" cy="64" r="21" fill="none" stroke="${ink}" stroke-width="7"/>
    <path d="M58 59C34 49 39 22 55 19 44 31 50 47 64 47 78 47 84 31 73 19 89 22 94 49 70 59ZM71 62C92 46 113 64 108 79 104 63 87 60 80 72 73 84 83 97 98 93 87 105 61 96 64 70ZM57 63C60 89 34 99 23 87 38 92 49 79 42 67 35 55 18 57 14 73 9 58 30 40 51 56Z" fill="${ink}"/>
    <circle cx="64" cy="63" r="7" fill="${ink}"/>`],
  bunker: ["Bunker", "#738084", `
    <path d="M25 94 32 52 49 34H79L96 52 103 94Z" fill="${paper}" stroke="${ink}" stroke-width="5"/>
    <path d="M32 55H96L103 94H25Z" fill="#a5aaa2"/>
    <path d="M43 62H85V73H43ZM27 91H101V98H27Z" fill="${ink}"/>
    <path d="M36 53 51 39H76" fill="none" stroke="${paper}" stroke-width="3"/>`],
  fallout: ["Fallout", "#c3a54b", `
    <circle cx="64" cy="64" r="10" fill="${ink}"/>
    <path d="M56 48 40 23A47 47 0 0 1 88 23L72 48A18 18 0 0 0 56 48ZM81 64H111A47 47 0 0 1 87 105L72 79A18 18 0 0 0 81 64ZM56 79 41 105A47 47 0 0 1 17 64H47A18 18 0 0 0 56 79Z" fill="${ink}"/>`],
  fortification: ["Fortification", "#7397a7", `
    <path d="M30 36H44V48H56V36H72V48H84V36H98V96H30Z" fill="${paper}" stroke="${ink}" stroke-width="5"/>
    <path d="M56 76Q64 65 72 76V98H56ZM31 61H97M44 61V75M84 61V75" fill="${ink}" stroke="${ink}" stroke-width="4"/>
    <path d="M24 101H104" stroke="${ink}" stroke-width="6"/>`],
  mercenary: ["Mercenary", "#b28a4b", `
    <path d="M35 61C35 39 46 27 64 27S93 39 93 61L99 69H29Z" fill="${ink}"/>
    <path d="M62 30V56M40 58H88" stroke="#9da79c" stroke-width="4"/>
    <path d="M42 76H86L80 94 64 103 48 94Z" fill="${paper}"/>
    <path d="M58 76H70V84H78V93H70V101H58V93H50V84H58Z" fill="${ink}"/>`],
  weakness: ["Weakness", "#88728e", `
    <path d="M64 24 98 36 92 74Q85 96 64 106 43 96 36 74L30 36Z" fill="${paper}" stroke="${ink}" stroke-width="5"/>
    <path d="M67 25 54 52 72 60 55 80 64 105M54 52 35 43M72 60 95 47M55 80 43 92" fill="none" stroke="${ink}" stroke-width="7"/>`],
};

function svg(label, color, symbol, faction) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="${label}">
  <circle cx="64" cy="66" r="59" fill="#151915"/>
  <circle cx="64" cy="63" r="58" fill="${paper}" stroke="${ink}" stroke-width="3"/>
  <circle cx="64" cy="63" r="53" fill="${color}"/>
  ${faction ? `<circle cx="64" cy="63" r="47" fill="${ink}"/>
  <path d="M24 32 32 24M96 102 104 94" stroke="${paper}" stroke-width="3"/>` : ""}
  ${symbol.trim()}
  <!-- Sparse edge wear stays outside the semantic silhouette. -->
  <path d="M16 45 19 38M28 104 35 109M105 30 109 38M88 113 94 110" fill="none" stroke="${paper}" stroke-width="2"/>
</svg>
`.replace(/^ +$/gm, "");
}

for (const [group, entries, suffix] of [["factions", factions, "mark"], ["scars", scars, "scar"]]) {
  for (const [id, [label, color, symbol]] of Object.entries(entries)) {
    writeFileSync(fileURLToPath(new URL(`../apps/web/src/assets/${group}/${id}-${suffix}.svg`, import.meta.url)), svg(label, color, symbol, group === "factions"));
  }
}
