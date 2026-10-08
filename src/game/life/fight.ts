// La pelea del personaje con el mundo (combat.md §1, §12, §17): un golpe contra alguien vivo y
// con cuerpo es el comienzo de una pelea. Acá se arman los peleadores desde la verdad (cuerpo,
// rasgos, nivel de pelea), se corre `runFight` y lo que resulta vuelve como cambios de cuerpo y un
// evento con las causas. La sim no sabe de `game`: esto es el pegamento, como `cook` en act.ts.

import type { AgentId, EventId, PlaceRef, Rng, Tick } from "../../core/index.ts";
import {
  atMercyOf,
  BODY_STATE,
  type Body,
  type BodyPlanDef,
  ENTITY,
  type EventDraft,
  type FighterOutcome,
  type FightGist,
  type FightIntent,
  INNATE,
  PERSON,
  type ReadonlyWorldTruth,
  runFight,
  SKILL_STATE,
  type SkillCatalog,
  type StateChange,
  setComponent,
  standardize,
  type Trait,
  verbSkill,
  YIELDED,
  type Yielded,
} from "../../sim/index.ts";

export interface StrikeFightInput {
  readonly truth: ReadonlyWorldTruth;
  readonly me: AgentId;
  /** El cuerpo de quien pega, ya con lo que el paso le hizo. */
  readonly myBody: Body;
  readonly target: AgentId;
  readonly plans: ReadonlyMap<string, BodyPlanDef>;
  readonly skills: SkillCatalog;
  readonly traits: readonly Trait[];
  readonly intent: FightIntent;
  readonly light: number;
  readonly start: Tick;
  readonly rng: Rng;
  /** El evento del golpe: causa de cada herida y del evento de la pelea. */
  readonly cause: EventId;
  readonly place: PlaceRef;
}

export interface StrikeFight {
  /** Cuánto duró. */
  readonly seconds: number;
  readonly myBody: Body;
  readonly changes: readonly StateChange[];
  readonly event: EventDraft;
  /** Cómo cree el actor que terminó. */
  readonly gist: FightGist;
}

/** Hay con quién pelear: está vivo, con cuerpo y en pie o dormido (no hace falta rematar a un caído). */
export function canFight(truth: ReadonlyWorldTruth, target: AgentId): boolean {
  const body = truth.get(BODY_STATE, target);
  return (
    truth.get(ENTITY, target)?.endedAt === undefined &&
    body !== undefined &&
    body.death === null &&
    body.consciousness !== "unconscious"
  );
}

/** Si `target` sigue a merced de `me`. */
export function atMyMercy(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  target: AgentId,
  now: Tick,
): boolean {
  const body = truth.get(BODY_STATE, target);
  return (
    truth.get(ENTITY, target)?.endedAt === undefined &&
    body !== undefined &&
    body.death === null &&
    atMercyOf(truth.get(YIELDED, target) as Yielded | undefined, me, now)
  );
}

const SIDE: Readonly<Record<FighterOutcome, FightGist["mine"]>> = {
  standing: "standing",
  down: "down",
  dead: "dead",
  fled: "fled",
  yielded: "yielded",
};

export function strikeFight(i: StrikeFightInput): StrikeFight {
  const person = (id: AgentId) => i.truth.get(PERSON, id);
  const z = (id: AgentId) => {
    const p = person(id);
    const n = i.truth.get(INNATE, id);
    return p && n ? standardize(n, i.traits, p.sex) : {};
  };
  const theirBody = i.truth.get(BODY_STATE, i.target) as Body;
  const plan = (b: Body) => i.plans.get(b.plan) as BodyPlanDef;
  const result = runFight({
    fighters: [
      {
        id: i.me,
        side: "me",
        plan: plan(i.myBody),
        body: i.myBody,
        z: z(i.me),
        skill: verbSkill(i.skills, i.truth.get(SKILL_STATE, i.me), "strike"),
        intent: i.intent,
        at: { x: 0, y: 0 },
      },
      {
        id: i.target,
        side: "them",
        plan: plan(theirBody),
        body: theirBody,
        z: z(i.target),
        skill: verbSkill(i.skills, i.truth.get(SKILL_STATE, i.target), "strike"),
        intent: "drive_off",
        at: { x: 0.7, y: 0 },
        unaware: theirBody.activity === "sleep",
      },
    ],
    start: i.start,
    light: i.light,
    rng: i.rng,
    cause: i.cause,
  });
  const mine = result.fighters.find((f) => f.id === i.me);
  const theirs = result.fighters.find((f) => f.id === i.target);
  if (!mine || !theirs) throw new Error("la pelea perdió un participante");
  const hits = (by: AgentId) => result.log.filter((l) => l.kind === "hit" && l.actor === by).length;
  const event: EventDraft = {
    kind: "combat.fight",
    actors: [i.me, i.target],
    place: i.place,
    data: {
      end: result.end,
      seconds: result.seconds,
      outcomes: { [i.me]: mine.outcome, [i.target]: theirs.outcome },
      hits: result.log
        .filter((l) => l.kind === "hit")
        .map((l) => ({ t: l.t, by: l.actor, to: l.target, zone: l.zone, severity: l.severity })),
    },
    emissions: { sight: 1, sound: 0.8 },
    causes: [{ kind: "event", event: i.cause }],
  };
  return {
    seconds: result.seconds,
    myBody: mine.body,
    changes: [
      setComponent(BODY_STATE, i.target, theirs.body),
      // Quien se rinde queda a merced del que ganó: rematarlo o perdonarlo es de ahora en más.
      ...(theirs.outcome === "yielded" && mine.outcome === "standing"
        ? [
            setComponent(YIELDED, i.target, {
              to: i.me,
              at: i.start + result.seconds,
              event: i.cause,
            }),
          ]
        : []),
    ],
    event,
    gist: {
      seconds: result.seconds,
      mine: SIDE[mine.outcome],
      theirs: theirs.outcome === "dead" ? "down" : (SIDE[theirs.outcome] as FightGist["theirs"]),
      woundsTaken: mine.woundsTaken,
      woundsDealt: hits(i.me),
    },
  };
}
