// Cerrar las promesas de palabra (contracts §3, §7, §14): una vez por día se repasan las promesas
// que siguen abiertas (de dar, de favor y de callar). Si una parte murió, la promesa se cierra sin culpable (promitente
// muerto: imposible; destinatario muerto: dispensada). Pasados el plazo y la gracia
// (`isPledgeOverdue`), el promitente decide con `decideKeep` (costo, relación, sanción creída y la
// culpa de `pledgeGuilt` desde sus valores): si cumple y tiene con qué, entrega (un `action.give`
// de verdad, con conservación, que `life.pledge` toma como cualquier otro pago y cierra la promesa
// como cumplida); si cumple y no tiene con qué, queda imposible; si no cumple, queda rota. El
// personaje no decide acá: lo que no entregó a tiempo es una promesa rota, con la culpa que le
// toca por sus valores. Cada cierre es un evento con causa y las dos partes anotan el desenlace en
// su libro (`learnOutcome`). Favor: si quiere cumplir se da una semana más (hasta tres veces; el favor
// lo cierra `life.pledge` al verlo hecho); callar: pasado el plazo sin que se sepa que lo soltó, queda
// cumplida (soltarlo lo rompe en `life.pledge`).

import {
  type AgentId,
  type EventId,
  type HolderRef,
  holderAccount,
  type PlaceRef,
} from "../../core/index.ts";
import {
  type BondDef,
  type DimensionDef,
  decideKeep,
  draftEvent,
  ENTITY,
  type EventDraft,
  extendPledge,
  INNATE,
  isPledgeOverdue,
  learnOutcome,
  MIND,
  PERSON,
  PLEDGE,
  PLEDGE_BOOK,
  PLEDGE_MAX_EXTENSIONS,
  type Pledge,
  type PledgeBook,
  type PledgeStatus,
  type PostingDraft,
  type ProcessDef,
  pledgeGuilt,
  pledgeLeft,
  RELATIONS,
  type ReadonlyWorldTruth,
  relationship,
  resolvePledge,
  type SchemaDef,
  type StateChange,
  setComponent,
  type ValueDef,
  valuesOf,
  weightOfGive,
} from "../../sim/index.ts";

import { PLEDGE_BROKEN_EVENT, PLEDGE_KEPT_EVENT } from "./pledges.ts";

export const KEEP_PROCESS = "life.keep";
export const PLEDGE_RELEASED_EVENT = "contract.pledge_released";
export const PLEDGE_IMPOSSIBLE_EVENT = "contract.pledge_impossible";

export interface KeepOptions {
  readonly values: readonly ValueDef[];
  readonly schemas: readonly SchemaDef[];
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Lo que cuesta (y ahorra) una promesa de dar, en la escala de la utilidad: peso por esto. */
export const COST_SCALE = 0.5;
/** Valor mínimo de la relación aun entre desconocidos (la cara ante el vecino). */
export const RELATION_FLOOR = 0.05;
/** Chance creída de que se sepa que no cumplió, con la parte perjudicada sola y por testigo. */
export const DETECT_BASE = 0.6;
export const DETECT_PER_WITNESS = 0.1;
/** Sanción creída (reputación, rencor) base y por testigo. */
export const SANCTION_BASE = 0.2;
export const SANCTION_PER_WITNESS = 0.08;

/** Un estado final de la promesa y el evento que lo cuenta (con causa). */
function closing(
  id: string,
  p: Pledge,
  status: Exclude<PledgeStatus, "open">,
  kind: string,
  place: PlaceRef,
  key: string,
  data: Record<string, unknown>,
): { event: EventDraft; pledge: Pledge } {
  const origin = p.history[0];
  return {
    pledge: resolvePledge(p, status),
    event: {
      kind,
      actors: [p.promisor, p.promisee],
      place,
      data: { pledge: id, status, weight: p.weight, ...data },
      emissions: {},
      causes: [
        { kind: "state", entity: id as never, key },
        ...(origin ? [{ kind: "event" as const, event: origin as EventId }] : []),
      ],
    },
  };
}

export function keepProcess(o: KeepOptions): ProcessDef {
  return {
    id: KEEP_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "decide",
    reads: [
      PLEDGE.name,
      PLEDGE_BOOK.name,
      ENTITY.name,
      PERSON.name,
      MIND.name,
      INNATE.name,
      RELATIONS.name,
    ],
    writes: [PLEDGE.name, PLEDGE_BOOK.name],
    run(ctx) {
      const truth = ctx.truth;
      const ledger = ctx.ledger;
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const alive = (id: AgentId) => truth.get(ENTITY, id)?.endedAt === undefined;

      const books = new Map<AgentId, PledgeBook | undefined>();
      const learn = (id: string, p: Pledge, status: Exclude<PledgeStatus, "open">) => {
        for (const who of [p.promisor, p.promisee]) {
          const held = books.has(who) ? books.get(who) : truth.get(PLEDGE_BOOK, who);
          const book = learnOutcome(held, id, status, ctx.now);
          if (!book) continue;
          books.set(who, book);
          changes.push(setComponent(PLEDGE_BOOK, who, book));
        }
      };
      const close = (
        id: string,
        c: { event: EventDraft; pledge: Pledge },
        status: Exclude<PledgeStatus, "open">,
      ) => {
        changes.push(setComponent(PLEDGE, id as never, c.pledge));
        events.push(c.event);
        learn(id, c.pledge, status);
      };

      for (const id of [...truth.ids(PLEDGE)].sort()) {
        const p = truth.get(PLEDGE, id as never);
        if (!p || p.status !== "open") continue;
        const place = o.placeOf(truth, p.promisor);

        if (!alive(p.promisor)) {
          close(
            id,
            closing(id, p, "impossible", PLEDGE_IMPOSSIBLE_EVENT, place, "party_dead", {
              why: "promisor_dead",
            }),
            "impossible",
          );
          continue;
        }
        if (!alive(p.promisee)) {
          close(
            id,
            closing(id, p, "released", PLEDGE_RELEASED_EVENT, place, "party_dead", {
              why: "promisee_dead",
            }),
            "released",
          );
          continue;
        }
        if (!isPledgeOverdue(p, ctx.now)) continue;

        // Los valores y la relación de quien prometió, para la culpa y el valor de la cara.
        const mind = truth.get(MIND, p.promisor);
        const innate = truth.get(INNATE, p.promisor);
        const values =
          mind && innate && o.values.length > 0 ? valuesOf(o.values, o.schemas, mind, innate) : {};
        const rel = relationship(truth.get(RELATIONS, p.promisor), p.promisee, ctx.now, {
          dims: o.dims,
          bonds: o.bonds,
          schemaStrength: (s) => mind?.schemas[s]?.strength ?? 0,
        });
        const close_ =
          truth.get(PERSON, p.promisor)?.household === truth.get(PERSON, p.promisee)?.household ||
          rel.dims.affection > 0.5;
        // Callar: pasado el plazo sin que lo soltara, la cumplió (soltarlo la rompe en `life.pledge`).
        if (p.term.kind === "silence") {
          close(
            id,
            closing(id, p, "kept", PLEDGE_KEPT_EVENT, place, "overdue", {
              by: "silence",
              about: p.term.about,
            }),
            "kept",
          );
          continue;
        }
        const left = pledgeLeft(p);
        const harm = p.term.kind === "give" ? weightOfGive(left) : p.weight;
        const worth = harm * COST_SCALE;
        const guilt = pledgeGuilt(values, p, { close: close_, harm });
        const watchers = p.witnesses.length;
        const decision = decideKeep({
          cost: worth,
          saving: worth,
          relationValue: clamp01(
            RELATION_FLOOR + 0.5 * Math.max(0, rel.dims.affection) + 0.3 * rel.dims.familiarity,
          ),
          detect: clamp01(DETECT_BASE + DETECT_PER_WITNESS * watchers),
          sanction: SANCTION_BASE + SANCTION_PER_WITNESS * watchers,
          guilt,
        });
        const data = {
          ...(p.term.kind === "give" ? { grams: left } : { what: p.term.what }),
          guilt,
          uKeep: decision.uKeep,
          uBreak: decision.uBreak,
        };

        // Un favor no se entrega: si quiere hacerlo se da más tiempo (no más de unas veces).
        if (
          p.term.kind === "favor" &&
          p.promisor !== o.player &&
          decision.keep &&
          (p.extensions ?? 0) < PLEDGE_MAX_EXTENSIONS
        ) {
          changes.push(setComponent(PLEDGE, id as never, extendPledge(p, ctx.now)));
          continue;
        }
        if (p.promisor === o.player || !decision.keep || p.term.kind === "favor") {
          close(
            id,
            closing(id, p, "broken", PLEDGE_BROKEN_EVENT, place, "overdue", data),
            "broken",
          );
          continue;
        }

        // Quiere cumplir: entrega lo que falta del bolsillo o, si no alcanza, de la despensa.
        if (p.term.kind !== "give") continue;
        const unit = p.term.unit;
        const house = truth.get(PERSON, p.promisor)?.household;
        const sources = [
          holderAccount(p.promisor as unknown as HolderRef),
          ...(house ? [holderAccount(house as unknown as HolderRef)] : []),
        ];
        const from = ledger
          ? sources.find((a) => ledger.holdings(a).some((h) => h.unit === unit && h.amount >= left))
          : undefined;
        if (!from) {
          close(
            id,
            closing(id, p, "impossible", PLEDGE_IMPOSSIBLE_EVENT, place, "overdue", {
              ...data,
              why: "no_means",
            }),
            "impossible",
          );
          continue;
        }
        // El pago es un `give` más: `life.pledge` lo toma, cierra la promesa y cita este evento.
        events.push({
          kind: "action.give",
          actors: [p.promisor, p.promisee],
          place,
          data: { effect: { kind: "give", to: p.promisee, good: unit, grams: left }, pledge: id },
          emissions: { sight: 0.2 },
          causes: [{ kind: "state", entity: id as never, key: "overdue" }],
        });
        postings.push({
          event: draftEvent(events.length - 1),
          transfers: [
            { unit, from, to: holderAccount(p.promisee as unknown as HolderRef), amount: left },
          ],
        });
      }
      return changes.length === 0 && events.length === 0
        ? {}
        : { changes, events, ...(postings.length ? { postings } : {}) };
    },
  };
}
