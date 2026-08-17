export interface HotspotResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

const TILE_SIZE = 16;
const STD_DEV_FACTOR = 2;
const MAX_COVERAGE = 0.4;
const PADDING_FACTOR = 0.25;

export function detectHotspot(
  gray: Uint8Array,
  width: number,
  height: number,
): HotspotResult | null {
  if (width === 0 || height === 0) return null;

  const cols = Math.ceil(width / TILE_SIZE);
  const rows = Math.ceil(height / TILE_SIZE);
  const tileCount = cols * rows;
  const tileMeans = new Float32Array(tileCount);

  for (let tr = 0; tr < rows; tr++) {
    for (let tc = 0; tc < cols; tc++) {
      const x0 = tc * TILE_SIZE;
      const y0 = tr * TILE_SIZE;
      const x1 = Math.min(x0 + TILE_SIZE, width);
      const y1 = Math.min(y0 + TILE_SIZE, height);
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        const rowOffset = y * width;
        for (let x = x0; x < x1; x++) {
          sum += gray[rowOffset + x];
          count++;
        }
      }
      tileMeans[tr * cols + tc] = sum / count;
    }
  }

  let globalSum = 0;
  for (let i = 0; i < tileCount; i++) globalSum += tileMeans[i];
  const globalMean = globalSum / tileCount;

  let varianceSum = 0;
  for (let i = 0; i < tileCount; i++) {
    const d = tileMeans[i] - globalMean;
    varianceSum += d * d;
  }
  const stdDev = Math.sqrt(varianceSum / tileCount);

  if (stdDev < 1) return null;

  const threshold = globalMean + STD_DEV_FACTOR * stdDev;
  const selected = new Uint8Array(tileCount);
  for (let i = 0; i < tileCount; i++) {
    selected[i] = tileMeans[i] >= threshold ? 1 : 0;
  }

  const labels = new Int32Array(tileCount);
  let nextLabel = 1;
  const clusterSizes: number[] = [0];
  const clusterIntensities: number[] = [0];

  for (let i = 0; i < tileCount; i++) {
    if (selected[i] === 0 || labels[i] !== 0) continue;
    const label = nextLabel++;
    let size = 0;
    let intensity = 0;
    const stack = [i];
    while (stack.length > 0) {
      const idx = stack.pop()!;
      if (labels[idx] !== 0) continue;
      labels[idx] = label;
      size++;
      intensity += tileMeans[idx];
      const r = (idx / cols) | 0;
      const c = idx % cols;
      if (r > 0 && selected[idx - cols] && labels[idx - cols] === 0) stack.push(idx - cols);
      if (r < rows - 1 && selected[idx + cols] && labels[idx + cols] === 0) stack.push(idx + cols);
      if (c > 0 && selected[idx - 1] && labels[idx - 1] === 0) stack.push(idx - 1);
      if (c < cols - 1 && selected[idx + 1] && labels[idx + 1] === 0) stack.push(idx + 1);
    }
    clusterSizes.push(size);
    clusterIntensities.push(intensity);
  }

  if (nextLabel === 1) return null;

  let bestLabel = 1;
  let bestScore = 0;
  for (let l = 1; l < nextLabel; l++) {
    const score = clusterIntensities[l];
    if (score > bestScore) {
      bestScore = score;
      bestLabel = l;
    }
  }

  let minC = cols, maxC = 0, minR = rows, maxR = 0;
  for (let i = 0; i < tileCount; i++) {
    if (labels[i] !== bestLabel) continue;
    const r = (i / cols) | 0;
    const c = i % cols;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
  }

  const bx = minC * TILE_SIZE;
  const by = minR * TILE_SIZE;
  const bw = (maxC + 1) * TILE_SIZE - bx;
  const bh = (maxR + 1) * TILE_SIZE - by;

  const coverage = (bw * bh) / (width * height);
  if (coverage > MAX_COVERAGE) return null;

  const padX = bw * PADDING_FACTOR;
  const padY = bh * PADDING_FACTOR;
  const fx = Math.max(0, Math.round(bx - padX));
  const fy = Math.max(0, Math.round(by - padY));
  const fx2 = Math.min(width, Math.round(bx + bw + padX));
  const fy2 = Math.min(height, Math.round(by + bh + padY));

  return { x: fx, y: fy, width: fx2 - fx, height: fy2 - fy };
}
