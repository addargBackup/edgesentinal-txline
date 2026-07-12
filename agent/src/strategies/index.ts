/** Strategy plugin interface: pure decision logic over derived state.
 *  Strategies emit INTENTS; the book executes and records them. */
import type { Probs } from "../engine/model.js";
import type { Shock } from "../engine/state.js";
import type { Config } from "../config.js";

export type Side = "home" | "draw" | "away";

export interface OpenPositionView {
  id: number;
  side: Side;
  entryProb: number;
  stake: number;
  openedTs: number;
}

export interface Tick {
  fixtureId: number;
  frameTs: number;
  minute: number;
  minutesLeft: number;
  calibrated: boolean;
  model: Probs | null;
  market: Probs | null;
  /** model.home − market.home (signed, home-prob space) */
  gapHome: number | null;
  /** shocks in this frame */
  shocks: Shock[];
  /** most recent shock within the sniper window, if any */
  recentShock: (Shock & { gapAtShock: number }) | null;
  finalised: boolean;
}

export interface Intent {
  action: "open" | "close";
  side: Side;
  positionId?: number; // for close
  reason: string;
}

export interface Strategy {
  key: string;
  label: string;
  onTick(t: Tick, open: OpenPositionView[], cfg: Config): Intent[];
}

export { baselineFavorite } from "./baseline.js";
export { steadyDivergence } from "./divergence.js";
export { repricingSniper } from "./sniper.js";
