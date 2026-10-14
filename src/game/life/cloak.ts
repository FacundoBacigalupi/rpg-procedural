// Abrigo del viajero (npc-b2b3b2c, travel §11, body-health §7): quien sale de viaje se viste para
// el aire que ve al partir y lleva, si lo tiene, una capa para lo que venga (noche, cambio de
// tiempo, altura). En el camino el aire puede bajar de lo esperado: con la capa se cubre hasta lo
// que hace falta; sin ella queda con la ropa de la salida, y eso pesa en el núcleo (`life.thermal`).
// Si hace más calor que a la salida se quita capas, como siempre. La capa se gasta con los días de
// camino y cuando se acaba se pierde (evento con causa). Opt-in (`LifeOptions.npcCloak`, con
// `npcJourneyDays`): apagado, la ropa es la de siempre (para el aire de donde está). Puro salvo el
// proceso de desgaste, único escritor de `CLOAK`.

import type { AgentId, PlaceRef } from "../../core/index.ts";
import {
  type Clothing,
  ENTITY,
  type EventDraft,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  table,
} from "../../sim/index.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";
import { clothingForClo, seasonalClothing } from "./thermal.ts";

/** Qué tan gastada está la capa de alguien (0 entera, 1 perdida). Sin fila, la lleva entera. */
export interface Cloak {
  readonly wear: number;
}
export const CLOAK = table<Cloak>("life.cloak");

export const CLOAK_WEAR_PROCESS = "life.cloak_wear";
export const CLOAK_LOST = "cloak.lost";

/** Aislamiento (clo) que suma la capa entera (sin calibrar). */
export const CLOAK_CLO = 1;
/** Días de camino hasta que la capa se pierde o se rompe (sin calibrar). */
export const CLOAK_ROAD_DAYS = 40;

const round = (x: number) => Math.round(x * 1e6) / 1e6;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Cuánto abrigo da una capa con ese desgaste (`undefined`: entera). */
export function cloakClo(wear: number | undefined): number {
  return round(CLOAK_CLO * (1 - clamp01(wear ?? 0)));
}

/** El desgaste tras `days` días de camino. */
export function cloakWearAfter(wear: number, days: number): number {
  if (!(days > 0) || !Number.isFinite(days)) return round(clamp01(wear));
  return round(clamp01(wear + days / CLOAK_ROAD_DAYS));
}

/**
 * La ropa de quien está de viaje (puro): con el aire en `airC`, vestido a la salida para `dressedC`
 * y con `cloak` clo de capa. Más cálido que a la salida, se viste para el aire de ahora; más frío,
 * suma la capa a lo que ya llevaba sin pasar de lo que hace falta.
 */
export function roadClothing(airC: number, dressedC: number, cloak: number): Clothing {
  const needed = seasonalClothing(airC);
  if (airC >= dressedC) return needed;
  const worn = seasonalClothing(dressedC).clo;
  return clothingForClo(Math.min(needed.clo, worn + Math.max(0, cloak)));
}

export interface CloakWearOptions {
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Cada día de viaje gasta la capa de quien está en camino; al acabarse se pierde. */
export function cloakWearProcess(o: CloakWearOptions): ProcessDef {
  return {
    id: CLOAK_WEAR_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [CLOAK.name, NPC_JOURNEY.name, PERSON.name, ENTITY.name],
    writes: [CLOAK.name],
    run(ctx) {
      const events: EventDraft[] = [];
      const changes: StateChange[] = [];
      for (const id of [...ctx.truth.ids(NPC_JOURNEY)].sort()) {
        const who = id as AgentId;
        if (ctx.truth.get(PERSON, who) === undefined) continue;
        if (ctx.truth.get(ENTITY, who)?.endedAt !== undefined) continue;
        const had = ctx.truth.get(CLOAK, who)?.wear ?? 0;
        if (had >= 1) continue;
        const wear = cloakWearAfter(had, 1);
        changes.push(setComponent(CLOAK, who, { wear }));
        if (wear >= 1) {
          events.push({
            kind: CLOAK_LOST,
            actors: [who],
            place: o.placeOf(ctx.truth, who),
            data: { from: had },
            emissions: {},
            causes: [{ kind: "state", entity: who as never, key: CLOAK.name }],
          });
        }
      }
      return changes.length === 0 ? {} : { events, changes };
    },
  };
}
