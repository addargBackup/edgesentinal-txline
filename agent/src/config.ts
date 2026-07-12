/** strategy.yaml — every tunable in one file; retuning never touches code. */
import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";

export interface Config {
  bankroll: number;
  kellyK: number;
  maxStakePerPosition: number;
  maxExposurePerFixture: number;
  model: { maxGoals: number; redCardSelf: number; redCardOpp: number };
  divergence: { entryGap: number; exitGap: number; minMinute: number; maxMinute: number };
  sniper: { entryGap: number; convergedGap: number; timeoutMinutes: number; windowMinutes: number };
  convergence: { epsilon: number; horizonMinutes: number };
  stalenessHaltSec: number;
  commitDecisions: boolean;
}

export const DEFAULTS: Config = {
  bankroll: 1000,
  kellyK: 0.25,
  maxStakePerPosition: 50,
  maxExposurePerFixture: 150,
  model: { maxGoals: 12, redCardSelf: 0.7, redCardOpp: 1.1 },
  divergence: { entryGap: 0.06, exitGap: 0.02, minMinute: 5, maxMinute: 80 },
  sniper: { entryGap: 0.05, convergedGap: 0.015, timeoutMinutes: 10, windowMinutes: 3 },
  convergence: { epsilon: 0.02, horizonMinutes: 15 },
  stalenessHaltSec: 120,
  commitDecisions: false,
};

export function loadConfig(): Config {
  const p = process.env.STRATEGY_CONFIG ?? path.resolve(process.cwd(), "strategy.yaml");
  if (!fs.existsSync(p)) return DEFAULTS;
  const raw = YAML.parse(fs.readFileSync(p, "utf8")) ?? {};
  return {
    ...DEFAULTS, ...raw,
    model: { ...DEFAULTS.model, ...raw.model },
    divergence: { ...DEFAULTS.divergence, ...raw.divergence },
    sniper: { ...DEFAULTS.sniper, ...raw.sniper },
    convergence: { ...DEFAULTS.convergence, ...raw.convergence },
  };
}
