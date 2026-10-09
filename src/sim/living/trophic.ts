// Poblaciones por celda con red trófica simple (living-world §8): la producción primaria entra a la
// cadena, cada población crece hasta que la comida, los depredadores o la caza la frenan (nadie tiene un
// tope escrito), y caza, pesca y recolección sacan individuos con rendimiento por esfuerzo que baja con
// el stock. Puro: un paso de `days` días sobre un estado, sin RNG (el azar de nacimientos va a los bordes).

import { exp } from "../../core/index.ts";

export interface Lineage {
  readonly id: string;
  readonly kingdom: "plant" | "herbivore" | "carnivore";
  /** Crecimiento máximo por día cuando sobra comida (fracción). */
  readonly growth: number;
  /** Mortalidad natural por día. */
  readonly mortality: number;
  /** Biomasa de un individuo (kg), para convertir presa en energía. */
  readonly bodyMass: number;
  /** De qué se alimenta: linaje -> preferencia 0-1. Las plantas se alimentan de la productividad (no tienen dieta). */
  readonly diet?: Readonly<Record<string, number>>;
  /** Presas por depredador por día al techo de la respuesta funcional. */
  readonly maxIntake: number;
  /** Densidad de presa (por celda) a la que come la mitad del techo. */
  readonly halfSaturation: number;
  /** Fracción de lo comido que se vuelve descendencia. */
  readonly efficiency: number;
}

export interface CellPopulation {
  readonly lineage: string;
  /** Individuos en la celda. */
  readonly count: number;
}

export interface CellEcology {
  /** Producción primaria del día (biomasa vegetal en kg por celda y día), de luz, temperatura, agua y suelo. */
  readonly productivity: number;
  /** Refugio 0-1: reduce la depredación (bosque denso). */
  readonly shelter: number;
  readonly populations: readonly CellPopulation[];
}

/** Kg de vegetación que come un herbívoro de 1 kg por día (metabolismo ~ masa). */
const FORAGE_PER_KG = 0.08;

/** Respuesta funcional saturante (Holling II): un depredador come más con más presa, hasta un techo. */
export function intakePerPredator(predator: Lineage, preyCount: number, shelter: number): number {
  const exposed = preyCount * (1 - 0.7 * Math.min(1, Math.max(0, shelter)));
  if (exposed <= 0) return 0;
  return (predator.maxIntake * exposed) / (predator.halfSaturation + exposed);
}

export interface TrophicStep {
  readonly next: CellEcology;
  /** Individuos muertos por depredación en el paso, por linaje de la presa (los depredadores se los llevan). */
  readonly eaten: Readonly<Record<string, number>>;
  /** Linajes que llegaron a cero en la celda en este paso (la extinción local lleva el evento con sus causas). */
  readonly extinct: readonly string[];
}

/**
 * Un paso de `days` días (conviene <= 5 para que la integración sea estable). Las plantas son un stock de
 * biomasa que rebrota con la productividad; los herbívoros comen de él; los carnívoros, de los herbívoros.
 */
export function trophicStep(
  cell: CellEcology,
  lineages: Readonly<Record<string, Lineage>>,
  days: number,
): TrophicStep {
  const counts: Record<string, number> = {};
  for (const p of cell.populations) counts[p.lineage] = p.count;
  const eaten: Record<string, number> = {};
  // Biomasa vegetal disponible: lo que produce la celda en el paso, repartido entre los herbívoros.
  let forage = cell.productivity * days;
  let demand = 0;
  for (const p of cell.populations) {
    const l = lineages[p.lineage];
    if (l?.kingdom === "herbivore") demand += p.count * l.bodyMass * FORAGE_PER_KG * days;
  }
  const fed = demand > 0 ? Math.min(1, forage / demand) : 1;
  forage = Math.max(0, forage - demand * fed);

  const next: Record<string, number> = { ...counts };
  // Depredación primero (sobre los conteos de entrada), para no depender del orden de las poblaciones.
  const kills: Record<string, number> = {};
  for (const p of cell.populations) {
    const l = lineages[p.lineage];
    if (!l || l.kingdom !== "carnivore" || !l.diet) continue;
    let weight = 0;
    for (const [prey, pref] of Object.entries(l.diet)) if ((counts[prey] ?? 0) > 0) weight += pref;
    if (weight <= 0) continue;
    for (const [prey, pref] of Object.entries(l.diet)) {
      const n = counts[prey] ?? 0;
      if (n <= 0) continue;
      const share = pref / weight;
      const take = Math.min(n, p.count * intakePerPredator(l, n, cell.shelter) * share * days);
      kills[prey] = (kills[prey] ?? 0) + take;
      const gain = (take * (lineages[prey]?.bodyMass ?? 1) * l.efficiency) / l.bodyMass;
      next[p.lineage] = (next[p.lineage] ?? 0) + gain;
    }
  }
  for (const [prey, k] of Object.entries(kills)) {
    const n = counts[prey] ?? 0;
    const capped = Math.min(n, k);
    eaten[prey] = capped;
    next[prey] = (next[prey] ?? 0) - capped;
  }
  // Nacimientos y muertes naturales: los herbívoros crecen según lo bien alimentados; los carnívoros solo mueren de hambre.
  for (const p of cell.populations) {
    const l = lineages[p.lineage];
    if (!l) continue;
    const n = next[p.lineage] ?? 0;
    let rate: number;
    if (l.kingdom === "herbivore") rate = l.growth * fed - l.mortality - (1 - fed) * 0.05;
    else if (l.kingdom === "plant") rate = 0;
    else {
      const prey = Object.keys(l.diet ?? {}).reduce((s, k) => s + (counts[k] ?? 0), 0);
      rate = prey > 0 ? -l.mortality : -l.mortality * 4;
    }
    next[p.lineage] = Math.max(0, n * exp(rate * days));
  }
  const populations: CellPopulation[] = [];
  const extinct: string[] = [];
  for (const p of cell.populations) {
    const n = next[p.lineage] ?? 0;
    // Menos de un individuo ya no es una población que se sostenga.
    if (n < 1 && p.count >= 1) extinct.push(p.lineage);
    else populations.push({ lineage: p.lineage, count: n < 1 ? 0 : n });
  }
  return { next: { ...cell, populations }, eaten, extinct };
}

/**
 * Cosecha de silvestres (caza, pesca, recolección, tala): `effort` horas-persona sobre `stock` individuos
 * con `catchability` (fracción del stock que una hora-persona alcanza). El rendimiento por hora baja con el
 * stock: el precio sube sin que nadie lo decida. Devuelve lo capturado y el stock que queda.
 */
export function harvestStock(
  stock: number,
  effort: number,
  catchability: number,
): { readonly caught: number; readonly left: number; readonly perHour: number } {
  if (stock <= 0 || effort <= 0) return { caught: 0, left: Math.max(0, stock), perHour: 0 };
  const caught = stock * (1 - exp(-catchability * effort));
  return { caught, left: stock - caught, perHour: caught / effort };
}
