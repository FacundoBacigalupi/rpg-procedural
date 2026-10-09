// Las promesas de palabra en la aldea (contracts §3, §4; dialogue §8): cuando el oyente toma por
// hecha lo que el personaje le prometió (`action.speak` con `effect.pledge`), el mundo abre un
// compromiso `commitment:n` con la verdad (`Pledge`, quién prometió qué a quién y con qué
// testigos) y cada parte anota en su libro (`PLEDGE_BOOK`) lo que entendió, que puede no
// coincidir. El origen de la entidad es el evento de la promesa. Vencer, cumplir y romper son de
// otro proceso: acá solo nace.

import type { AgentId, Event, PlaceRef } from "../../core/index.ts";
import {
  believePledge,
  createEntity,
  deliverPledge,
  ENTITY,
  type EventDraft,
  type GoodDef,
  goodUnit,
  LOCATION,
  learnOutcome,
  makePledge,
  PERSON,
  PLEDGE,
  PLEDGE_BOOK,
  type Pledge,
  type PledgeBook,
  type ProcessDef,
  pledgeLeft,
  type ReadonlyWorldTruth,
  remember,
  resolvePledge,
  type StateChange,
  setComponent,
  weightOfGive,
} from "../../sim/index.ts";

import { paidIn } from "./credit.ts";

export const PLEDGE_PROCESS = "life.pledge";
export const PLEDGE_KEPT_EVENT = "contract.pledge_kept";
export const PLEDGE_BROKEN_EVENT = "contract.pledge_broken";

export interface PledgeOptions {
  readonly goods: readonly GoodDef[];
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Una promesa aceptada que el evento deja dicha: quién prometió (el que habló) y a quién. */
export function promisedIn(e: Event): {
  promisor: AgentId;
  promisee: AgentId;
  good: string;
  grams: number;
} | null {
  if (e.kind !== "action.speak") return null;
  const eff = (
    e.data as { effect?: { pledge?: { good: string | null; grams: number | null } } } | null
  )?.effect;
  const [promisee, promisor] = e.actors as AgentId[];
  if (!promisee || !promisor || !eff?.pledge) return null;
  const { good, grams } = eff.pledge;
  if (good === null || grams === null || !(grams > 0)) return null;
  return { promisor, promisee, good, grams };
}

/** ¿Este evento es el promitente haciendo el favor prometido al destinatario? (verbo = `what`). */
export function favorDoneIn(e: Event, p: Pledge): boolean {
  if (p.term.kind !== "favor" || !e.kind.startsWith("action.")) return false;
  const verb = (e.data as { verb?: string } | null)?.verb;
  const outcome = e.outcome;
  return (
    verb === p.term.what &&
    e.actors[0] === p.promisor &&
    e.actors.includes(p.promisee) &&
    (outcome === undefined || outcome === "success")
  );
}

/**
 * ¿Este evento es el promitente soltando, ante el personaje, el secreto que prometió callar? Es
 * la respuesta a una pregunta (`effect.keep`) que lo dijo entero o a medias, a alguien que no es
 * el destinatario.
 */
export function leakedIn(e: Event, p: Pledge): boolean {
  if (p.term.kind !== "silence" || e.kind !== "action.speak") return false;
  const [listener, speaker] = e.actors as AgentId[];
  const keep = (e.data as { effect?: { keep?: { about?: string; outcome?: string } } } | null)
    ?.effect?.keep;
  return (
    speaker === p.promisor &&
    listener !== p.promisee &&
    keep !== undefined &&
    String(keep.about) === p.term.about &&
    (keep.outcome === "revealed" || keep.outcome === "partial")
  );
}

function alive(truth: ReadonlyWorldTruth, id: AgentId): boolean {
  return truth.get(ENTITY, id)?.endedAt === undefined;
}

/** Abre el compromiso de cada promesa aceptada y la anota en el libro de las dos partes. */
export function pledgeProcess(o: PledgeOptions): ProcessDef {
  return {
    id: PLEDGE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [PLEDGE.name, PLEDGE_BOOK.name, ENTITY.name, LOCATION.name, PERSON.name],
    writes: [PLEDGE.name, PLEDGE_BOOK.name, ENTITY.name],
    run(ctx) {
      const truth = ctx.truth;
      const changes: StateChange[] = [];
      const books = new Map<AgentId, PledgeBook>();
      const bookOf = (id: AgentId) => (books.has(id) ? books.get(id) : truth.get(PLEDGE_BOOK, id));
      const events: EventDraft[] = [];
      // Las promesas tocadas en este paso (nuevas o con entregas), por id.
      const live = new Map<string, Pledge>();
      const openRows = (): [string, Pledge][] => {
        const ids = new Set<string>([...truth.ids(PLEDGE), ...live.keys()]);
        return [...ids]
          .sort()
          .map((id): [string, Pledge] => [
            id,
            live.get(id) ?? (truth.get(PLEDGE, id as never) as Pledge),
          ])
          .filter(([, p]) => p.status === "open");
      };
      for (const e of ctx.recent) {
        const p = promisedIn(e);
        if (!p) {
          // Un favor hecho o un secreto soltado cierra la promesa de favor o de callar.
          let closed = false;
          for (const [id, cur] of openRows()) {
            const done = favorDoneIn(e, cur);
            if (!done && !leakedIn(e, cur)) continue;
            closed = true;
            const status = done ? "kept" : "broken";
            live.set(id, resolvePledge(cur, status, e.id));
            for (const who of [cur.promisor, cur.promisee]) {
              const book = learnOutcome(bookOf(who), id, status, ctx.now);
              if (!book) continue;
              books.set(who, book);
              changes.push(setComponent(PLEDGE_BOOK, who, book));
            }
            events.push({
              kind: done ? PLEDGE_KEPT_EVENT : PLEDGE_BROKEN_EVENT,
              actors: [cur.promisor, cur.promisee],
              place: o.placeOf(truth, cur.promisor),
              data: done
                ? { pledge: id, status, by: "favor", what: (cur.term as { what: string }).what }
                : { pledge: id, status, why: "leak", about: (cur.term as { about: string }).about },
              emissions: {},
              causes: [{ kind: "event", event: e.id }],
            });
          }
          if (closed) continue;
          // Un `give` del promitente al destinatario cubre (de a poco) lo prometido, como `paidIn`.
          const paid = paidIn(e);
          if (!paid) continue;
          let left = paid.grams;
          for (const [id, cur] of openRows()) {
            if (left <= 0) break;
            const t = cur.term;
            if (
              cur.promisor !== paid.payer ||
              cur.promisee !== paid.to ||
              t.kind !== "give" ||
              t.unit !== paid.unit
            ) {
              continue;
            }
            const take = Math.min(left, pledgeLeft(cur));
            if (take <= 0) continue;
            left -= take;
            const next = deliverPledge(cur, take, e.id);
            live.set(id, next);
            if (next.status !== "kept") continue;
            for (const who of [cur.promisor, cur.promisee]) {
              const book = learnOutcome(bookOf(who), id, "kept", ctx.now);
              if (!book) continue;
              books.set(who, book);
              changes.push(setComponent(PLEDGE_BOOK, who, book));
            }
            events.push({
              kind: PLEDGE_KEPT_EVENT,
              actors: [cur.promisor, cur.promisee],
              place: o.placeOf(truth, cur.promisor),
              data: { pledge: id, grams: t.grams, unit: t.unit, by: "delivery" },
              emissions: {},
              causes: [{ kind: "event", event: e.id }],
            });
          }
          continue;
        }
        const good = o.goods.find((g) => g.id === p.good);
        if (!good || !alive(truth, p.promisor) || !alive(truth, p.promisee)) continue;
        const spot = truth.get(LOCATION, p.promisee);
        const witnesses = truth
          .ids(PERSON)
          .map((id) => id as AgentId)
          .filter((id) => {
            const at = truth.get(LOCATION, id);
            return (
              id !== p.promisor &&
              id !== p.promisee &&
              alive(truth, id) &&
              spot !== undefined &&
              at !== undefined &&
              at.hex === spot.hex &&
              at.space === spot.space
            );
          });
        const id = ctx.newId("commitment");
        const grams = p.grams;
        const pledge = {
          ...makePledge({
            promisor: p.promisor,
            promisee: p.promisee,
            term: { kind: "give", unit: goodUnit(good), grams },
            at: e.tick,
            weight: weightOfGive(grams),
            witnesses,
          }),
          history: [e.id],
        };
        changes.push(createEntity(id, e.id, e.tick));
        live.set(id, pledge);
        for (const [who, role] of [
          [p.promisor, "promisor"],
          [p.promisee, "promisee"],
        ] as const) {
          const belief = believePledge(id, pledge, role, ctx.rng.fork("pledge", id, role));
          const book = remember(bookOf(who), belief, ctx.now);
          books.set(who, book);
          changes.push(setComponent(PLEDGE_BOOK, who, book));
        }
      }
      for (const [id, p] of [...live].sort(([a], [b]) => (a < b ? -1 : 1))) {
        changes.push(setComponent(PLEDGE, id as never, p));
      }
      return changes.length === 0 ? {} : { changes, ...(events.length ? { events } : {}) };
    },
  };
}
