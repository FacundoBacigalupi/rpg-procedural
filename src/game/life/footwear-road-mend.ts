// Arreglar el calzado de camino (npc-b2b3b2b3c, crafts, economy, travel): el viajero con un viaje
// abierto, fuera de la aldea, con el calzado gastado desde `WORN_AT` lo hace arreglar un d√≠a de
// estos en una posada o posta con un remend√≥n ambulante, pagando de su bolsa. Es m√°s caro que en
// la aldea (`ROAD_MARKUP`) y de peor mano (`ROAD_KEEPS`: el remiendo deja m√°s desgaste); el
// remend√≥n es de fuera de la simulaci√≥n, as√≠ que el cobre sale por el ledger a `WAGES_SINK`.
// Opt-in (`LifeParts.npcRoadMend`, con `npcFootwearMend`): apagado no hay proceso, RNG ni eventos.
// No toca al jugador. Escribe `FOOTWEAR` junto a `life.footwear_mend` (en la aldea, √©l; en el
// camino, este: nunca la misma persona en los dos lugares el mismo d√≠a).

import {
  type AgentId,
  type EntityRef,
  externalAccount,
  type HolderRef,
  holderAccount,
  type PlaceRef,
} from "../../core/index.ts";
import {
  COPPER,
  draftEvent,
  ENTITY,
  type EventDraft,
  LOCATION,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  WAGES_SINK,
} from "../../sim/index.ts";
import { FOOTWEAR } from "./footwear.ts";
import { mendJob, wearAfterMend } from "./footwear-mend.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";

export const FOOTWEAR_ROAD_MEND_PROCESS = "life.footwear_road_mend";
export const FOOTWEAR_ROAD_MENDED = "footwear.road_mended";

/** Chance diaria de que el viajero con el calzado gastado d√© con una posada o posta con remend√≥n (sin calibrar). */
export const ROAD_MEND_CHANCE = 0.2;
/** Cu√°nto m√°s caro sale arreglar de camino que en la aldea (sin calibrar). */
export const ROAD_MARKUP = 2;
/** Qu√© parte del desgaste queda tras un remiendo de camino (peor que en la aldea, 0,35). */
export const ROAD_KEEPS = 0.5;

/** El arreglo de camino y su costo, o null si todav√≠a no hace falta. Puro. */
export function roadMendJob(wear: number): { kind: "mend" | "replace"; cost: number } | null {
  const job = mendJob(wear);
  return job ? { kind: job.kind, cost: job.cost * ROAD_MARKUP } : null;
}

/** Si el viajero parÛ a dormir en el ˙ltimo dÌa: esa parada es donde hay posada o posta con remendÛn. Puro. */
export function atStop(rested: number | undefined, now: number): boolean {
  return rested !== undefined && now - rested < STOP_WINDOW;
}
/** Cu·nto vale una parada para arreglar el calzado: un dÌa (el proceso corre a diario). */
export const STOP_WINDOW = 86_400;

export interface FootwearRoadMendOptions {
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Solo en la parada de la noche: `rested` del viaje dentro del ˙ltimo dÌa (`npcRoadStops`). */
  readonly atStops?: true;
}

export function footwearRoadMendProcess(o: FootwearRoadMendOptions): ProcessDef {
  return {
    id: FOOTWEAR_ROAD_MEND_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [FOOTWEAR.name, NPC_JOURNEY.name, PERSON.name, ENTITY.name, LOCATION.name],
    writes: [FOOTWEAR.name],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger) return {};
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const changes: StateChange[] = [];
      for (const id of [...ctx.truth.ids(FOOTWEAR)].sort()) {
        const who = id as AgentId;
        if (who === o.player) continue;
        if (ctx.truth.get(PERSON, who) === undefined) continue;
        if (ctx.truth.get(ENTITY, who)?.endedAt !== undefined) continue;
        // Solo de camino: con un viaje abierto y fuera de la aldea.
        const trip = ctx.truth.get(NPC_JOURNEY, who);
        if (trip === undefined) continue;
        if (o.atStops && !atStop(trip.rested, ctx.now)) continue;
        if (ctx.truth.get(LOCATION, who)?.space !== undefined) continue;
        const wear = ctx.truth.get(FOOTWEAR, who)?.wear ?? 0;
        const job = roadMendJob(wear);
        if (!job) continue;
        if (!ctx.rng.fork("roadmend", who).stream().chance(ROAD_MEND_CHANCE)) continue;
        const account = holderAccount(who as unknown as HolderRef);
        if (Math.floor(ledger.balance(account, COPPER)) < job.cost) continue;
        const after = wearAfterMend(wear, job.kind, ROAD_KEEPS);
        events.push({
          kind: FOOTWEAR_ROAD_MENDED,
          actors: [who],
          place: o.placeOf(ctx.truth, who),
          data: { job: job.kind, from: wear, to: after, paid: job.cost },
          emissions: {},
          causes: [{ kind: "state", entity: who as unknown as EntityRef, key: FOOTWEAR.name }],
        });
        postings.push({
          event: draftEvent(events.length - 1),
          transfers: [
            { unit: COPPER, from: account, to: externalAccount(WAGES_SINK), amount: job.cost },
          ],
        });
        changes.push(setComponent(FOOTWEAR, who, { wear: after }));
      }
      return events.length === 0 ? {} : { events, postings, changes };
    },
  };
}
