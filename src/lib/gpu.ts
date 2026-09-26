/** GPU helpers shared by the overview, performance view and sidebar. */
import type { Gpu, Snapshot } from "@/types/models";

/** The GPU to feature: the busiest one (a laptop's discrete card while
 * gaming, its integrated one otherwise). */
export function primaryGpu(snapshot: Snapshot): { card: Gpu; index: number } | null {
  let best: { card: Gpu; index: number } | null = null;
  for (const [index, card] of snapshot.gpus.entries()) {
    if (best === null || (card.utilization ?? -1) > (best.card.utilization ?? -1)) {
      best = { card, index };
    }
  }
  return best;
}
