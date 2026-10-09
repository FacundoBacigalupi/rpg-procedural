// Derrumbe con causa y reconstrucción (settlements §7, §11), puro: un edificio solo se cae si una
// parte está bajo su umbral de ruina Y una carga (lluvia, nieve, viento, sismo, peso) supera lo que
// esa parte aguanta con la condición que tiene. Sin carga no hay derrumbe por gastado que esté; sin
// gasto, la misma carga no lo tira. Qué se salva de los escombros y cómo eligen los sobrevivientes
// reconstruir. El proceso que lo aplica está en `game/life/upkeep.ts`.

import type { BuildingComponent } from "./tables.ts";

export type LoadCause = "rain" | "snow" | "wind" | "quake" | "weight";

/** Lo que el día carga sobre el edificio (todo en las unidades de abajo, 0 si no hay). */
export interface LoadInput {
  readonly rainMm: number;
  readonly snowMm: number;
  readonly windMs: number;
  /** Intensidad del sismo 0-1 (hoy ninguna fuente lo produce: 0). */
  readonly quake: number;
  /** Peso extra sobre el techo o los pisos, en unidades de carga (contenido, gente, escombro). */
  readonly weight: number;
}

/** Por debajo de esta condición una parte puede ceder (el cimiento aguanta más gastado). */
export const COLLAPSE_BELOW: Readonly<Record<BuildingComponent["part"], number>> = {
  roof: 0.25,
  walls: 0.18,
  foundation: 0.12,
  door: 0,
};

/** Cuánto pesa cada carga sobre cada parte (calibración abierta). */
const LOAD_ON: Readonly<Record<BuildingComponent["part"], Readonly<Record<LoadCause, number>>>> = {
  roof: { rain: 0.02, snow: 0.035, wind: 0.04, quake: 0.3, weight: 1 },
  walls: { rain: 0, snow: 0, wind: 0.03, quake: 1, weight: 0.4 },
  foundation: { rain: 0.004, snow: 0, wind: 0, quake: 0.8, weight: 0.5 },
  door: { rain: 0, snow: 0, wind: 0, quake: 0, weight: 0 },
};

/** La carga de cada tipo sobre una parte. */
export function loadsOn(
  part: BuildingComponent["part"],
  input: LoadInput,
): Record<LoadCause, number> {
  const k = LOAD_ON[part];
  return {
    rain: input.rainMm * k.rain,
    snow: input.snowMm * k.snow,
    wind: Math.max(0, input.windMs - 8) * k.wind,
    quake: input.quake * k.quake,
    weight: input.weight * k.weight,
  };
}

/** Cuánta carga aguanta una parte con esta condición. */
export function capacity(condition: number): number {
  return Math.max(0, condition) * 1.5;
}

export interface CollapseCheck {
  readonly part: BuildingComponent["part"];
  readonly cause: LoadCause;
  readonly load: number;
  readonly capacity: number;
  /** Chance de que ceda hoy, 0-1 (crece con lo que la carga pasa a lo que aguanta). */
  readonly risk: number;
}

/**
 * La parte más en riesgo: solo cuenta la que está bajo su umbral de ruina Y recibe más carga de la
 * que aguanta. La causa es la carga que más pesa. Sin parte así devuelve `undefined`.
 */
export function collapseCheck(
  components: readonly BuildingComponent[],
  input: LoadInput,
): CollapseCheck | undefined {
  let best: CollapseCheck | undefined;
  for (const c of components) {
    if (c.condition >= COLLAPSE_BELOW[c.part]) continue;
    const loads = loadsOn(c.part, input);
    const total = loads.rain + loads.snow + loads.wind + loads.quake + loads.weight;
    const cap = capacity(c.condition);
    if (total <= cap) continue;
    let cause: LoadCause = "weight";
    let top = -1;
    for (const key of ["rain", "snow", "wind", "quake", "weight"] as const) {
      if (loads[key] > top) {
        top = loads[key];
        cause = key;
      }
    }
    const risk = Math.min(1, (total - cap) * 2);
    if (!best || risk > best.risk) best = { part: c.part, cause, load: total, capacity: cap, risk };
  }
  return best;
}

/** Los gramos que se salvan de los escombros: lo menos podrido, y menos si cayó de golpe (sismo). */
export function salvagedGrams(grams: number, condition: number, quake: boolean): number {
  const share = (0.15 + 0.55 * Math.min(1, Math.max(0, condition))) * (quake ? 0.6 : 1);
  return Math.min(grams, Math.max(0, Math.round(grams * share)));
}

export const REBUILD_CHOICES = ["same", "better", "different", "elsewhere"] as const;
export type RebuildChoice = (typeof REBUILD_CHOICES)[number];

export interface RebuildInput {
  /** Gramos de materia que cuesta rehacerlo igual. */
  readonly neededGrams: number;
  /** Gramos salvados de los escombros. */
  readonly salvagedGrams: number;
  /** Gramos que el hogar puede juntar (ahorros) y los que le da la ayuda (vecinos, organización). */
  readonly savingsGrams: number;
  readonly helpGrams: number;
  /** El sitio no es seguro: la causa fue un sismo o un deslizamiento. */
  readonly siteUnsafe: boolean;
}

/**
 * Qué eligen los sobrevivientes: en otro lugar si el sitio mató al edificio; mejor si les sobra
 * (un cuarto más de lo que cuesta); igual si les alcanza; distinto (más chico o de otro material)
 * si no. Nunca sin materia: sin con qué, igual elige "different" y lo hace con lo que haya.
 */
export function rebuildChoice(input: RebuildInput): RebuildChoice {
  if (input.siteUnsafe) return "elsewhere";
  const means = input.salvagedGrams + input.savingsGrams + input.helpGrams;
  if (means >= input.neededGrams * 1.25) return "better";
  if (means >= input.neededGrams) return "same";
  return "different";
}
