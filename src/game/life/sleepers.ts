// Tier 1: el NPC dormido y su puesta al día (simulation §4.2, §7-§8; off-2). Un registro `ASLEEP`
// dice que alguien está dormido y hasta cuándo se lo avanzó (`lastAdvanced`). `life.catch_up` (por
// día, fase `decide`) lo pone al día con `catchUpRoutine`: el cuerpo recorre la rutina por tramos y
// lo que comió sale de la despensa del hogar por el libro mayor (hacia `eaten`, conservado); si la
// despensa no alcanza, come menos, no se inventa la comida. Lo que le pasó al cuerpo (infecciones,
// colapsos, la muerte con su causa) sale como los eventos de siempre. Despertarlo (off-3) es borrar
// el registro después de ponerlo al día. Opt-in: nadie lo registra por defecto.

import type { AgentId, HolderRef, PlaceRef, Tick } from "../../core/index.ts";
import { externalAccount, holderAccount, ledgerUnit } from "../../core/index.ts";
import {
  BODY_STATE,
  type BodyPlanDef,
  deleteComponent,
  draftEvent,
  EATEN,
  ENTITY,
  type EventDraft,
  endEntity,
  happeningEvent,
  MEAL_KCAL,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  table,
} from "../../sim/index.ts";
import { type CatchUpOptions, catchUpRoutine } from "./catchup.ts";

export const CATCH_UP_PROCESS = "life.catch_up";
export const CAUGHT_UP_EVENT = "npc.caught_up";

/** Un NPC dormido (tier 1): hasta cuándo se lo avanzó. */
export interface Asleep {
  readonly since: Tick;
  readonly lastAdvanced: Tick;
}
export const ASLEEP = table<Asleep>("life.asleep");

export interface CatchUpProcessOptions {
  readonly plans: readonly BodyPlanDef[];
  readonly clock: CatchUpOptions["clock"];
  readonly lonDeg: number;
  /** El alimento con que come: el bien del ledger (`good:…`) y lo que da por gramo. */
  readonly ration: {
    readonly unit: string;
    readonly kcalPerGram: number;
    readonly waterPerGram: number;
  };
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Los gramos de una comida del cuerpo (como la rutina: `MEAL_KCAL` a escala de su masa). */
export function mealGrams(plan: BodyPlanDef, massKg: number, kcalPerGram: number): number {
  return Math.ceil((MEAL_KCAL * (massKg / plan.physiology.refMassKg)) / kcalPerGram);
}

export function catchUpProcess(o: CatchUpProcessOptions): ProcessDef {
  const plans = new Map(o.plans.map((p) => [p.id, p]));
  return {
    id: CATCH_UP_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { scene: "day", local: "day", regional: "day", world: "day" },
    representation: "individual",
    phase: "decide",
    reads: [ASLEEP.name, BODY_STATE.name, ENTITY.name, PERSON.name],
    writes: [ASLEEP.name, BODY_STATE.name, ENTITY.name],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      const sleep = truth.get(ASLEEP, me);
      const base = truth.get(ENTITY, me);
      const body = truth.get(BODY_STATE, me);
      const person = truth.get(PERSON, me);
      if (me === o.player || !sleep || !base || !body || !person) return {};
      if (base.endedAt !== undefined) return { changes: [deleteComponent(ASLEEP, me)] };
      const plan = plans.get(body.plan);
      if (!plan || body.updatedAt >= ctx.now) return {};

      // La despensa alcanza para las comidas que le tocan: lo suyo entre los que comen de ella.
      const unit = ledgerUnit(o.ration.unit);
      const larder = person.household as unknown as HolderRef;
      const stock = ctx.ledger?.balance(holderAccount(larder), unit) ?? 0;
      const mouths = Math.max(
        1,
        truth
          .ids(PERSON)
          .filter(
            (id) =>
              truth.get(PERSON, id)?.household === person.household &&
              truth.get(ENTITY, id)?.endedAt === undefined,
          ).length,
      );
      const grams = mealGrams(plan, body.massKg, o.ration.kcalPerGram);
      const maxMeals = Math.floor(stock / (grams * mouths));

      const done = catchUpRoutine(plan, me, body, ctx.now, {
        clock: o.clock,
        lonDeg: o.lonDeg,
        ageYears: (ctx.now - person.born) / o.clock.year,
        ration: o.ration,
        maxMeals,
      });
      const place = o.placeOf(truth, me);
      const summary: EventDraft = {
        kind: CAUGHT_UP_EVENT,
        actors: [me],
        place,
        data: { from: sleep.lastAdvanced, to: ctx.now, meals: done.meals, grams: done.grams },
        emissions: {},
        causes: [{ kind: "state", entity: me, key: "routine" }],
      };
      const events: EventDraft[] = [
        summary,
        ...done.happenings.map((h) => happeningEvent(h, me, place, ctx.now)),
      ];
      const changes: StateChange[] = [
        setComponent(BODY_STATE, me, done.body),
        setComponent(ASLEEP, me, { since: sleep.since, lastAdvanced: ctx.now }),
      ];
      const died = done.happenings.findIndex((h) => h.kind === "died");
      if (died >= 0) changes.push(endEntity(base, draftEvent(1 + died), ctx.now));
      const postings: PostingDraft[] =
        done.grams > 0
          ? [
              {
                event: draftEvent(0),
                transfers: [
                  {
                    unit,
                    from: holderAccount(larder),
                    to: externalAccount(EATEN),
                    amount: done.grams,
                  },
                ],
              },
            ]
          : [];
      return { changes, events, postings };
    },
  };
}
