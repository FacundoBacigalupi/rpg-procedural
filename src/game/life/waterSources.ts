// Qué fuente bebe cada quien (body-health §5), opt-in: en el sitio (con `space`) se bebe el pozo,
// tratado como diga la config; a campo abierto, la fuente del hex donde está (río, mar, lluvia,
// estancada; por defecto río, sin tratar). Puro y sin azar: arma los ganchos `drinkQuality` de la
// rutina y `waterFor` de la exposición. Sin config no se usa y la aldea por defecto no cambia.

import type { AgentId, EntityRef } from "../../core/index.ts";
import {
  LOCATION,
  type ReadonlyWorldTruth,
  sourceWater,
  TREATED_WATER,
  treatWater,
  type WaterQuality,
  type WaterSourceKind,
  type WaterTreatment,
} from "../../sim/index.ts";

export interface WaterSourcesConfig {
  /** Fuente de un hex a campo abierto (planet-gen: río, lago, mar); lo que falta usa `open`. */
  readonly hexKinds?: ReadonlyMap<number, WaterSourceKind>;
  /** Fuente a campo abierto sin dato (por defecto río). */
  readonly open?: WaterSourceKind;
  /** Cómo se trata el agua en el sitio (por defecto `none`); a campo abierto no se trata. */
  readonly treatment?: WaterTreatment;
  /** 0-1: lo que arrastra el cauce (crecida, lluvia reciente) para los ríos. */
  readonly runoff?: number;
}

/** El agua que bebe quien está en `hex` (con o sin sitio) con la carga `load` del pozo. */
export function waterAt(
  cfg: WaterSourcesConfig,
  at: { readonly hex: number; readonly space?: unknown } | undefined,
  load: number,
): WaterQuality {
  if (at && at.space !== undefined) {
    return treatWater(sourceWater({ kind: "well", load }), cfg.treatment ?? "none");
  }
  const kind = (at ? cfg.hexKinds?.get(at.hex) : undefined) ?? cfg.open ?? "river";
  return sourceWater({ kind, runoff: cfg.runoff ?? 0 });
}

export function waterHooks(cfg: WaterSourcesConfig) {
  return {
    drinkQuality: (truth: ReadonlyWorldTruth, who: AgentId, now?: number): WaterQuality => {
      const base = waterAt(cfg, truth.get(LOCATION, who), 0);
      // Agua que hirvió o filtró él mismo con el verbo `boil`: vale mientras no se ensucie.
      const t = truth.get(TREATED_WATER, who);
      return t !== undefined && now !== undefined && now <= t.until
        ? treatWater(base, t.treatment)
        : base;
    },
    waterFor: (truth: ReadonlyWorldTruth, who: EntityRef, load: number): WaterQuality =>
      waterAt(cfg, truth.get(LOCATION, who), load),
  };
}
