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
  ASLEEP,
  type Asleep,
  BODY_STATE,
  type BodyPlanDef,
  deleteComponent,
  draftEvent,
  EATEN,
  ENTITY,
  type EventDraft,
  endEntity,
  type Happening,
  happeningEvent,
  injure,
  LOCATION,
  type LocalMap,
  MEAL_KCAL,
  PENDING_FACTS,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";
import { PLAN_STATE } from "./act.ts";
import { type CatchUpOptions, catchUpRoutine } from "./catchup.ts";
import { living } from "./living.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";

export const CATCH_UP_PROCESS = "life.catch_up";
export const CAUGHT_UP_EVENT = "npc.caught_up";
export const SLEEP_POLICY_PROCESS = "life.sleep_policy";
export const PENDING_APPLIED_EVENT = "npc.pending_applied";

// El registro del dormido vive en `sim/body/asleep.ts` (lo leen procesos de `sim`).
export { ASLEEP, type Asleep };

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
  /**
   * Parte el proceso en dos para llamarlo menos (off-3e): `wake` (por hora) atiende solo a quien
   * pidió despertar y `daily` (por día) a quien no; quien arma el mundo les reparte los alcances
   * (`catchUpDue`). Sin `mode`, un solo proceso por hora que decide solo (como antes).
   */
  readonly mode?: "wake" | "daily";
}

export const CATCH_UP_WAKE_PROCESS = "life.catch_up_wake";
export const CATCH_UP_DAILY_PROCESS = "life.catch_up_daily";

/** ¿Le toca este modo de puesta al día a un dormido? (puro: lo usa `scopes` para no invocar de más). */
export function catchUpDue(mode: "wake" | "daily", sleep: Asleep): boolean {
  return mode === "wake" ? sleep.wake === true : sleep.wake !== true;
}

/** Los gramos de una comida del cuerpo (como la rutina: `MEAL_KCAL` a escala de su masa). */
export function mealGrams(plan: BodyPlanDef, massKg: number, kcalPerGram: number): number {
  return Math.ceil((MEAL_KCAL * (massKg / plan.physiology.refMassKg)) / kcalPerGram);
}

export function catchUpProcess(o: CatchUpProcessOptions): ProcessDef {
  const plans = new Map(o.plans.map((p) => [p.id, p]));
  return {
    id:
      o.mode === "wake"
        ? CATCH_UP_WAKE_PROCESS
        : o.mode === "daily"
          ? CATCH_UP_DAILY_PROCESS
          : CATCH_UP_PROCESS,
    system: "life",
    scope: "agent",
    // Corre cada hora para atender un pedido de despertar sin demora; sin él, una vez por día.
    cadence:
      o.mode === "daily"
        ? { scene: "day", local: "day", regional: "day", world: "day" }
        : { scene: "hour", local: "hour", regional: "hour", world: "hour" },
    representation: "individual",
    phase: "decide",
    reads: [ASLEEP.name, BODY_STATE.name, ENTITY.name, PERSON.name, PENDING_FACTS.name],
    writes: [ASLEEP.name, BODY_STATE.name, ENTITY.name, PENDING_FACTS.name],
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
      if (!plan) return {};
      // Sin pedido de despertar, se atiende una vez por día (el dormido es de cadencia gruesa).
      if (sleep.wake !== true && ctx.now - sleep.lastAdvanced < o.clock.day) return {};
      if (body.updatedAt >= ctx.now) {
        return sleep.wake === true ? { changes: [deleteComponent(ASLEEP, me)] } : {};
      }

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

      // Primero lo asignado, después lo propio (simulation §8): los hechos pendientes se aplican en
      // su momento y entre ellos la persona vive su rutina por tramos.
      const pending = [...(truth.get(PENDING_FACTS, me) ?? [])].sort((a, b) => a.at - b.at);
      const due = pending.filter((f) => f.at <= ctx.now);
      const later = pending.filter((f) => f.at > ctx.now);
      const catchOpts = (left: number) => ({
        clock: o.clock,
        lonDeg: o.lonDeg,
        ageYears: (ctx.now - person.born) / o.clock.year,
        ration: o.ration,
        maxMeals: left,
      });
      let b = body;
      let meals = 0;
      let eatenGrams = 0;
      const happenings: Happening[] = [];
      const applied: EventDraft[] = [];
      const place = o.placeOf(truth, me);
      due.forEach((f, i) => {
        if (b.death !== null) return;
        const to = Math.max(b.updatedAt, f.at) as Tick;
        const seg = catchUpRoutine(plan, me, b, to, catchOpts(maxMeals - meals));
        b = seg.body;
        meals += seg.meals;
        eatenGrams += seg.grams;
        happenings.push(...seg.happenings);
        if (b.death !== null) return;
        const hit = injure(
          plan,
          b,
          { ...f.blow, cause: f.cause, at: f.at },
          ctx.rng.fork("pending", me, f.at, i),
        );
        b = hit.body;
        applied.push({
          kind: PENDING_APPLIED_EVENT,
          actors: [me],
          place,
          data: { fact: f.kind, at: f.at, zone: hit.wound.zone, wound: hit.wound.id },
          emissions: {},
          causes: [{ kind: "event", event: f.cause }],
        });
        // Un golpe que mata en el acto: el cuerpo ya lo dice, falta cerrar con su causa.
        if (hit.died !== null) {
          applied.push({
            kind: "body.died",
            actors: [me],
            place,
            data: { cause: hit.died },
            emissions: { sight: 0.5, sound: 0.1 },
            causes: [{ kind: "event", event: f.cause }],
          });
        }
      });
      const rest = catchUpRoutine(plan, me, b, ctx.now, catchOpts(maxMeals - meals));
      const done = {
        body: rest.body,
        happenings: [...happenings, ...rest.happenings],
        meals: meals + rest.meals,
        grams: eatenGrams + rest.grams,
      };
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
        ...applied,
        ...done.happenings.map((h) => happeningEvent(h, me, place, ctx.now)),
      ];
      const changes: StateChange[] = [
        setComponent(BODY_STATE, me, done.body),
        // Despertado: ya al día, el registro se borra y vuelve a correr todo lo demás.
        sleep.wake === true
          ? deleteComponent(ASLEEP, me)
          : setComponent(ASLEEP, me, { since: sleep.since, lastAdvanced: ctx.now }),
      ];
      if (pending.length > 0) {
        changes.push(
          later.length > 0
            ? setComponent(PENDING_FACTS, me, later)
            : deleteComponent(PENDING_FACTS, me),
        );
      }
      const died = events.findIndex((e) => e.kind === "body.died");
      if (died >= 0) changes.push(endEntity(base, draftEvent(died), ctx.now));
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

// ---------------------------------------------------------------------------------------------
// Quién duerme y cuándo despierta (simulation §4.2, off-3a)

/** Los hexes a `n` pasos o menos de `from` (puro, por anchura): la zona que el jugador tiene cerca. */
export function hexesWithin(
  map: Pick<LocalMap, "neighbors">,
  from: number,
  n: number,
): Set<number> {
  const seen = new Set<number>([from]);
  let ring = [from];
  for (let d = 0; d < n; d++) {
    const next: number[] = [];
    for (const h of ring) {
      for (const m of map.neighbors[h] ?? []) {
        if (seen.has(m)) continue;
        seen.add(m);
        next.push(m);
      }
    }
    ring = next;
  }
  return seen;
}

export interface SleepWantInput {
  /** ¿Está en la zona que el jugador tiene cerca (scene/local)? */
  readonly nearPlayer: boolean;
  /** Tier 4: familia, maestro, pareja, enemigos declarados… (el vínculo con el jugador). */
  readonly bondedToPlayer: boolean;
  /** Tier 3: importancia por encima del umbral (puesto, poder, intrigas). */
  readonly important: boolean;
  /** Un hecho pendiente lo espera (la leva, la epidemia): lo despierta quien lo deba atender. */
  readonly pending: boolean;
}

/** ¿Debería estar dormido? Solo quien está lejos, sin vínculo, sin importancia y sin nada pendiente. */
export function sleepWant(i: SleepWantInput): boolean {
  return !i.nearPlayer && !i.bondedToPlayer && !i.important && !i.pending;
}

/**
 * El catch-up actual integra una rutina corporal fija, no un plan ni un viaje en curso.
 * Hasta off-5, ese trabajo exige ejecución individual aunque el NPC esté lejos del jugador.
 */
export function sleepWorkPending(truth: ReadonlyWorldTruth, who: AgentId): boolean {
  const plan = truth.get(PLAN_STATE, who);
  return (plan !== undefined && !plan.done) || truth.get(NPC_JOURNEY, who) !== undefined;
}

export interface SleepPolicyOptions {
  readonly player: AgentId;
  readonly map: LocalMap;
  /** Cuántos hexes alrededor del jugador cuentan como cerca (zona scene/local). */
  readonly near: number;
  readonly bonded: (truth: ReadonlyWorldTruth, who: AgentId) => boolean;
  readonly important: (truth: ReadonlyWorldTruth, who: AgentId) => boolean;
  readonly pending?: (truth: ReadonlyWorldTruth, who: AgentId) => boolean;
}

/**
 * Registra a quien debe dormir y pide despertar a quien ya no (por hora, fase `perceive`): no
 * pone al día a nadie —eso es `life.catch_up`, que atiende el pedido y borra el registro—. Un
 * muerto, el personaje o quien no tiene posición no se toca.
 */
export function sleepPolicyProcess(o: SleepPolicyOptions): ProcessDef {
  return {
    id: SLEEP_POLICY_PROCESS,
    system: "life",
    // Un solo proceso del mundo que recorre a los vivos (off-3e): una llamada por hora, no una por agente.
    scope: "world",
    cadence: { scene: "hour", local: "hour", regional: "hour", world: "hour" },
    representation: "individual",
    phase: "perceive",
    reads: [
      ASLEEP.name,
      BODY_STATE.name,
      ENTITY.name,
      LOCATION.name,
      PLAN_STATE.name,
      NPC_JOURNEY.name,
    ],
    writes: [ASLEEP.name],
    run(ctx) {
      const truth = ctx.truth;
      const there = truth.get(LOCATION, o.player)?.hex;
      if (there === undefined) return {};
      const zone = hexesWithin(o.map, there, o.near);
      const changes: StateChange[] = [];
      for (const me of living(truth)) {
        if (me === o.player) continue;
        const here = truth.get(LOCATION, me)?.hex;
        const body = truth.get(BODY_STATE, me);
        if (here === undefined || !body) continue;
        const want = sleepWant({
          nearPlayer: zone.has(here),
          bondedToPlayer: o.bonded(truth, me),
          important: o.important(truth, me),
          pending: o.pending?.(truth, me) ?? false,
        });
        const sleep = truth.get(ASLEEP, me);
        if (want && !sleep) {
          changes.push(setComponent(ASLEEP, me, { since: ctx.now, lastAdvanced: body.updatedAt }));
        } else if (!want && sleep && sleep.wake !== true) {
          changes.push(setComponent(ASLEEP, me, { ...sleep, wake: true }));
        } else if (want && sleep?.wake === true) {
          // Quiso despertar y se le pidió, pero volvió a quedar lejos: se cancela el pedido.
          changes.push(setComponent(ASLEEP, me, { ...sleep, wake: false }));
        }
      }
      return changes.length > 0 ? { changes } : {};
    },
  };
}
