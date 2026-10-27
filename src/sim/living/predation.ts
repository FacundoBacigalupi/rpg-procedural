// Los depredadores del monte bajan a los corrales (livestock-predators, living-world §8 y §12): el
// hambre de cada población que asalta (`LineageDef.raid`) sale de lo que la celda le deja comer
// (`predatorHunger`, la misma respuesta funcional de `trophic.ts`); con hambre, cada individuo hace
// `raid.perDay` asaltos por día y cada asalto se lleva un animal de la aldea que pueda cargar
// (`raid.maxPreyKg`, con la masa que tiene a su edad), elegido según lo expuesto que está
// (`LivestockDef.exposure`). El animal muere sin cuerpo para el hogar (se lo comen), con un evento
// `living.animal_taken` causado por la ecología de la celda. Lo comido todavía no engorda a la
// población del monte (queda para livestock-predators-credit), y el perro que cuida, el corral
// cerrado y la caza de lobos por la gente quedan para livestock-predators-guard.

import type { AnimalId, Duration } from "../../core/index.ts";
import {
  deleteComponent,
  draftEvent,
  type EventDraft,
  endEntity,
  type ProcessDef,
  type StateChange,
} from "../scheduler/index.ts";
import { ENTITY, LOCATION } from "../world/index.ts";
import { ECOLOGY, type LineageDef, lineageOf } from "./ecology.ts";
import { ANIMAL, ANIMAL_HUNGER, type AnimalRecord, type LivestockDef } from "./livestock.ts";
import { type CellEcology, intakePerPredator, type Lineage } from "./trophic.ts";

export const LIVESTOCK_PREDATION_PROCESS = "living.livestock_predation";

/**
 * Pura: el hambre (0-1) de un depredador en la celda: lo que le falta para el techo de su respuesta
 * funcional con las presas silvestres que hay (repartidas por su dieta, como en `trophicStep`).
 */
export function predatorHunger(
  predator: Lineage,
  cell: CellEcology,
  lineages: Readonly<Record<string, Lineage>>,
): number {
  if (predator.maxIntake <= 0 || !predator.diet) return 0;
  const counts = new Map(cell.populations.map((p) => [p.lineage, p.count]));
  let weight = 0;
  for (const [prey, pref] of Object.entries(predator.diet)) {
    if ((counts.get(prey) ?? 0) > 0 && lineages[prey]) weight += pref;
  }
  if (weight <= 0) return 1;
  let intake = 0;
  for (const [prey, pref] of Object.entries(predator.diet)) {
    const n = counts.get(prey) ?? 0;
    if (n <= 0 || !lineages[prey]) continue;
    intake += intakePerPredator(predator, n, cell.shelter) * (pref / weight);
  }
  return Math.min(1, Math.max(0, 1 - intake / predator.maxIntake));
}

/** Pura: la masa (kg) del animal a su edad: crece lineal hasta la madurez desde un décimo. */
export function animalMassKg(def: LivestockDef, ageYears: number): number {
  const grown = Math.min(1, Math.max(0.1, ageYears / (def.breeding?.maturityYears ?? 1)));
  return def.massKg * grown;
}

export interface LivestockPredationOptions {
  readonly species: readonly LivestockDef[];
  /** Los linajes del monte (`content/lineages`); asaltan los que tienen `raid`. */
  readonly lineages: readonly LineageDef[];
  /** Duración del año (ticks), para la edad. */
  readonly year: Duration;
  /** Duración del día (ticks), para los asaltos por paso. */
  readonly day: Duration;
}

/**
 * Cada día: por cada linaje que asalta y vive en la celda de la aldea (por id), los asaltos del paso
 * (`count · perDay · hambre · paso/día`: la parte entera y la fracción como chance, con su rama del
 * rng) se llevan cada uno un animal vivo que pueda cargar, elegido con peso `exposure`. Corre en la
 * fase `physics`, antes de que el ganado coma, pare o muera de viejo en `settle`.
 */
export function livestockPredationProcess(o: LivestockPredationOptions): ProcessDef {
  const byId = new Map(o.species.map((s) => [s.id, s]));
  const lineages = Object.fromEntries(o.lineages.map((d) => [d.id, lineageOf(d)]));
  const raiders = o.lineages
    .filter((d) => d.raid !== undefined)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    id: LIVESTOCK_PREDATION_PROCESS,
    system: "living",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "physics",
    reads: [ANIMAL.name, ENTITY.name, ECOLOGY.name, ANIMAL_HUNGER.name],
    writes: [ENTITY.name, LOCATION.name, ANIMAL_HUNGER.name],
    scopeGuard: (truth) =>
      raiders.length > 0 && truth.ids(ANIMAL).length > 0 && truth.ids(ECOLOGY).length > 0,
    run(ctx) {
      const [ecoId] = ctx.truth.ids(ECOLOGY);
      const eco = ecoId === undefined ? undefined : ctx.truth.get(ECOLOGY, ecoId);
      if (ecoId === undefined || !eco) return {};
      const step = ctx.window > 0 ? ctx.window : 1;
      const alive: [AnimalId, AnimalRecord, LivestockDef][] = [];
      for (const id of [...ctx.truth.ids(ANIMAL)].sort() as AnimalId[]) {
        const a = ctx.truth.get(ANIMAL, id);
        const def = a ? byId.get(a.species) : undefined;
        if (a && def && ctx.truth.get(ENTITY, id)?.endedAt === undefined) alive.push([id, a, def]);
      }
      const taken = new Set<AnimalId>();
      const events: EventDraft[] = [];
      const changes: StateChange[] = [];
      for (const d of raiders) {
        const raid = d.raid;
        const l = lineages[d.id];
        const count = eco.cell.populations.find((p) => p.lineage === d.id)?.count ?? 0;
        if (!raid || !l || count < 1) continue;
        const hunger = predatorHunger(l, eco.cell, lineages);
        const expected = (count * raid.perDay * hunger * step) / o.day;
        if (expected <= 0) continue;
        const r = ctx.rng.fork("raid", d.id).stream();
        const whole = Math.floor(expected);
        const raids = whole + (r.float() < expected - whole ? 1 : 0);
        for (let k = 0; k < raids; k++) {
          const prey = alive.filter(
            ([id, a, def]) =>
              !taken.has(id) &&
              def.exposure > 0 &&
              animalMassKg(def, (ctx.now - a.bornAt) / o.year) <= raid.maxPreyKg,
          );
          const total = prey.reduce((s, [, , def]) => s + def.exposure, 0);
          if (total <= 0) break;
          let pick = r.float() * total;
          const chosen = prey.find(([, , def]) => (pick -= def.exposure) < 0) ?? prey.at(-1);
          if (!chosen) break;
          const [id, a] = chosen;
          const base = ctx.truth.get(ENTITY, id);
          if (!base) continue;
          taken.add(id);
          const end = draftEvent(events.length);
          events.push({
            kind: "living.animal_taken",
            actors: [],
            place: { kind: "building", building: a.home },
            data: { animal: id, species: a.species, owner: a.owner, predator: d.id },
            causes: [{ kind: "state", entity: ecoId as never, key: "ecology" }],
            emissions: null,
          });
          changes.push(endEntity(base, end, ctx.now), deleteComponent(LOCATION, id));
          if (ctx.truth.get(ANIMAL_HUNGER, id)) changes.push(deleteComponent(ANIMAL_HUNGER, id));
        }
      }
      if (events.length === 0) return {};
      return { events, changes };
    },
  };
}
