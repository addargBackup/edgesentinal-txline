/** CONTROL ARM: back the kickoff favorite at the market price, hold to
 *  settlement. Every framework needs a baseline nobody can argue with. */
import type { Strategy } from "./index.js";

export const baselineFavorite: Strategy = {
  key: "baseline",
  label: "Baseline (kickoff favorite, hold)",
  onTick(t, open) {
    if (!t.calibrated || !t.market || t.finalised) return [];
    if (open.length > 0) return []; // one position per fixture, held to the end
    if (t.minute > 3) return [];    // enter at kickoff only
    const side = t.market.home >= t.market.away ? "home" : "away";
    return [{ action: "open", side, reason: "kickoff favorite (control arm)" }];
  },
};
