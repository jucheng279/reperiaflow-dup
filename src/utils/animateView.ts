export interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function animateView(
  from: ViewState,
  to: ViewState,
  duration: number,
  onFrame: (v: ViewState) => void,
): () => void {
  let cancelled = false;
  let start: number | null = null;

  function step(timestamp: number) {
    if (cancelled) return;
    if (start === null) start = timestamp;
    const elapsed = timestamp - start;
    const t = Math.min(1, elapsed / duration);
    const e = easeOutCubic(t);

    onFrame({
      scale: from.scale + (to.scale - from.scale) * e,
      offsetX: from.offsetX + (to.offsetX - from.offsetX) * e,
      offsetY: from.offsetY + (to.offsetY - from.offsetY) * e,
    });

    if (t < 1) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);

  return () => { cancelled = true; };
}
