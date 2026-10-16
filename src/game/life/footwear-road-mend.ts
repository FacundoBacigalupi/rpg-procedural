// Arreglar el calzado de camino (npc-b2b3b2b3c, crafts, economy, travel): el viajero con un viaje
// abierto, fuera de la aldea, con el calzado gastado desde `WORN_AT` lo hace arreglar un día de
// estos en una posada o posta con un remendón ambulante, pagando de su bolsa. Es más caro que en
// la aldea (`ROAD_MARKUP`) y de peor mano (`ROAD_KEEPS`: el remiendo deja más desgaste); el
// remendón es de fuera de la simulación, así que el cobre sale por el ledger a `WAGES_SINK`.
// Opt-in (`LifeParts.npcRoadMend`, con `npcFootwearMend`): apagado no hay proceso, RNG ni eventos.
// No toca al jugador. Escribe `FOOTWEAR` junto a `life.footwear_mend` (en la aldea, él; en el
// camino, este: nunca la misma persona en los dos lugares el mismo día).

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
import {
  COBBLER,
  LEATHER_SCRAP,
  LEATHER_UNIT,
  leatherFor,
  levelAfterJob,
  mendKeeps,
} from "./cobbler.ts";
import { FOOTWEAR } from "./footwear.ts";
import { mendJob, wearAfterMend } from "./footwear-mend.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";

export const FOOTWEAR_ROAD_MEND_PROCESS = "life.footwear_road_mend";
export const FOOTWEAR_ROAD_MENDED = "footwear.road_mended";

/** Chance diaria de que el viajero con el calzado gastado dé con una posada o posta con remendón (sin calibrar). */
export const ROAD_MEND_CHANCE = 0.2;
/** Cuánto más caro sale arreglar de camino que en la aldea (sin calibrar). */
export const ROAD_MARKUP = 2;
/** Qué parte del desgaste queda tras un remiendo de camino (peor que en la aldea, 0,35). */
export const ROAD_KEEPS = 0.5;

/** El arreglo de camino y su costo, o null si todavía no hace falta. Puro. */
export function roadMendJob(wear: number): { kind: "mend" | "replace"; cost: number } | null {
  const job = mendJob(wear);
  return job ? { kind: job.kind, cost: job.cost * ROAD_MARKUP } : null;
}

/** Si el viajero paró a dormir en el último día: esa parada es donde hay posada o posta con remendón. Puro. */
export function atStop(rested: number | undefined, now: number): boolean {
  return rested !== undefined && now - rested < STOP_WINDOW;
}
/** Cuánto vale una parada para arreglar el calzado: un día (el proceso corre a diario). */
export const STOP_WINDOW = 86_400;

export interface FootwearRoadMendOptions {
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Solo en la parada de la noche: `rested` del viaje dentro del último día (`npcRoadStops`). */
  readonly atStops?: true;
  /**
   * Con `npcRoadCobbler`: si un zapatero (el de la aldea) está en el mismo hex que el viajero, arregla
   * él con su oficio y su cuero, al precio de la aldea y cobrando (npc-b2b3b2b3c2c).
   */
  readonly cobbler?: true;
}

/** Si el zapatero está donde el viajero (mismo hex, fuera de la aldea) y le alcanza el cuero. Puro. */
export function cobblerHere(
  traveler: { readonly hex: number },
  cobbler: { readonly hex: number; readonly inVillage: boolean; readonly leather: number },
  kind: "mend" | "replace",
): boolean {
  return !cobbler.inVillage && cobbler.hex === traveler.hex && cobbler.leather >= leatherFor(kind);
}

export function footwearRoadMendProcess(o: FootwearRoadMendOptions): ProcessDef {
  return {
    id: FOOTWEAR_ROAD_MEND_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: o.cobbler
      ? [FOOTWEAR.name, NPC_JOURNEY.name, PERSON.name, ENTITY.name, LOCATION.name, COBBLER.name]
      : [FOOTWEAR.name, NPC_JOURNEY.name, PERSON.name, ENTITY.name, LOCATION.name],
    writes: o.cobbler ? [FOOTWEAR.name, COBBLER.name] : [FOOTWEAR.name],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger) return {};
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const changes: StateChange[] = [];
      // Los zapateros vivos con su hex, cuero y oficio del día (se asientan al final del proceso).
      const shops = new Map<
        AgentId,
        { hex: number; inVillage: boolean; leather: number; level: number }
      >();
      if (o.cobbler) {
        for (const id of [...ctx.truth.ids(COBBLER)].sort()) {
          const c = id as AgentId;
          const loc = ctx.truth.get(LOCATION, c);
          if (c === o.player || loc === undefined) continue;
          if (ctx.truth.get(PERSON, c) === undefined) continue;
          if (ctx.truth.get(ENTITY, c)?.endedAt !== undefined) continue;
          shops.set(c, {
            hex: loc.hex,
            inVillage: loc.space !== undefined,
            leather: ledger.balance(holderAccount(c as unknown as HolderRef), LEATHER_UNIT),
            level: ctx.truth.get(COBBLER, c)?.level ?? 0,
          });
        }
      }
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
        const here = ctx.truth.get(LOCATION, who);
        const local = here
          ? [...shops.entries()].find(([, c]) => cobblerHere(here, c, job.kind))
          : undefined;
        if (local) {
          const [cid, shop] = local;
          const self = cid === who;
          const price = mendJob(wear)?.cost ?? job.cost;
          if (!self && Math.floor(ledger.balance(account, COPPER)) < price) continue;
          const need = leatherFor(job.kind);
          const cAccount = holderAccount(cid as unknown as HolderRef);
          const done = wearAfterMend(wear, job.kind, mendKeeps(shop.level));
          events.push({
            kind: FOOTWEAR_ROAD_MENDED,
            actors: self ? [who] : [who, cid],
            place: o.placeOf(ctx.truth, who),
            data: {
              job: job.kind,
              from: wear,
              to: done,
              paid: self ? 0 : price,
              cobbler: cid,
              level: shop.level,
              leather: need,
            },
            emissions: {},
            causes: [{ kind: "state", entity: who as unknown as EntityRef, key: FOOTWEAR.name }],
          });
          postings.push({
            event: draftEvent(events.length - 1),
            transfers: [
              {
                unit: LEATHER_UNIT,
                from: cAccount,
                to: externalAccount(LEATHER_SCRAP),
                amount: need,
              },
              ...(self ? [] : [{ unit: COPPER, from: account, to: cAccount, amount: price }]),
            ],
          });
          changes.push(setComponent(FOOTWEAR, who, { wear: done }));
          shop.leather -= need;
          shop.level = levelAfterJob(shop.level);
          changes.push(setComponent(COBBLER, cid, { level: shop.level }));
          continue;
        }
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
