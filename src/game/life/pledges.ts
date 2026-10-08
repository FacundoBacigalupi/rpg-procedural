// Las promesas de palabra en la aldea (contracts §3, §4; dialogue §8): cuando el oyente toma por
// hecha lo que el personaje le prometió (`action.speak` con `effect.pledge`), el mundo abre un
// compromiso `commitment:n` con la verdad (`Pledge`, quién prometió qué a quién y con qué
// testigos) y cada parte anota en su libro (`PLEDGE_BOOK`) lo que entendió, que puede no
// coincidir. El origen de la entidad es el evento de la promesa. Vencer, cumplir y romper son de
// otro proceso: acá solo nace.

import type { AgentId, Event } from "../../core/index.ts";
import {
  believePledge,
  createEntity,
  ENTITY,
  type GoodDef,
  goodUnit,
  LOCATION,
  makePledge,
  PERSON,
  PLEDGE,
  PLEDGE_BOOK,
  type PledgeBook,
  type ProcessDef,
  type ReadonlyWorldTruth,
  remember,
  type StateChange,
  setComponent,
  weightOfGive,
} from "../../sim/index.ts";

export const PLEDGE_PROCESS = "life.pledge";

export interface PledgeOptions {
  readonly goods: readonly GoodDef[];
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
      for (const e of ctx.recent) {
        const p = promisedIn(e);
        if (!p) continue;
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
        changes.push(createEntity(id, e.id, e.tick), setComponent(PLEDGE, id, pledge));
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
      return changes.length === 0 ? {} : { changes };
    },
  };
}
