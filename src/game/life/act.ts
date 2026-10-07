// El plan del personaje en el mundo (player-loop §3, actions §3, §7): el plan entra como el
// componente `life.plan` del personaje y el proceso `life.act` lo ejecuta hoja por hoja contra el
// estado de ese momento. Cada corrida resuelve una hoja con `resolve` (la tirada común, el
// matiz, el evento con causas y emisiones), aplica lo que el paso le hace al cuerpo y a las
// habilidades de quien lo hizo, y agenda la hoja siguiente para cuando termina esta. Al
// terminar el último paso deja el plan en `done`.

import {
  type AgentId,
  type EntityRef,
  type HolderRef,
  type LedgerUnit,
  ledgerUnit,
  type PlanetClock,
} from "../../core/index.ts";
import {
  type ActionCatalog,
  type ActionPlan,
  type Activity,
  advance,
  BODY_STATE,
  type Body,
  type BodyPlanDef,
  blowFromMishap,
  blowFromStrike,
  capabilitiesOf,
  daylight,
  deleteComponent,
  draftEvent,
  ENTITY,
  type EventDraft,
  type FoodDef,
  FRESH_CURSOR,
  type GoodDef,
  goodUnit,
  HARVEST_GOOD,
  HARVEST_GRAMS_PER_HOUR,
  INNATE,
  ingest,
  injure,
  LOCATION,
  type LocalMap,
  learnFromAttempt,
  localHour,
  type Market,
  type Nutrition,
  nearestHex,
  nodeAt,
  opposingSkill,
  PERSON,
  PLACE,
  type PlanCursor,
  type PlanNode,
  type ProcessContext,
  type ProcessDef,
  type ProcessResult,
  placeAt,
  placeRefOf,
  type ReadonlyWorldTruth,
  type RecipeDef,
  type ResolveInput,
  rankOf,
  resolve,
  type SelfReport,
  SKILL_STATE,
  type SkillCatalog,
  type SpaceGraph,
  STATUS,
  type StateChange,
  type StatusDef,
  setActivity,
  setComponent,
  spaceLight,
  standardize,
  type Trait,
  table,
  treat,
  verbSkill,
} from "../../sim/index.ts";
import { listenTo, PENDING } from "./converse.ts";
import { canFight, strikeFight } from "./fight.ts";

/** Un paso ya hecho, para la autopercepción y la narración del turno. */
export interface StepRecord {
  readonly verb: string;
  readonly at: number;
  readonly self: SelfReport;
}

/** El plan del personaje en curso (o terminado, `done`). Verdad de la sim: va a la base. */
export interface PlanState {
  readonly seq: number;
  readonly plan: ActionPlan;
  readonly cursor: PlanCursor;
  readonly lastBelieved: string | null;
  readonly steps: readonly StepRecord[];
  readonly done: boolean;
}

export const PLAN_STATE = table<PlanState>("life.plan");

export const ACT_PROCESS = "life.act";

/** La clave de causa/razón de un plan: el ítem agendado y los eventos citan esto. */
export function planKey(seq: number): string {
  return `plan.${seq}`;
}

export interface ActOptions {
  readonly map: LocalMap;
  readonly spaces: SpaceGraph;
  readonly catalog: ActionCatalog;
  readonly skills: SkillCatalog;
  readonly traits: readonly Trait[];
  readonly bodyPlans: readonly BodyPlanDef[];
  readonly foods: readonly FoodDef[];
  readonly goods: readonly GoodDef[];
  readonly recipes: readonly RecipeDef[];
  readonly statuses: readonly StatusDef[];
  readonly clock: PlanetClock;
}

const GOOD = (id: string): LedgerUnit => ledgerUnit(`good:${id}`);

/** El esfuerzo de cada verbo para el cuerpo (body-health: carga por actividad). */
const VERB_ACTIVITY: Readonly<Record<string, Activity>> = {
  move: "moderate",
  gather: "moderate",
  search: "light",
  work: "heavy",
  strike: "heavy",
  take: "light",
  store: "light",
  cook: "moderate",
  tend: "light",
  speak: "light",
  look: "light",
  eat: "rest",
  drink: "rest",
  wait: "rest",
  rest: "rest",
};

/** Descansar de noche es dormir. */
export function activityOf(verb: string, hour: number): Activity {
  const a = VERB_ACTIVITY[verb] ?? "light";
  return verb === "rest" && (hour >= 21 || hour < 5) ? "sleep" : a;
}

function placesOf(truth: ReadonlyWorldTruth) {
  return truth.ids(PLACE).flatMap((id) => {
    const place = truth.get(PLACE, id);
    return place ? [{ id, place }] : [];
  });
}

export function actProcess(o: ActOptions): ProcessDef {
  const foods = new Map<LedgerUnit, Nutrition>(
    o.foods.map((f) => [GOOD(f.id), { kcalPerGram: f.kcalPerGram, waterPerGram: f.waterPerGram }]),
  );
  const plans = new Map(o.bodyPlans.map((p) => [p.id, p]));

  return {
    id: ACT_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "act",
    reads: [PLAN_STATE.name, ENTITY.name, LOCATION.name, BODY_STATE.name, SKILL_STATE.name],
    writes: [PLAN_STATE.name, LOCATION.name, BODY_STATE.name, SKILL_STATE.name, PENDING.name],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const state = ctx.truth.get(PLAN_STATE, me);
      if (!state || state.done) return {};
      // Un plan nuevo reemplaza al anterior: el ítem viejo ya no tiene a quién ejecutar.
      if (ctx.item?.reason.kind !== "state" || ctx.item.reason.key !== planKey(state.seq)) {
        return {};
      }
      if (ctx.truth.get(ENTITY, me)?.endedAt !== undefined) return {};

      const hex = ctx.truth.get(LOCATION, me)?.hex ?? 0;
      const space = ctx.truth.get(LOCATION, me)?.space;
      const node = space === undefined ? undefined : o.spaces.spaces.find((s) => s.key === space);
      const hour = localHour(o.clock, ctx.now, o.map.lonDeg);
      const light = node ? spaceLight(node, daylight(hour)) : daylight(hour);
      const cursor = advance(state.plan.root, state.cursor, {
        now: ctx.now,
        dark: light < 0.2,
        lastBelieved: state.lastBelieved,
      });
      if (cursor.path === null) {
        const changes: StateChange[] = [
          setComponent(PLAN_STATE, me, { ...state, cursor, done: true }),
        ];
        const body = ctx.truth.get(BODY_STATE, me);
        if (body && body.activity !== "rest") {
          changes.push(setComponent(BODY_STATE, me, setActivity(body, "rest")));
        }
        return { changes };
      }
      return step(ctx, o, { me, state, cursor, foods, plans, hex, light, hour });
    },
  };
}

interface StepEnv {
  readonly me: AgentId;
  readonly state: PlanState;
  readonly cursor: PlanCursor;
  readonly foods: ReadonlyMap<LedgerUnit, Nutrition>;
  readonly plans: ReadonlyMap<string, BodyPlanDef>;
  readonly hex: number;
  readonly light: number;
  readonly hour: number;
}

/** Cuántos comen de la despensa de ese hogar. */
function membersOf(truth: ReadonlyWorldTruth, household: string): number {
  return Math.max(
    1,
    truth
      .ids(PERSON)
      .filter(
        (id) =>
          truth.get(PERSON, id)?.household === household &&
          truth.get(ENTITY, id)?.endedAt === undefined,
      ).length,
  );
}

/** Los precios y las casas que `trade` y `work` necesitan para mover bienes (economy §4). */
function marketOf(
  truth: ReadonlyWorldTruth,
  o: ActOptions,
  me: AgentId,
  other: EntityRef | null,
): Market {
  const otherHome = other === null ? undefined : truth.get(PERSON, other as AgentId)?.household;
  const otherStatus = other === null ? undefined : truth.get(STATUS, other);
  return {
    priceCopperPerKg: new Map(
      o.goods.flatMap((g) =>
        g.priceCopperPerKg === undefined ? [] : [[goodUnit(g), g.priceCopperPerKg] as const],
      ),
    ),
    ownMembers: membersOf(truth, truth.get(PERSON, me)?.household ?? ""),
    other:
      otherHome === undefined
        ? undefined
        : { larder: otherHome as unknown as HolderRef, members: membersOf(truth, otherHome) },
    harvestGramsPerHour: HARVEST_GRAMS_PER_HOUR,
    harvestGood: HARVEST_GOOD,
    ranks: {
      actor: rankOf(truth.get(STATUS, me), o.statuses),
      other: rankOf(otherStatus, o.statuses),
    },
  };
}

function step(ctx: ProcessContext, o: ActOptions, e: StepEnv): ProcessResult {
  const { me, state, cursor } = e;
  const truth = ctx.truth;
  const node = nodeAt(state.plan.root, cursor.path as number[]) as Extract<
    PlanNode,
    { kind: "do" }
  >;
  const def = o.catalog.verb(node.verb);
  if (!def) throw new RangeError(`verbo desconocido en el plan: ${node.verb}`);

  const person = truth.get(PERSON, me);
  const innate = truth.get(INNATE, me);
  const body = truth.get(BODY_STATE, me);
  if (!person || !innate || !body) throw new Error(`${me} no tiene persona, rasgos o cuerpo`);
  const bodyPlan = e.plans.get(body.plan) as BodyPlanDef;
  const caps = capabilitiesOf(bodyPlan, body);
  const skills = truth.get(SKILL_STATE, me);
  const places = placesOf(truth);

  const partyOf = (id: EntityRef) => {
    const p = truth.get(PERSON, id as AgentId);
    const n = truth.get(INNATE, id as AgentId);
    return {
      id,
      z: p && n ? standardize(n, o.traits, p.sex) : {},
      hex: truth.get(LOCATION, id)?.hex ?? e.hex,
      skill: opposingSkill(o.skills, truth.get(SKILL_STATE, id), node.verb),
    };
  };
  const parties: ResolveInput["parties"] = Object.fromEntries(
    node.args.flatMap((a) =>
      "entity" in a && a.entity.startsWith("agent:") ? [[a.role, partyOf(a.entity)]] : [],
    ),
  );
  const destArg = node.args.find((a) => "entity" in a && a.entity.startsWith("place:"));
  const destination =
    destArg && "entity" in destArg
      ? nearestHex(
          o.map,
          e.hex,
          (truth.get(PLACE, destArg.entity)?.hexes as readonly number[] | undefined) ?? [e.hex],
        )
      : undefined;

  const z = standardize(innate, o.traits, person.sex);
  const here = placeAt(places, e.hex);
  const input: ResolveInput = {
    def,
    node,
    planManner: state.plan.manner,
    actor: {
      id: me,
      z,
      capabilities: caps,
      hex: e.hex,
      skill: verbSkill(o.skills, skills, node.verb),
    },
    parties,
    scene: {
      light: e.light,
      terrain: o.map.forest[e.hex] ? 0.6 : 0.1,
      placeKinds: places
        .filter((p) => (p.place.hexes as readonly number[]).includes(e.hex))
        .map((p) => p.place.kind),
    },
    tick: ctx.now,
    rng: ctx.rng.fork("act", state.seq, (cursor.path as number[]).join(".")),
    map: o.map,
    destination,
    ledger: { holdings: (a) => ctx.ledger?.holdings(a) ?? [] },
    place: placeRefOf(o.map, here),
    causes: [{ kind: "state", entity: me, key: planKey(state.seq) }],
    foods: e.foods,
    unitNames: new Map(o.goods.map((g) => [goodUnit(g), g.name] as const)),
    larder: person.household as unknown as HolderRef,
    recipes: node.verb === "cook" ? o.recipes : undefined,
    market:
      node.verb === "trade" || node.verb === "work"
        ? marketOf(truth, o, me, parties["with"]?.id ?? null)
        : undefined,
  };
  const r = resolve(input);

  // Lo que el paso le hace al cuerpo (body-health): comer, beber, curar, golpes y percances.
  let nextBody: Body = setActivity(body, activityOf(node.verb, e.hour));
  let bodyTouched = nextBody !== body;
  const changes: StateChange[] = [...r.changes];
  const eff = r.effect;
  if (eff.kind === "eat") {
    nextBody = ingest(bodyPlan, nextBody, eff.kcal, eff.water);
    bodyTouched = true;
  } else if (eff.kind === "drink") {
    nextBody = ingest(bodyPlan, nextBody, 0, eff.liters);
    bodyTouched = true;
  } else if (eff.kind === "tend" && eff.done) {
    const target = eff.target === me ? nextBody : truth.get(BODY_STATE, eff.target as AgentId);
    const worst = target?.wounds
      .filter((w) => w.stage !== "healed")
      .sort((a, b) => b.severity - a.severity)[0];
    if (target && worst) {
      const treated = treat(target, worst.id, worst.infection > 0.05 ? "clean" : "bandage");
      if (eff.target === me) nextBody = treated;
      else changes.push(setComponent(BODY_STATE, eff.target as AgentId, treated));
      bodyTouched = bodyTouched || eff.target === me;
    }
  }
  const mishap = blowFromMishap(eff, draftEvent(0), ctx.now, input.rng.fork("mishap"));
  if (mishap) {
    nextBody = injure(bodyPlan, nextBody, mishap, input.rng.fork("injure")).body;
    bodyTouched = true;
  }
  // Un golpe contra alguien vivo es el comienzo de una pelea (combat §1): corre hasta que alguien
  // no puede o no quiere seguir. Contra quien ya no está en pie queda el golpe suelto.
  const targetId = "target" in eff ? (eff.target as AgentId | null) : null;
  const extraEvents: EventDraft[] = [];
  let fightSeconds = 0;
  let record: StepRecord["self"] = r.self;
  if (eff.kind === "strike" && eff.committed && targetId && canFight(truth, targetId)) {
    const fight = strikeFight({
      truth,
      me,
      myBody: nextBody,
      target: targetId,
      plans: e.plans,
      skills: o.skills,
      traits: o.traits,
      intent: [...state.plan.manner, ...node.manner].includes("fast") ? "drive_off" : "subdue",
      light: e.light,
      start: ctx.now,
      rng: input.rng.fork("fight"),
      cause: draftEvent(0),
      place: input.place,
    });
    nextBody = fight.myBody;
    bodyTouched = true;
    changes.push(...fight.changes);
    extraEvents.push(fight.event);
    fightSeconds = fight.seconds;
    if (r.self.effect.kind === "strike") {
      record = { ...r.self, effect: { ...r.self.effect, fight: fight.gist } };
    }
  } else {
    const blow = blowFromStrike(eff, draftEvent(0), ctx.now);
    if (blow && targetId) {
      const tb = truth.get(BODY_STATE, targetId);
      if (tb) {
        changes.push(
          setComponent(
            BODY_STATE,
            targetId,
            injure(bodyPlan, tb, blow, input.rng.fork("hit")).body,
          ),
        );
      }
    }
  }
  if (bodyTouched) changes.push(setComponent(BODY_STATE, me, nextBody));

  // Lo que aprendió del paso (skills §3).
  const age = (ctx.now - person.born) / o.clock.year;
  const learned = learnFromAttempt(
    o.skills,
    skills,
    { z, capabilities: caps, ageYears: age },
    def,
    r.attempt,
    r.seconds,
    ctx.now,
  );
  if (learned) changes.push(setComponent(SKILL_STATE, me, learned));

  const stepRecord: StepRecord = { verb: node.verb, at: ctx.now, self: record };
  const lastBelieved = r.self.believed;
  const end = ctx.now + Math.max(r.seconds, fightSeconds);
  // Si le habló a alguien en persona, el oyente contesta cuando termina de oír (converse).
  const heard =
    eff.kind === "speak" && eff.delivered && eff.to !== null
      ? listenTo(me, eff.to, eff.text, eff.clarity, ctx.now, end)
      : { changes: [], schedule: [] };
  changes.push(...heard.changes);
  changes.push(
    setComponent(PLAN_STATE, me, {
      ...state,
      cursor,
      lastBelieved,
      steps: [...state.steps, stepRecord],
    }),
  );
  return {
    events: [...r.events, ...extraEvents],
    changes,
    postings: r.postings,
    schedule: [
      {
        at: end,
        phase: "act",
        process: ACT_PROCESS,
        scope: me,
        reason: { kind: "state", entity: me, key: planKey(state.seq) },
      },
      ...heard.schedule,
    ],
  };
}

export { deleteComponent, FRESH_CURSOR };
