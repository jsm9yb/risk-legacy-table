// code-drawn card/mat texture — the single swappable seam. To drop in a real
// scanned texture later, replace CARD_TEXTURE_URL with an imported image asset
// (e.g. `import url from "../../assets/card-texture.png"; export const CARD_TEXTURE_URL = url;`)
// — no card or mat component needs to change.
const noiseSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">
<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
<feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.55 0.55 0.55 0 0"/></filter>
<rect width="120" height="120" filter="url(#n)" opacity="0.3"/>
</svg>`;

export const CARD_TEXTURE_URL: string = `data:image/svg+xml,${encodeURIComponent(noiseSvg)}`;
