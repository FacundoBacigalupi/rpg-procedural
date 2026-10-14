// Remendar o cambiar el calzado gastado (npc-b2b3b2b, crafts, economy): quien tiene el calzado
// gastado más allá de `WORN_AT` y está en la aldea lo hace arreglar un día de estos, pagando de su
// bolsa: remendar (barato, quita parte del desgaste) o, si ya está destrozado, comprar par nuevo
// (desgaste 0). El pago sale por el ledger como cobre a `WAGES_SINK` (el cuero y el trabajo del
// zapatero de fuera de la simulación: no hay oficio de calzado entre los NPC todavía); quien no
// tiene con qué pagar sigue con el calzado como está. Opt-in (`LifeParts.npcFootwearMend`, con
// `npcFootwear`): apagado no hay proceso, RNG ni eventos. No toca al jugador (él decide lo suyo).
// Único escritor de `FOOTWEAR` fuera de `life.act`.

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
import { FOOTWEAR, WORN_AT } from "./footwear.ts";

export const FOOTWEAR_MEND_PROCESS = "life.footwear_mend";
export const FOOTWEAR_MENDED = "footwear.mended";

/** Chance diaria de que quien tiene el calzado gastado vaya a arreglarlo (sin calibrar). */
export const MEND_CHANCE = 0.3;
/** Desde qué desgaste ya no vale remendar: se compra par nuevo. */
export const REPLACE_AT = 0.9;
/** Cobre de un remiendo y de un par nuevo (con 40 monedas por persona al nacer la aldea; sin calibrar). */
export const MEND_COST = 2;
export const NEW_PAIR_COST = 8;
/** Qué parte del desgaste queda tras remendar. */
export const MEND_KEEPS = 0.35;

/** Qué se hace con ese desgaste y cuánto cuesta, o null si todavía no hace falta. Puro. */
export function mendJob(wear: number): { kind: "mend" | "replace"; cost: number } | null {
  if (!(wear >= WORN_AT)) return null;
  return wear >= REPLACE_AT
    ? { kind: "replace", cost: NEW_PAIR_COST }
    : { kind: "mend", cost: MEND_COST };
}

/** El desgaste que queda tras el arreglo. Puro. */
export function wearAfterMend(wear: number, kind: "mend" | "replace"): number {
  return kind === "replace" ? 0 : Math.round(wear * MEND_KEEPS * 1e6) / 1e6;
}

export interface FootwearMendOptions {
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

export function footwearMendProcess(o: FootwearMendOptions): ProcessDef {
  return {
    id: FOOTWEAR_MEND_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [FOOTWEAR.name, PERSON.name, ENTITY.name, LOCATION.name],
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
        // Solo se arregla en la aldea (un espacio del sitio), no a campo traviesa.
        if (ctx.truth.get(LOCATION, who)?.space === undefined) continue;
        const wear = ctx.truth.get(FOOTWEAR, who)?.wear ?? 0;
        const job = mendJob(wear);
        if (!job) continue;
        if (!ctx.rng.fork("mend", who).stream().chance(MEND_CHANCE)) continue;
        const account = holderAccount(who as unknown as HolderRef);
        if (Math.floor(ledger.balance(account, COPPER)) < job.cost) continue;
        const k = events.length;
        const after = wearAfterMend(wear, job.kind);
        events.push({
          kind: FOOTWEAR_MENDED,
          actors: [who],
          place: o.placeOf(ctx.truth, who),
          data: { job: job.kind, from: wear, to: after, paid: job.cost },
          emissions: {},
          causes: [{ kind: "state", entity: who as unknown as EntityRef, key: FOOTWEAR.name }],
        });
        postings.push({
          event: draftEvent(k),
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
