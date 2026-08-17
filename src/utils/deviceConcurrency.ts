const nav = globalThis.navigator as Navigator & { deviceMemory?: number };

const cores = nav?.hardwareConcurrency ?? 4;
const memoryGb = nav?.deviceMemory ?? 4;

function compute(): number {
  const byCores = Math.floor(cores * 0.75);
  let byMemory: number;
  if (memoryGb <= 2) byMemory = 2;
  else if (memoryGb <= 4) byMemory = 4;
  else if (memoryGb <= 8) byMemory = 6;
  else byMemory = 10;

  return Math.max(2, Math.min(10, Math.min(byCores, byMemory)));
}

export const adaptiveConcurrency = compute();

// IDB writes saturate faster — use a lower cap
export const idbConcurrency = Math.max(2, Math.min(6, Math.floor(adaptiveConcurrency * 0.75)));
