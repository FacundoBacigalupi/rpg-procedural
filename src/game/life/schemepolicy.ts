// Intrigas F1b-2 (schemes §2): la `SchemerView` que sale de lo que ya existe en el mundo, sin
// tablas nuevas, RNG ni eventos. Rasgos innatos del intrigante (audacia, calidez, intelecto,
// voluntad como honra, reactividad como miedo), lo que siente por el blanco (`RELATIONS`) y lo que
// cree de su fuerza (la constitución que se le ve, empujada por el miedo que le tiene). Nunca lee
// la verdad escondida del blanco: solo rasgos visibles. Es el proveedor por defecto de
// `SchemesOptions.view`.

import type { AgentId, Tick } from "../../core/index.ts";
import {
  type BondDef,
  clampTemper,
  type DimensionDef,
  INNATE,
  MIND,
  PERSON,
  RELATIONS,
  type ReadonlyWorldTruth,
  relationship,
  type SchemerView,
  standardize,
  type Trait,
} from "../../sim/index.ts";
import type { SchemeSeed } from "./schemes.ts";

export interface SchemerViewOptions {
  readonly traits: readonly Trait[];
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
  /** Cuánto cree que vale lo que tiene el blanco (0-1); sin dato, 0.5. */
  readonly loot?: (truth: ReadonlyWorldTruth, seed: SchemeSeed) => number;
  /** Chance que cree de ser visto (0-1); sin dato, 0.3. */
  readonly witnesses?: (truth: ReadonlyWorldTruth, seed: SchemeSeed) => number;
}

const unit = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

export function schemerViewOf(o: SchemerViewOptions) {
  const zOf = (truth: ReadonlyWorldTruth, who: AgentId): Record<string, number> => {
    const innate = truth.get(INNATE, who);
    if (!innate) return {};
    return standardize(innate, o.traits, truth.get(PERSON, who)?.sex ?? "female");
  };
  return (truth: ReadonlyWorldTruth, seed: SchemeSeed, now: number): SchemerView => {
    const zo = zOf(truth, seed.owner);
    const zt = zOf(truth, seed.target);
    const t = (z: Record<string, number>, k: string) => clampTemper(z[k] ?? 0);
    const dims = relationship(truth.get(RELATIONS, seed.owner), seed.target, now as Tick, {
      dims: o.dims,
      bonds: o.bonds,
      schemaStrength: (s) => truth.get(MIND, seed.owner)?.schemas[s]?.strength ?? 0,
    }).dims;
    const fearOfTarget = dims.fear;
    const grudge = Math.max(dims.resentment, dims.jealousy);
    return {
      motive: seed.motive,
      motiveStrength: round(unit(0.3 + 0.7 * grudge)),
      boldness: round(unit(0.5 + 0.25 * t(zo, "boldness"))),
      warmth: round(unit(0.5 + 0.25 * t(zo, "warmth"))),
      honor: round(unit(0.5 + 0.35 * t(zo, "willpower"))),
      fear: round(unit(0.4 + 0.15 * t(zo, "reactivity") + 0.3 * fearOfTarget)),
      intellect: round(unit(0.5 + 0.2 * t(zo, "intellect"))),
      believedTargetStrength: round(
        unit(0.5 + 0.15 * (t(zt, "constitution") - t(zo, "constitution")) + 0.3 * fearOfTarget),
      ),
      believedLoot: round(unit(o.loot?.(truth, seed) ?? 0.5)),
      believedWitnesses: round(unit(o.witnesses?.(truth, seed) ?? 0.3)),
      affinity: round(Math.min(1, Math.max(-1, dims.affection - dims.resentment))),
    };
  };
}
