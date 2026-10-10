// Reconstrucción efectiva (settlements §7, §11), pura: el hogar que se quedó sin casa (o la aldea
// sin granero) la levanta de nuevo con la materia salvada de los escombros, que tiene el origen que
// ya tenía, y con su trabajo: lo que falta lo junta del monte y del campo, a razón de lo que carga
// un adulto por día (los vecinos ayudan menos). Qué levanta lo decidió `rebuildChoice` al caer:
// igual, mejor (más material y mejor oficio), distinto (más chico) u otro sitio. El proceso que lo
// aplica está en `game/life/upkeep.ts`.

import type { EventId } from "../../core/index.ts";
import type { RebuildChoice } from "./collapse.ts";
import type { BuildingComponent, MaterialLine } from "./tables.ts";

/** Gramos de materia que un adulto junta y acarrea en un día de trabajo (calibración abierta). */
export const GATHER_GRAMS_PER_ADULT_DAY = 40_000;
/** Cuánto rinde el día de un adulto vecino que ayuda, respecto de uno del hogar. */
export const NEIGHBOR_HELP = 0.25;
/** Cuántos vecinos ayudan a la vez como máximo. */
export const MAX_HELPERS = 4;
/** Días mínimos antes de que se levante algo (despejar, planear), aunque haya con qué. */
export const MIN_REBUILD_DAYS = 10;

/** Cuánto del original se levanta en cada caso (área y masa). */
export const REBUILD_SCALE: Readonly<Record<RebuildChoice, number>> = {
  same: 1,
  better: 1.15,
  different: 0.7,
  elsewhere: 1,
};

/** Cobre por kilo de materia comprada si el material no declara precio (calibración abierta). */
export const DEFAULT_MATERIAL_COPPER_PER_KG = 0.3;
/** Qué parte de las monedas del hogar está dispuesta a gastar en reconstruir (el resto es comida y reserva). */
export const REBUILD_SAVINGS_SHARE = 0.5;

/** Metros que se corre un edificio que se levanta en otro sitio. */
export const RELOCATE_M = 30;

/** Gramos que el trabajo reúne en `days` días: el hogar y los vecinos que ayudan. */
export function laborGrams(ownAdults: number, neighborAdults: number, days: number): number {
  const helpers = Math.min(MAX_HELPERS, Math.max(0, neighborAdults));
  return Math.max(0, (ownAdults + helpers * NEIGHBOR_HELP) * days * GATHER_GRAMS_PER_ADULT_DAY);
}

/** Cuántos gramos de `pricePerKg` compran `coins` monedas. */
export function gramsBought(coins: number, pricePerKg: number): number {
  return pricePerKg > 0 ? Math.max(0, Math.floor((coins / pricePerKg) * 1000)) : 0;
}

/** Cuántas monedas cuestan `grams` a `pricePerKg` (se redondea para arriba). */
export function coinsFor(grams: number, pricePerKg: number): number {
  return Math.ceil((Math.max(0, grams) / 1000) * pricePerKg);
}

/** Gramos de cada componente del nuevo (por su material principal y el área escalada). */
export function rebuildNeed(
  old: readonly BuildingComponent[],
  choice: RebuildChoice,
  gramsPerM2: (material: string) => number,
): { area: number; material: string; grams: number }[] {
  const scale = REBUILD_SCALE[choice];
  return old.map((c) => {
    const material = c.materials[0]?.material ?? "";
    const area = Math.round(c.area * scale * 100) / 100;
    return { area, material, grams: Math.round(area * gramsPerM2(material)) };
  });
}

export interface RebuildPlanInput {
  readonly old: readonly BuildingComponent[];
  readonly choice: RebuildChoice;
  readonly gramsPerM2: (material: string) => number;
  /** Materia salvada disponible por material (gramos). */
  readonly stock: ReadonlyMap<string, number>;
  /** Gramos que el trabajo alcanzó a juntar. */
  readonly labor: number;
  /** Monedas que el hogar gasta en comprar lo que el trabajo no junta (0 = ninguna) y precio por kilo de cada material. */
  readonly coins?: number;
  readonly pricePerKg?: (material: string) => number;
  /** El evento que levanta el edificio nuevo (origen de lo juntado de nuevo). */
  readonly built: EventId;
}

export interface RebuildPlan {
  readonly components: BuildingComponent[];
  /** Lo que sale del depósito de la aldea y lo que se junta de nuevo, por material. */
  readonly salvaged: ReadonlyMap<string, number>;
  readonly gathered: ReadonlyMap<string, number>;
  /** De lo juntado, lo que se compró con monedas (por material) y lo que costó: el trabajo va primero. */
  readonly bought: ReadonlyMap<string, number>;
  readonly coinsSpent: number;
}

/**
 * Arma el edificio nuevo, o `undefined` si todavía no alcanza: lo salvado no cubre y el trabajo
 * no llega a juntar el resto. Lo salvado conserva el origen del material viejo; lo nuevo, el del
 * evento de hoy. Los defectos del material salvado pasan, atenuados por cuánto del componente es
 * recuperado.
 */
export function planRebuild(i: RebuildPlanInput): RebuildPlan | undefined {
  const need = rebuildNeed(i.old, i.choice, i.gramsPerM2);
  const budget = new Map(i.stock);
  const salvaged = new Map<string, number>();
  const gathered = new Map<string, number>();
  let toGather = 0;
  const picks = need.map((n) => {
    const left = budget.get(n.material) ?? 0;
    const used = Math.min(left, n.grams);
    budget.set(n.material, left - used);
    if (used > 0) salvaged.set(n.material, (salvaged.get(n.material) ?? 0) + used);
    const fresh = n.grams - used;
    if (fresh > 0) gathered.set(n.material, (gathered.get(n.material) ?? 0) + fresh);
    toGather += fresh;
    return { ...n, used, fresh };
  });
  const price = i.pricePerKg ?? (() => DEFAULT_MATERIAL_COPPER_PER_KG);
  // Lo que el trabajo no junta se compra, de los materiales más baratos a los más caros, mientras alcance la plata.
  const bought = new Map<string, number>();
  let coinsLeft = Math.max(0, Math.floor(i.coins ?? 0));
  let coinsSpent = 0;
  if (toGather > i.labor) {
    let missing = toGather - i.labor;
    const order = [...gathered].sort((a, b) => price(a[0]) - price(b[0]) || (a[0] < b[0] ? -1 : 1));
    for (const [m, g] of order) {
      if (missing <= 0) break;
      const want = Math.min(g, missing);
      const afford = Math.min(want, gramsBought(coinsLeft, price(m)));
      if (afford <= 0) continue;
      const cost = coinsFor(afford, price(m));
      if (cost > coinsLeft) continue;
      coinsLeft -= cost;
      coinsSpent += cost;
      missing -= afford;
      bought.set(m, afford);
    }
    if (missing > 0) return undefined;
  }

  const components = i.old.map((c, idx): BuildingComponent => {
    const p = picks[idx] as (typeof picks)[number];
    const originOf = c.materials.find((l) => l.material === p.material)?.origin ?? i.built;
    const lines: MaterialLine[] = [];
    if (p.used > 0) lines.push({ material: p.material, grams: p.used, origin: originOf });
    if (p.fresh > 0) lines.push({ material: p.material, grams: p.fresh, origin: i.built });
    const reused = p.grams > 0 ? p.used / p.grams : 0;
    const quality =
      i.choice === "better"
        ? Math.min(1, c.quality + 0.15)
        : i.choice === "different"
          ? Math.max(0.2, c.quality - 0.1)
          : c.quality;
    return {
      part: c.part,
      area: p.area,
      materials: lines,
      condition: Math.round((0.9 + 0.1 * (1 - reused)) * 1000) / 1000,
      quality: Math.round(quality * 100) / 100,
      defects: c.defects.map((d) => ({
        ...d,
        severity: Math.round(d.severity * reused * 100) / 100,
      })),
    };
  });
  return { components, salvaged, gathered, bought, coinsSpent };
}
