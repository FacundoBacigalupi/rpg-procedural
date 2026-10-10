// Escenarios de la sim headless (tooling §6): una entrada de `content/scenarios/` se vuelve el
// `LifeSetup` y los años de la corrida. Puro.

import type { Content } from "../../core/index.ts";
import { defaultGameSetup, type GameSetup, type LifeSetup } from "../../game/index.ts";
import { SCENARIOS, type ScenarioEntry } from "../../sim/index.ts";

export interface ScenarioRun {
  readonly setup: LifeSetup;
  /** Años propios del escenario, si los trae. */
  readonly years: number | undefined;
}

/** El setup de la vida que arma el escenario; `frequency` pisa al del escenario si se pasa. */
export function scenarioRun(s: ScenarioEntry, frequency?: number): ScenarioRun {
  const base = defaultGameSetup(s.mode);
  const game: GameSetup =
    s.entryAge === undefined ? base : { ...base, entry: { kind: "age", at: s.entryAge } };
  const f = frequency ?? s.frequency;
  return {
    setup: {
      game,
      ...(f === undefined ? {} : { frequency: f }),
      ...(s.life ? { life: s.life } : {}),
    },
    years: s.years,
  };
}

/** Busca el escenario por id; el error lista los que hay. */
export function findScenario(content: Content, id: string): ScenarioEntry {
  const s = content.get(SCENARIOS, id);
  if (s) return s;
  const known = content.all(SCENARIOS).map((e) => e.id);
  throw new Error(`escenario desconocido: ${id} (hay: ${known.join(", ") || "ninguno"})`);
}
