// Ambientes de qi (body-health §7 y §9, cosmology): el qi del lugar donde está alguien entra al
// ambiente térmico (`qiC` de `altitudeEnv`) y al residuo (`life.residue`, absorción pasiva), sin
// crear qi: el campo de `Essence` del planeta (`planet.essence.level`) solo se lee. Opt-in
// (`LifeParts.ambientQi`): sin él no hay filas, RNG ni eventos nuevos.

import type { AgentId } from "../../core/index.ts";
import {
  ambientQiC,
  LOCATION,
  type ReadonlyWorldTruth,
  relativeQi,
  TRAVEL_CELL,
} from "../../sim/index.ts";

export interface AmbientQi {
  /** Qi (nivel de `Essence`) de la celda del planeta donde está; `undefined` si no se sabe. */
  readonly levelOf: (truth: ReadonlyWorldTruth, who: AgentId) => number | undefined;
  /** Nivel de referencia (el del hogar): lo que el cuerpo da por normal. */
  readonly reference: number;
  /** Naturaleza del qi del lugar, -1 (frío) a 1 (cálido); por defecto 0 (no toca el ambiente térmico). */
  readonly temper?: (truth: ReadonlyWorldTruth, who: AgentId) => number;
}

/** Qi relativo a la referencia donde está `who` (0 si no se sabe). */
export function ambientRelative(a: AmbientQi, truth: ReadonlyWorldTruth, who: AgentId): number {
  const level = a.levelOf(truth, who);
  return level === undefined ? 0 : relativeQi(level, a.reference);
}

/** El `qiC` térmico de donde está `who` (para `ThermalOptions.altitude.qiC`). */
export function ambientQiCOf(a: AmbientQi, truth: ReadonlyWorldTruth, who: AgentId): number {
  return ambientQiC(ambientRelative(a, truth, who), a.temper?.(truth, who) ?? 0);
}

/**
 * Lector del campo del planeta: en el parche local, la celda del mapa (`homeCell`); de viaje
 * (`TRAVEL_CELL`), la celda recorrida. `levels` es `planet.essence.level` (solo lectura).
 */
export function essenceLevelOf(
  levels: ArrayLike<number>,
  homeCell: number,
): (truth: ReadonlyWorldTruth, who: AgentId) => number | undefined {
  return (truth, who) => {
    const cell =
      truth.get(TRAVEL_CELL, who)?.cell ?? (truth.get(LOCATION, who) ? homeCell : undefined);
    return cell === undefined ? undefined : levels[cell];
  };
}
