/** THE FLAGSHIP — repricing-window sniper.
 *  Thesis: in steady state a de-margined consensus is smarter than our model,
 *  but in the seconds after a state shock (goal, red card) the model reprices
 *  in one tick while the consensus converges over a measurable window. Enter
 *  when the instant gap exceeds threshold inside that window; exit when the
 *  market has absorbed the shock (gap < convergedGap) or on timeout. The
 *  convergence window itself is measured and published regardless of P&L. */
import type { Strategy } from "./index.js";

export const repricingSniper: Strategy = {
  key: "sniper",
  label: "Repricing-window sniper",
  onTick(t, open, cfg) {
    if (!t.calibrated || !t.model || !t.market || t.finalised) return [];
    const g = t.gapHome ?? 0;
    const intents = [];

    for (const p of open) {
      const ageMin = (t.frameTs - p.openedTs) / 60_000;
      if (Math.abs(g) <= cfg.sniper.convergedGap) {
        intents.push({ action: "close" as const, side: p.side, positionId: p.id, reason: `converged (gap ${g.toFixed(3)})` });
      } else if (ageMin >= cfg.sniper.timeoutMinutes) {
        intents.push({ action: "close" as const, side: p.side, positionId: p.id, reason: `timeout ${ageMin.toFixed(1)}m` });
      }
    }

    if (open.length === 0 && t.recentShock) {
      const windowMin = (t.frameTs - t.recentShock.frameTs) / 60_000;
      if (windowMin <= cfg.sniper.windowMinutes && Math.abs(g) >= cfg.sniper.entryGap) {
        intents.push({
          action: "open" as const,
          side: g > 0 ? ("home" as const) : ("away" as const),
          reason: `shock ${t.recentShock.kind} +${windowMin.toFixed(1)}m, gap ${g.toFixed(3)}`,
        });
      }
    }
    return intents;
  },
};
