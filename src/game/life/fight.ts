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
  deleteComponent,
  ENTITY,
  type EventDraft,
  exposeTo,
  type FighterOutcome,
  type FightGist,
  type FightIntent,
  type FightSnapshot,
  familiarWith,
  INNATE,
  levelOf,
  PERSON,
  type ReadonlyWorldTruth,
  rivalKey,
  runFight,
  SKILL_STATE,
  type SkillCatalog,
  type Skills,
  STYLE_SHARE,
  type StateChange,
  setComponent,
  standardize,
  styleKey,
  type Trait,
  table,
  verbSkill,
  YIELDED,
  type Yielded,
} from "../../sim/index.ts";

/** Una pelea pausada del personaje: contra quién y con qué retomarla (combat §16). */
export interface PausedFight {
  readonly foe: AgentId;
  readonly snapshot: FightSnapshot;
  /** El evento de la pelea que arrancó, causa de las heridas que siguen. */
  readonly event: EventId;
}

export const FIGHT_STATE = table<PausedFight>("combat.fight_state");

/** Cuánto aguanta la pausa: pasado esto la pelea se enfrió y se separaron (calibración abierta). */
export const PAUSE_WINDOW = 30;

/** La pelea pausada que sigue viva contra `foe`, si la hay. */
export function livePause(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  foe: AgentId,
  now: Tick,
): PausedFight | undefined {
  const p = truth.get(FIGHT_STATE, me);
  return p && p.foe === foe && now - p.snapshot.next <= PAUSE_WINDOW ? p : undefined;
}

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
  /** Ticks por día, para olvidar la familiaridad (por defecto 86400). */
  readonly day?: number;
  /** El evento del golpe: causa de cada herida y del evento de la pelea. */
  readonly cause: EventId;
  readonly place: PlaceRef;
  /** Quien maneja el jugador: la pelea se pausa cuando él nota algo que pide decidir. */
  readonly control?: boolean;
  /**
   * 0-1: cuánto se contiene quien pega (pelea por debajo de su nivel, skills §9, combat §5): el
   * rival lo lee más flojo de lo que es, y contenerse cuesta algo de filo de verdad.
   */
  readonly holdBack?: number;
  /** Retomar una pelea pausada. */
  readonly resume?: PausedFight;
}

export interface StrikeFight {
  /** Cuánto duró. */
  readonly seconds: number;
  readonly myBody: Body;
  readonly changes: readonly StateChange[];
  readonly event: EventDraft;
  /** Cómo cree el actor que terminó. */
  readonly gist: FightGist;
  /** Lo que pelear le enseñó al actor sobre el estilo del rival: aplicar con `exposeSkills`. */
  readonly exposure?: Exposure;
}

/** Una exposición a un estilo: qué habilidad, con qué clave y cuántas horas. */
export interface Exposure {
  readonly skill: string;
  readonly key: string;
  /** El estilo del rival (cultura o escuela): también se acostumbra a él. */
  readonly style?: string;
  readonly hours: number;
}

import { styleOf } from "./styles.ts";

const DAY_SECONDS = 86400;

const styleExposure = (style: string | undefined) => (style === undefined ? {} : { style });

/** Cuánto del nivel real se pierde al contenerse del todo (calibración abierta). */
export const HOLD_BACK_COST = 0.2;

/** Aplica una exposición a las habilidades de alguien (skills §2.3). */
export function exposeSkills(
  skills: Skills | undefined,
  e: Exposure,
  now: Tick,
  day = DAY_SECONDS,
): Skills {
  const one = exposeTo(skills?.[e.skill], e.key, e.hours, now, day);
  const both =
    e.style === undefined ? one : exposeTo(one, styleKey(e.style), e.hours * STYLE_SHARE, now, day);
  return { ...skills, [e.skill]: both };
}

/** La familiaridad de `who` con el estilo de `rival` en la habilidad del golpe. */
function fightFamiliarity(
  catalog: SkillCatalog,
  skills: Skills | undefined,
  rival: AgentId,
  style: string | undefined,
  now: Tick,
  day: number,
): number {
  const use = catalog.forVerb("strike");
  if (!use) return 0;
  const keys = [rivalKey(rival), ...(style === undefined ? [] : [styleKey(style)])];
  return familiarWith(skills?.[use.skill.id], keys, now, day);
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

/** El ojo entrenado de alguien para pelear: la faceta `reading` de la habilidad del golpe (skills §2). */
function fightEye(catalog: SkillCatalog, skills: Skills | undefined, verb: string): number {
  const use = catalog.forVerb(verb);
  return use ? levelOf(skills?.[use.skill.id], "reading") : 0;
}

const SIDE: Readonly<Record<FighterOutcome, FightGist["mine"]>> = {
  standing: "standing",
  down: "down",
  dead: "dead",
  fled: "fled",
  yielded: "yielded",
};

export function strikeFight(i: StrikeFightInput): StrikeFight {
  const day = i.day ?? DAY_SECONDS;
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
        skill:
          verbSkill(i.skills, i.truth.get(SKILL_STATE, i.me), "strike") *
          (1 - HOLD_BACK_COST * Math.min(1, Math.max(0, i.holdBack ?? 0))),
        hides: i.holdBack ?? 0,
        eye: fightEye(i.skills, i.truth.get(SKILL_STATE, i.me), "strike"),
        familiarity: fightFamiliarity(
          i.skills,
          i.truth.get(SKILL_STATE, i.me),
          i.target,
          styleOf(i.truth, i.target),
          i.start,
          day,
        ),
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
        eye: fightEye(i.skills, i.truth.get(SKILL_STATE, i.target), "strike"),
        familiarity: fightFamiliarity(
          i.skills,
          i.truth.get(SKILL_STATE, i.target),
          i.me,
          styleOf(i.truth, i.me),
          i.start,
          day,
        ),
        intent: "drive_off",
        at: { x: 0.7, y: 0 },
        unaware: theirBody.activity === "sleep",
      },
    ],
    start: i.start,
    light: i.light,
    rng: i.rng,
    cause: i.resume?.event ?? i.cause,
    // Con lectura (combat §5, §11): chances creídas, quiebre desde lo leído y fintas.
    reading: true,
    ...(i.control ? { control: i.me } : {}),
    ...(i.resume ? { resume: i.resume.snapshot } : {}),
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
      ...(result.paused ? { paused: result.paused.reason } : {}),
      seconds: result.seconds,
      outcomes: { [i.me]: mine.outcome, [i.target]: theirs.outcome },
      hits: result.log
        .filter((l) => l.kind === "hit")
        .map((l) => ({ t: l.t, by: l.actor, to: l.target, zone: l.zone, severity: l.severity })),
    },
    emissions: { sight: 1, sound: 0.8 },
    causes: [{ kind: "event", event: i.cause }],
  };
  // Pelear con alguien enseña su estilo a los dos (skills §2.3, combat §5).
  const strike = i.skills.forVerb("strike");
  const hours = result.seconds / 3600;
  return {
    seconds: result.seconds,
    myBody: mine.body,
    ...(strike
      ? {
          exposure: {
            skill: strike.skill.id,
            key: rivalKey(i.target),
            ...styleExposure(styleOf(i.truth, i.target)),
            hours,
          },
        }
      : {}),
    changes: [
      setComponent(BODY_STATE, i.target, theirs.body),
      ...(strike
        ? [
            setComponent(
              SKILL_STATE,
              i.target,
              exposeSkills(
                i.truth.get(SKILL_STATE, i.target),
                {
                  skill: strike.skill.id,
                  key: rivalKey(i.me),
                  ...styleExposure(styleOf(i.truth, i.me)),
                  hours,
                },
                i.start + result.seconds,
                day,
              ),
            ),
          ]
        : []),
      // Pausada: queda guardada para retomarla; si no, se limpia lo que hubiera.
      ...(result.paused
        ? [
            setComponent(FIGHT_STATE, i.me, {
              foe: i.target,
              snapshot: result.paused.snapshot,
              event: i.resume?.event ?? i.cause,
            }),
          ]
        : i.truth.get(FIGHT_STATE, i.me)
          ? [deleteComponent(FIGHT_STATE, i.me)]
          : []),
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
      ...(result.paused ? { paused: result.paused.reason } : {}),
    },
  };
}
