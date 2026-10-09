// Fuego en la aldea (settlements §9), puro: ignición con causa, combustible de cada edificio
// (`fuelLoad`, del `fuel` de los materiales por la masa de cada parte), propagación entre edificios
// por distancia, viento y cortafuegos, la respuesta de los vecinos y qué queda al apagarse (la
// materia quemada va a ceniza y escombros por el ledger). El proceso que lo aplica irá en
// `game/life`; acá no hay estado ni azar: las tiradas las hace quien llama con su rng con clave.

import { cos, exp, sin, sqrt } from "../../core/index.ts";
import type { BuildingComponent } from "./tables.ts";

export type IgnitionCause = "hearth" | "lamp" | "lightning" | "arson" | "war" | "technique";

/** Chance base diaria por edificio de cada causa (calibración abierta). Las dirigidas no salen del azar. */
const IGNITION_BASE: Readonly<Record<IgnitionCause, number>> = {
  hearth: 0.0004,
  lamp: 0.0002,
  lightning: 0.00002,
  arson: 0,
  war: 0,
  technique: 0,
};

export interface IgnitionInput {
  readonly cause: IgnitionCause;
  /** `fuelLoad` del edificio. */
  readonly fuelLoad: number;
  /** Sequedad 0-1 (1 = seco: sin lluvia hace días). */
  readonly dryness: number;
  /** Cuánto se usa el fuego adentro hoy (fogón, lámpara), 0-1. */
  readonly use: number;
  /** Hay tormenta hoy (el rayo solo cae con tormenta). */
  readonly storm: boolean;
}

/** Chance diaria de que una chispa prenda el edificio. */
export function ignitionChance(i: IgnitionInput): number {
  if (i.cause === "lightning" && !i.storm) return 0;
  const base = IGNITION_BASE[i.cause];
  const use = i.cause === "hearth" || i.cause === "lamp" ? clamp01(i.use) : 1;
  return Math.min(1, base * use * Math.max(0, i.fuelLoad) * (0.3 + 1.4 * clamp01(i.dryness)));
}

/** Qué tan bien arde un edificio: el `fuel` de cada material ponderado por su masa en las partes. */
export function fuelLoad(
  components: readonly BuildingComponent[],
  fuelOf: (material: string) => number,
): number {
  let grams = 0;
  let weighted = 0;
  for (const c of components) {
    for (const l of c.materials) {
      grams += l.grams;
      weighted += l.grams * fuelOf(l.material);
    }
  }
  return grams > 0 ? weighted / grams : 0;
}

/** Un edificio visto por el fuego. */
export interface FireNode {
  readonly id: string;
  /** Metros respecto de la plaza (x este, y norte). */
  readonly at: { readonly x: number; readonly y: number };
  readonly fuelLoad: number;
  /** Cortafuegos propio (muro de piedra, patio, huerta mojada), 0-1 de cuánto frena. */
  readonly firebreak: number;
}

/** Hasta qué distancia salta el fuego sin viento (m). */
export const SPREAD_RANGE_M = 12;

/** Alineación del viento (dirRad: hacia dónde sopla, 0 = este) con la dirección fuente a destino: 1 a favor, -1 en contra. */
export function windAlignment(from: FireNode, to: FireNode, dirRad: number): number {
  const dx = to.at.x - from.at.x;
  const dy = to.at.y - from.at.y;
  const d = sqrt(dx * dx + dy * dy);
  if (d === 0) return 1;
  return (dx * cos(dirRad) + dy * sin(dirRad)) / d;
}

export interface SpreadInput {
  readonly from: FireNode;
  readonly to: FireNode;
  /** Intensidad del fuego en `from`, 0-1. */
  readonly intensity: number;
  readonly windMs: number;
  readonly windDirRad: number;
  readonly dryness: number;
  /** Los vecinos echan agua sobre `to` hoy, 0-1 (ver `responseEffort`). */
  readonly wetting: number;
}

/**
 * Chance diaria de que el fuego de `from` prenda `to`. Cae con la distancia (cero pasado
 * `SPREAD_RANGE_M`, que el viento a favor alarga hasta el doble), el cortafuegos y el agua; sube con
 * la intensidad, el combustible del destino, la sequedad y el viento a favor. Un destino sin
 * combustible (piedra, teja) no prende.
 */
export function spreadChance(i: SpreadInput): number {
  const ddx = i.to.at.x - i.from.at.x;
  const ddy = i.to.at.y - i.from.at.y;
  const dist = sqrt(ddx * ddx + ddy * ddy);
  const align = windAlignment(i.from, i.to, i.windDirRad);
  const gust = Math.max(0, i.windMs) / 10;
  const range = SPREAD_RANGE_M * (1 + Math.max(0, align) * Math.min(1, gust));
  if (dist >= range) return 0;
  const near = 1 - dist / range;
  const windFactor = Math.max(0.1, 1 + align * Math.min(1.5, gust));
  const p =
    near *
    near *
    clamp01(i.intensity) *
    clamp01(i.to.fuelLoad / 1.4) *
    (0.3 + 0.9 * clamp01(i.dryness)) *
    windFactor *
    (1 - clamp01(i.to.firebreak)) *
    (1 - 0.85 * clamp01(i.wetting));
  return clamp01(p);
}

export interface FireResponseInput {
  /** Vecinos adultos sanos cerca. */
  readonly neighbors: number;
  /** Agua a mano (tinajas, pozo): litros / 1000, con tope 1. */
  readonly water: number;
  /** Hay brigada organizada o autoridad que manda. */
  readonly organized: boolean;
}

/** Esfuerzo de respuesta 0-1: diez vecinos con agua y orden apagan casi todo; uno con un balde no. */
export function responseEffort(r: FireResponseInput): number {
  const hands = 1 - exp(-Math.max(0, r.neighbors) / 6);
  return clamp01(hands * (0.25 + 0.75 * clamp01(r.water)) * (r.organized ? 1 : 0.7));
}

/** Intensidad del día siguiente de un edificio que arde: crece con el combustible que le queda, baja con el esfuerzo y la lluvia. */
export function nextIntensity(
  intensity: number,
  fuelLeft: number,
  effort: number,
  rainMm: number,
): number {
  const feed = clamp01(fuelLeft);
  const grown = intensity + 0.35 * feed * (1 - intensity) - 0.15 * (1 - feed);
  const damp = 1 - 0.7 * clamp01(effort) - Math.min(0.5, rainMm / 40);
  return clamp01(grown * Math.max(0, damp));
}

/** Gramos de un material que arden en un día con esta intensidad (el resto queda en pie). */
export function burnedGrams(grams: number, materialFuel: number, intensity: number): number {
  const burned = grams * clamp01(materialFuel / 1.4) * clamp01(intensity) * 0.5;
  return Math.min(grams, Math.max(0, Math.round(burned)));
}

/** De lo quemado, la parte que queda como ceniza; el resto sale como humo y gas (conservado al sumidero). */
export function ashShare(materialFuel: number): number {
  return 0.05 + 0.05 * clamp01(materialFuel / 1.4);
}

/** Derribar una casa para cortar el fuego: solo con respuesta organizada, fuego fuerte y al menos dos vecinos en riesgo. */
export function worthDemolishing(
  intensity: number,
  neighborsAtRisk: number,
  organized: boolean,
): boolean {
  return organized && intensity > 0.6 && neighborsAtRisk >= 2;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
