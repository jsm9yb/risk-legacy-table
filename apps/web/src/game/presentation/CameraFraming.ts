/** Keep automatic framing on the board; letterbox axes stay centered. */
export function cameraPanForFocus(
  focus: readonly [number, number],
  world: { width: number; height: number },
  viewport: { width: number; height: number },
  scale: number,
) {
  const limitX = Math.max(0, (world.width - viewport.width / scale) / 2);
  const limitY = Math.max(0, (world.height - viewport.height / scale) / 2);
  return {
    x: Math.max(-limitX, Math.min(limitX, world.width / 2 - focus[0])),
    y: Math.max(-limitY, Math.min(limitY, world.height / 2 - focus[1])),
  };
}
