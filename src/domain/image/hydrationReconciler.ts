import type { SessionImage } from '../session/sessionTypes';
import { isHydrated, rehydrateImage, persistAndShellify } from './memoryTier';
import { idbConcurrency } from '../../utils/deviceConcurrency';
import { runWithConcurrency } from '../../utils/concurrencyPool';

type StoreGet = () => { images: SessionImage[] };
type StoreSet = (
  partial:
    | Partial<{ images: SessionImage[] }>
    | ((s: { images: SessionImage[] }) => Partial<{ images: SessionImage[] }>),
) => void;

export type PostRestoreTransform = (img: SessionImage) => Promise<SessionImage>;

let generation = 0;

export function cancelReconciliation(): void {
  generation++;
}

export async function reconcile(
  toHydrate: string[],
  toEvict: string[],
  get: StoreGet,
  set: StoreSet,
  postRestore?: PostRestoreTransform,
): Promise<void> {
  const gen = ++generation;

  if (toHydrate.length > 0) {
    const hydrateTasks = toHydrate.map((id) => async () => {
      if (generation !== gen) return;
      const images = get().images;
      const img = images.find((i) => i.id === id);
      if (!img || isHydrated(img)) return;
      let restored = await rehydrateImage(img);
      if (generation !== gen) return;
      const freshImg = get().images.find((i) => i.id === id);
      if (freshImg && isHydrated(freshImg)) return;
      if (postRestore) {
        restored = await postRestore(restored);
        if (generation !== gen) return;
      }
      set((cur) => ({
        images: cur.images.map((i) => (i.id === id ? restored : i)),
      }));
    });
    await runWithConcurrency(hydrateTasks, idbConcurrency);
  }

  if (generation !== gen) return;

  if (toEvict.length > 0) {
    const evictTasks = toEvict.map((id) => async () => {
      if (generation !== gen) return;
      const images = get().images;
      const img = images.find((i) => i.id === id);
      if (!img || !isHydrated(img)) return;
      const shell = await persistAndShellify(img);
      if (generation !== gen) return;
      set((cur) => ({
        images: cur.images.map((i) => (i.id === id ? shell : i)),
      }));
    });
    await runWithConcurrency(evictTasks, idbConcurrency);
  }
}
