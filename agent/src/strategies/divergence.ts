/** STEADY-STATE DIVERGENCE (the honest probably-no-edge arm): enter when the
 *  model disagrees with a de-margined global consensus in calm play, exit on
 *  reversion. Expected result vs an efficient consensus: ~zero. We run it as
 *  the treatment-vs-control comparison for the sniper — and report whatever
 *  the data says. */
import type { Strategy } from "./index.js";

export const steadyDivergence: Strategy = {
  key: "divergence",
  label: "Steady-state divergence",
  onTick(t, open, cfg) {
    if (!t.calibrated || !t.model || !t.market || t.finalised) return [];
    const g = t.gapHome ?? 0;

    const intents = [];
    for (const p of open) {
      const signed = p.side === "home" ? g : -g;
      if (Math.abs(g) < cfg.divergence.exitGap || signed < 0) {
        intents.push({ action: "close" as const, side: p.side, positionId: p.id, reason: `gap reverted (${g.toFixed(3)})` });
      }
    }
    if (open.length === 0 && t.recentShock === null && // calm play only — shocks belong to the sniper
        t.minute >= cfg.divergence.minMinute && t.minute <= cfg.divergence.maxMinute &&
        Math.abs(g) >= cfg.divergence.entryGap) {
      intents.push({
        action: "open" as const,
        side: g > 0 ? ("home" as const) : ("away" as const),
        reason: `steady gap ${g.toFixed(3)} (model ${t.model.home.toFixed(3)} vs market ${t.market.home.toFixed(3)})`,
      });
    }
    return intents;
  },
};
