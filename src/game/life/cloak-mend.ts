// Reponer la capa del viajero (npc-b2b3b2c2, crafts, economy): quien tiene la capa gastada o
// perdida (`CLOAK`) y está en la aldea la hace remendar o compra una nueva un día de estos,
// pagando de su bolsa. El pago sale por el ledger como cobre a `WAGES_SINK` (la tela y el trabajo
// del sastre de fuera de la simulación, como el calzado). Quien no tiene con qué pagar sigue con
// la capa como está. Opt-in (`LifeParts.npcCloakMend`, con `npcCloak`): apagado no hay proceso,
// RNG ni eventos. No toca al jugador. Único escritor de `CLOAK` fuera de `life.cloak_wear`.

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
import { CLOAK } from "./cloak.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";

export const CLOAK_MEND_PROCESS = "life.cloak_mend";
export const CLOAK_MENDED = "cloak.mended";

/** Desde qué desgaste de la capa se la hace arreglar (sin calibrar). */
export const CLOAK_WORN_AT = 0.6;
/** Desde qué desgaste ya no vale remendar: se compra capa nueva. */
export const CLOAK_REPLACE_AT = 0.9;
/** Chance diaria de que quien tiene la capa gastada vaya a arreglarla (sin calibrar). */
export const CLOAK_MEND_CHANCE = 0.3;
/** Cobre de un remiendo y de una capa nueva (con 40 monedas por persona al nacer la aldea; sin calibrar). */
export const CLOAK_MEND_COST = 2;
export const CLOAK_NEW_COST = 6;
/** Qué parte del desgaste queda tras remendar. */
export const CLOAK_MEND_KEEPS = 0.35;

/** Qué se hace con ese desgaste y cuánto cuesta, o null si todavía no hace falta. Puro. */
export function cloakJob(wear: number): { kind: "mend" | "replace"; cost: number } | null {
  if (!(wear >= CLOAK_WORN_AT)) return null;
  return wear >= CLOAK_REPLACE_AT
    ? { kind: "replace", cost: CLOAK_NEW_COST }
    : { kind: "mend", cost: CLOAK_MEND_COST };
}

/** El desgaste que queda tras el arreglo. Puro. */
export function cloakWearAfterMend(wear: number, kind: "mend" | "replace"): number {
  return kind === "replace" ? 0 : Math.round(wear * CLOAK_MEND_KEEPS * 1e6) / 1e6;
}

export interface CloakMendOptions {
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

export function cloakMendProcess(o: CloakMendOptions): ProcessDef {
  return {
    id: CLOAK_MEND_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [CLOAK.name, NPC_JOURNEY.name, PERSON.name, ENTITY.name, LOCATION.name],
    writes: [CLOAK.name],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger) return {};
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const changes: StateChange[] = [];
      for (const id of [...ctx.truth.ids(CLOAK)].sort()) {
        const who = id as AgentId;
        if (who === o.player) continue;
        if (ctx.truth.get(PERSON, who) === undefined) continue;
        if (ctx.truth.get(ENTITY, who)?.endedAt !== undefined) continue;
        // Solo se arregla en la aldea (un espacio del sitio) y sin viaje abierto.
        if (ctx.truth.get(LOCATION, who)?.space === undefined) continue;
        if (ctx.truth.get(NPC_JOURNEY, who) !== undefined) continue;
        const wear = ctx.truth.get(CLOAK, who)?.wear ?? 0;
        const job = cloakJob(wear);
        if (!job) continue;
        if (!ctx.rng.fork("cloakmend", who).stream().chance(CLOAK_MEND_CHANCE)) continue;
        const account = holderAccount(who as unknown as HolderRef);
        if (Math.floor(ledger.balance(account, COPPER)) < job.cost) continue;
        const k = events.length;
        const after = cloakWearAfterMend(wear, job.kind);
        events.push({
          kind: CLOAK_MENDED,
          actors: [who],
          place: o.placeOf(ctx.truth, who),
          data: { job: job.kind, from: wear, to: after, paid: job.cost },
          emissions: {},
          causes: [{ kind: "state", entity: who as unknown as EntityRef, key: CLOAK.name }],
        });
        postings.push({
          event: draftEvent(k),
          transfers: [
            { unit: COPPER, from: account, to: externalAccount(WAGES_SINK), amount: job.cost },
          ],
        });
        changes.push(setComponent(CLOAK, who, { wear: after }));
      }
      return events.length === 0 ? {} : { events, postings, changes };
    },
  };
}
