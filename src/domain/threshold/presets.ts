import type { ThresholdRange } from './thresholdTypes';

export const DEFAULT_THRESHOLD: ThresholdRange = { min: 40, max: 255 };

export function defaultThreshold(): ThresholdRange {
  return { ...DEFAULT_THRESHOLD };
}
