// Empeñar por decisión (contracts §5): el NPC que decidió `give:<prestamista>+pawn:<bien>`
// (`decide`, `pawnWant`) y está con ese prestamista le entrega el lote en prenda con el MISMO
// evento que el verbo (`action.give` con modo `pawn`, el lote pasa por el ledger de su bolsillo al
// del prestamista); `life.pawn_open` lo tasa con lo que ÉL cree y adelanta o devuelve el lote.
// Un intento por día por persona. Opt-in (`LifeParts.pawn.want`): apagado, sin filas ni eventos.

import {
  type AgentId,
  type HolderRef,
  holderAccount,
  type PlaceRef,
  type Tick,
} from "../../core/index.ts";
import {
  draftEvent,
  ENTITY,
  type GoodDef,
  goodUnit,
  LOCATION,
  type ProcessDef,
  type ReadonlyWorldTruth,
  setComponent,
  table,
} from "../../sim/index.ts";
import { NPC_DECISION } from "./decide.ts";

export const PAWN_DECIDE_PROCESS = "life.pawn_decide";

/** Cuándo ofreció una prenda por última vez (uno por día). */
export const PAWN_LOG = table<{ readonly at: Tick }>("life.pawn_log");

const DECISION_ID = /^give:(.+)\+pawn:(.+)$/;

export function pawnDecideProcess(o: {
  readonly goods: readonly GoodDef[];
  readonly day: number;
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}): ProcessDef {
  return {
    id: PAWN_DECIDE_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "act",
    reads: [NPC_DECISION.name, ENTITY.name, LOCATION.name, PAWN_LOG.name],
    writes: [PAWN_LOG.name],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      const ledger = ctx.ledger;
      if (!ledger || me === o.player || truth.get(ENTITY, me)?.endedAt !== undefined) return {};
      const decision = truth.get(NPC_DECISION, me);
      if (decision?.verb !== "give" || ctx.now - decision.at >= o.day) return {};
      const m = DECISION_ID.exec(decision.id);
      if (!m) return {};
      const broker = m[1] as AgentId;
      const last = truth.get(PAWN_LOG, me);
      if (last && ctx.now - last.at < o.day) return {};
      if (truth.get(ENTITY, broker)?.endedAt !== undefined || broker === me) return {};
      const here = truth.get(LOCATION, me);
      const there = truth.get(LOCATION, broker);
      if (!here || !there || here.hex !== there.hex || here.space !== there.space) return {};
      const good = o.goods.find((g) => g.name === m[2]);
      if (!good) return {};
      const unit = goodUnit(good);
      const grams = Math.floor(ledger.balance(holderAccount(me as unknown as HolderRef), unit));
      if (grams < 1) return {};
      return {
        changes: [setComponent(PAWN_LOG, me, { at: ctx.now })],
        events: [
          {
            kind: "action.give",
            actors: [me, broker],
            place: o.placeOf(truth, me),
            data: {
              manner: ["pawn"],
              decided: true,
              effect: { kind: "give", to: broker, good: unit, grams },
            },
            emissions: { sight: 0.3 },
            causes: [{ kind: "state", entity: me, key: "utility" }],
          },
        ],
        postings: [
          {
            event: draftEvent(0),
            transfers: [
              {
                unit,
                from: holderAccount(me as unknown as HolderRef),
                to: holderAccount(broker as unknown as HolderRef),
                amount: grams,
              },
            ],
          },
        ],
      };
    },
  };
}
