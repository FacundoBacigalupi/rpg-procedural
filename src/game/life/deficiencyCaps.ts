// Carencias y secuelas leídas en las capacidades (body-health §5): `vigor` baja fuerza y aguante,
// `oxygen` (anemia) el aguante y `cognition` la mente, y la secuela permanente de hambre infantil
// (`cognitionFactor`) baja la cognición para siempre. Puro y sin azar; sin filas devuelve las mismas.

import type { AgentId } from "../../core/index.ts";
import {
  type BodyCapabilities,
  cognitionFactor,
  DEFICIENCY_EFFECTS,
  GROWTH_SEQUELAE,
  type ReadonlyWorldTruth,
} from "../../sim/index.ts";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function applyDeficiency(
  caps: BodyCapabilities,
  truth: ReadonlyWorldTruth,
  who: AgentId,
): BodyCapabilities {
  const fx = truth.get(DEFICIENCY_EFFECTS, who);
  const seq = truth.get(GROWTH_SEQUELAE, who);
  if (!fx && !seq) return caps;
  const vigor = fx ? clamp01(fx.vigor) : 1;
  const air = fx ? 1 - clamp01(fx.oxygen) : 1;
  const mind = (fx ? clamp01(fx.cognition) : 1) * (seq ? cognitionFactor(seq) : 1);
  if (vigor >= 1 && air >= 1 && mind >= 1) return caps;
  return {
    ...caps,
    strength: caps.strength * vigor,
    endurance: caps.endurance * vigor * air,
    cognition: caps.cognition * mind,
  };
}
