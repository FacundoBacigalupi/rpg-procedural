// La ropa de cada uno como prendas (body-health §7, clothing-garments): quien no tiene fila en
// `WARDROBE` tiene el juego básico de la aldea entero (las prendas `basic` del contenido); con fila,
// tiene esas prendas con su desgaste. Cada paso térmico se pone lo que pide el aire que ve
// (`seasonalClothing`) con lo que tiene (`chooseGarments`), y el abrigo es el de esas prendas
// (`dressed`): si no le alcanza, pasa frío. Opt-in (`LifeOptions.wardrobe`); apagado, la ropa es la
// de siempre (`seasonalClothing`). El único escritor de `WARDROBE` es `life.wardrobe_wear`
// (clothing-wear): cada día gasta lo que cada uno se puso; la compra y el oficio vienen después.

import type { AgentId, PlaceRef, Tick } from "../../core/index.ts";
import {
  BODY_STATE,
  type Clothing,
  chooseGarments,
  dressed,
  ENTITY,
  type EventDraft,
  type GarmentDef,
  type OwnedGarment,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  table,
  wornGarment,
} from "../../sim/index.ts";
import { seasonalClothing } from "./thermal.ts";

/** Una prenda que tiene alguien: el tipo (id del contenido) y su desgaste (0 entera, 1 deshecha). */
export interface WardrobeItem {
  readonly garment: string;
  readonly wear: number;
}

/** Las prendas de alguien. Sin fila, tiene el juego básico entero. */
export interface Wardrobe {
  readonly items: readonly WardrobeItem[];
}
export const WARDROBE = table<Wardrobe>("life.wardrobe");

/** Las prendas que tiene `who` (las de un tipo que el contenido no conoce se ignoran). */
export function wardrobeOf(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  garments: readonly GarmentDef[],
): OwnedGarment[] {
  const row = truth.get(WARDROBE, who);
  if (!row) return garments.filter((g) => g.basic).map((def) => ({ def, wear: 0 }));
  const byId = new Map(garments.map((g) => [g.id, g]));
  return row.items.flatMap((i) => {
    const def = byId.get(i.garment);
    return def ? [{ def, wear: i.wear }] : [];
  });
}

/** La ropa que se pone quien tiene `owned` con el aire en `airC`. */
export function wardrobeClothing(owned: readonly OwnedGarment[], airC: number): Clothing {
  return dressed(chooseGarments(owned, seasonalClothing(airC).clo).map(wornGarment));
}

// ---------------------------------------------------------------------------------------------
// El desgaste (clothing-wear).

export const WARDROBE_WEAR_PROCESS = "life.wardrobe_wear";
export const GARMENT_WORN_OUT = "garment.worn_out";
/** Cuánto más gasta quien trabaja (desde la edad de trabajo) la ropa de abajo, los pies y las manos. */
export const WORK_WEAR = 1.5;
/** Cuánto más gasta el calzado un día de camino. */
export const ROAD_WEAR = 2;
const WORK_SLOTS: ReadonlySet<GarmentDef["slot"]> = new Set(["base", "feet", "hands"]);

const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** El desgaste que suma un día puesta: `1 / wearDays`, más con trabajo y, el calzado, en camino. */
export function garmentDayWear(def: GarmentDef, work: boolean, road: boolean): number {
  const k =
    (work && WORK_SLOTS.has(def.slot) ? WORK_WEAR : 1) *
    (road && def.slot === "feet" ? ROAD_WEAR : 1);
  return k / def.wearDays;
}

/**
 * Las prendas tras un día (puro): las que se puso para `airC` suman su desgaste del día; las demás
 * quedan igual. Devuelve las nuevas y cuáles se deshicieron hoy.
 */
export function wearDay(
  owned: readonly OwnedGarment[],
  airC: number,
  work: boolean,
  road: boolean,
): { items: WardrobeItem[]; wornOut: string[] } {
  const worn = new Set(chooseGarments(owned, seasonalClothing(airC).clo));
  const wornOut: string[] = [];
  const items = owned.map((g) => {
    if (!worn.has(g)) return { garment: g.def.id, wear: g.wear };
    const wear = round(Math.min(1, g.wear + garmentDayWear(g.def, work, road)));
    if (wear >= 1 && g.wear < 1) wornOut.push(g.def.id);
    return { garment: g.def.id, wear };
  });
  return { items, wornOut };
}

export interface WardrobeWearOptions {
  readonly garments: readonly GarmentDef[];
  /** Años de la edad de trabajo (`ROUTINE.workAge`). */
  readonly workAge: number;
  readonly year: number;
  /** El aire de afuera en ese instante, para elegir lo que se pone el día. */
  readonly airC: (now: Tick) => number;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Si está de viaje (con `npcJourneyDays`): el calzado se gasta más. */
  readonly onRoad?: {
    readonly reads: readonly string[];
    readonly is: (t: ReadonlyWorldTruth, who: AgentId) => boolean;
  };
}

/**
 * Cada día, cada persona viva gasta las prendas que se pone para el aire del día (la base siempre;
 * el resto según el frío). La primera vez escribe su fila desde el juego básico. Una prenda que se
 * deshace queda en la fila (no se pone más) con un evento cuyo causa es el guardarropa.
 */
export function wardrobeWearProcess(o: WardrobeWearOptions): ProcessDef {
  return {
    id: WARDROBE_WEAR_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [WARDROBE.name, PERSON.name, ENTITY.name, BODY_STATE.name, ...(o.onRoad?.reads ?? [])],
    writes: [WARDROBE.name],
    run(ctx) {
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const airC = o.airC(ctx.now);
      for (const id of [...ctx.truth.ids(PERSON)].sort()) {
        const who = id as AgentId;
        const p = ctx.truth.get(PERSON, who);
        if (!p || ctx.truth.get(ENTITY, who)?.endedAt !== undefined) continue;
        if (ctx.truth.get(BODY_STATE, who)?.death) continue;
        const owned = wardrobeOf(ctx.truth, who, o.garments);
        if (owned.length === 0) continue;
        const work = (ctx.now - p.born) / o.year >= o.workAge;
        const road = o.onRoad?.is(ctx.truth, who) === true;
        const { items, wornOut } = wearDay(owned, airC, work, road);
        changes.push(setComponent(WARDROBE, who, { items }));
        for (const garment of wornOut) {
          events.push({
            kind: GARMENT_WORN_OUT,
            actors: [who],
            place: o.placeOf(ctx.truth, who),
            data: { garment },
            emissions: {},
            causes: [{ kind: "state", entity: who as never, key: WARDROBE.name }],
          });
        }
      }
      return changes.length === 0 ? {} : { events, changes };
    },
  };
}
