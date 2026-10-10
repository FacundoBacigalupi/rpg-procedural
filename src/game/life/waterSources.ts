// Qué fuente bebe cada quien (body-health §5), opt-in: en el sitio (con `space`) se bebe el pozo,
// tratado como diga la config; a campo abierto, la fuente del hex donde está (río, mar, lluvia,
// estancada; por defecto río, sin tratar). Puro y sin azar: arma los ganchos `drinkQuality` de la
// rutina y `waterFor` de la exposición. Sin config no se usa y la aldea por defecto no cambia.

import type { AgentId, EntityRef, PlanetClock, Seed } from "../../core/index.ts";
import {
  LOCATION,
  type LocalMap,
  type ReadonlyWorldTruth,
  sourceWater,
  TREATED_WATER,
  treatWater,
  type WaterQuality,
  type WaterSourceKind,
  type WaterTreatment,
  weatherAt,
} from "../../sim/index.ts";
import type { LocalTerrain } from "../../worldgen/index.ts";

/**
 * La fuente de cada hex del parche local desde el terreno de planet-gen (mar, lago, río o arroyo;
 * los hexes secos no entran y usan `open`). Puro: el mismo terreno da el mismo mapa.
 */
export function hexKindsFromTerrain(
  tr: Pick<LocalTerrain, "sea" | "lake" | "water">,
): ReadonlyMap<number, WaterSourceKind> {
  const out = new Map<number, WaterSourceKind>();
  for (let h = 0; h < tr.sea.length; h++) {
    if (tr.sea[h] === 1) out.set(h, "sea");
    else if (tr.lake[h] === 1) out.set(h, "stagnant");
    else if ((tr.water[h] as number) > 0) out.set(h, "river");
  }
  return out;
}

export interface WaterSourcesConfig {
  /** Fuente de un hex a campo abierto (planet-gen: río, lago, mar); lo que falta usa `open`. */
  readonly hexKinds?: ReadonlyMap<number, WaterSourceKind>;
  /** Fuente a campo abierto sin dato (por defecto río). */
  readonly open?: WaterSourceKind;
  /** Cómo se trata el agua en el sitio (por defecto `none`); a campo abierto no se trata. */
  readonly treatment?: WaterTreatment;
  /** 0-1: lo que arrastra el cauce (crecida, lluvia reciente) para los ríos. */
  readonly runoff?: number;
  /**
   * Opt-in: si llueve en `now` (lo arma quien cablea desde `dailyWeather`: `precip.kind === "rain"`),
   * a campo abierto se bebe lluvia en vez de la fuente del hex (sin agua de mar: la sal no cambia
   * por llover). Sin él, o sin `now`, nada cambia.
   */
  readonly rainingAt?: (now: number) => boolean;
  /** Opt-in: el verbo `drink` del jugador usa la hidratación neta (la sal deshidrata) con la fuente de acá. */
  readonly netDrink?: boolean;
  /** Opt-in: quien arma el mundo lo completa con `rainingFromWeather` (el tiempo de la celda de la aldea). */
  readonly rainFromWeather?: boolean;
}

/** El agua que bebe quien está en `hex` (con o sin sitio) con la carga `load` del pozo. */
export function waterAt(
  cfg: WaterSourcesConfig,
  at: { readonly hex: number; readonly space?: unknown } | undefined,
  load: number,
  now?: number,
): WaterQuality {
  if (at && at.space !== undefined) {
    return treatWater(sourceWater({ kind: "well", load }), cfg.treatment ?? "none");
  }
  const kind = (at ? cfg.hexKinds?.get(at.hex) : undefined) ?? cfg.open ?? "river";
  if (now !== undefined && cfg.rainingAt?.(now) && kind !== "sea") {
    return sourceWater({ kind: "rain", load });
  }
  return sourceWater({ kind, runoff: cfg.runoff ?? 0 });
}

export function waterHooks(cfg: WaterSourcesConfig) {
  return {
    drinkQuality: (truth: ReadonlyWorldTruth, who: AgentId, now?: number): WaterQuality => {
      const base = waterAt(cfg, truth.get(LOCATION, who), 0, now);
      // Agua que hirvió o filtró él mismo con el verbo `boil`: vale mientras no se ensucie.
      const t = truth.get(TREATED_WATER, who);
      return t !== undefined && now !== undefined && now <= t.until
        ? treatWater(base, t.treatment)
        : base;
    },
    waterFor: (
      truth: ReadonlyWorldTruth,
      who: EntityRef,
      load: number,
      now?: number,
    ): WaterQuality => waterAt(cfg, truth.get(LOCATION, who), load, now),
  };
}

/**
 * `rainingAt` armado desde el tiempo del día en la celda de la aldea (`dailyWeather` vía `weatherAt`):
 * llueve si la precipitación es `rain` (ni nieve ni aguanieve). Puro: mismo mapa, reloj y seed, mismo día.
 */
export function rainingFromWeather(
  map: LocalMap,
  clock: PlanetClock,
  seed: Seed,
): (now: number) => boolean {
  return (now) => weatherAt(map, clock, seed, now).precip.kind === "rain";
}

/** La config lista para los ganchos: con `rainFromWeather` y sin `rainingAt` propio, llueve según el tiempo. */
export function resolveWaterSources(
  cfg: WaterSourcesConfig,
  map: LocalMap,
  clock: PlanetClock,
  seed: Seed,
): WaterSourcesConfig {
  return cfg.rainFromWeather === true && cfg.rainingAt === undefined
    ? { ...cfg, rainingAt: rainingFromWeather(map, clock, seed) }
    : cfg;
}
