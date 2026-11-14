// La pelea del personaje con el mundo (combat.md §1, §12, §17): un golpe contra alguien vivo y
// con cuerpo es el comienzo de una pelea. Acá se arman los peleadores desde la verdad (cuerpo,
// rasgos, nivel de pelea), se corre `runFight` y lo que resulta vuelve como cambios de cuerpo y un
// evento con las causas. La sim no sabe de `game`: esto es el pegamento, como `cook` en act.ts.

import type { AgentId, EventId, HolderRef, ItemId, PlaceRef, Rng, Tick } from "../../core/index.ts";
import {
  type ActionPlan,
  atMercyOf,
  BODY_STATE,
  type Body,
  type BodyPlanDef,
  CULTIVATION_STATE,
  deleteComponent,
  ENTITY,
  type EventDraft,
  exposeTo,
  type FighterOutcome,
  type FightGist,
  type FightIntent,
  type FightSnapshot,
  familiarWith,
  fighterWeapon,
  holdBackWish,
  INNATE,
  ITEM_HOLD,
  ITEM_LOOK,
  ITEM_WEAR,
  type LineageDef,
  LOCATION,
  levelOf,
  OPINIONS,
  opinionKey,
  type PauseReason,
  PERSON,
  type PlanNode,
  RELATIONS,
  type ReadonlyWorldTruth,
  refinementOf,
  rivalKey,
  runFight,
  SKILL_STATE,
  type SkillCatalog,
  type Skills,
  STYLE_SHARE,
  type StateChange,
  setComponent,
  shedCarried,
  standardize,
  styleKey,
  THERMAL,
  type Trait,
  table,
  verbSkill,
  type WeaponDef,
  YIELDED,
  type Yielded,
} from "../../sim/index.ts";
import { beastFighter } from "./beasts.ts";

/** Una pelea pausada del personaje: contra quién y con qué retomarla (combat §16). */
export interface PausedFight {
  readonly foe: AgentId;
  readonly snapshot: FightSnapshot;
  /** El evento de la pelea que arrancó, causa de las heridas que siguen. */
  readonly event: EventId;
  /** Por qué se pausó, como lo notó el personaje (novel3-intent-panel). */
  readonly reason?: PauseReason;
  /** Para qué peleaba: retomar sin decir otra cosa sigue con esto. */
  readonly intent?: FightIntent;
}

export const FIGHT_STATE = table<PausedFight>("combat.fight_state");

/** Cuánto aguanta la pausa: pasado esto la pelea se enfrió y se separaron (calibración abierta). */
export const PAUSE_WINDOW = 30;

/** La pelea pausada del personaje que sigue viva, contra quien sea (novel3-intent-panel). */
export function anyLivePause(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  now: Tick,
): PausedFight | undefined {
  const p = truth.get(FIGHT_STATE, me);
  return p ? livePause(truth, me, p.foe, now) : undefined;
}

/** El primer paso que haría el plan (por la primera rama de cada secuencia o repetición). */
function firstStep(n: PlanNode): PlanNode | undefined {
  if (n.kind === "seq") return n.steps[0] && firstStep(n.steps[0]);
  if (n.kind === "until") return firstStep(n.body);
  return n;
}

/**
 * Irse en medio de una pelea es huir (novel3-intent-resolve-flee, combat §16): si el plan del
 * personaje arranca moviéndose con una pausa viva y el rival puede seguir, antes va un golpe con
 * `escape` que retoma la pelea. Si se zafa, el paso sigue; si queda en el suelo, el paso no sale.
 * Lee solo la verdad del turno, así que el replay arma lo mismo.
 */
export function fleeFirst(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  now: Tick,
  plan: ActionPlan,
): ActionPlan {
  const first = firstStep(plan.root);
  if (first?.kind !== "do" || first.verb !== "move") return plan;
  const paused = anyLivePause(truth, me, now);
  if (!paused || !canFight(truth, paused.foe)) return plan;
  const flee: PlanNode = {
    kind: "do",
    verb: "strike",
    args: [{ role: "target", entity: paused.foe }],
    manner: ["escape"],
  };
  return { ...plan, root: { kind: "seq", steps: [flee, plan.root] } };
}

/** Cuántos segundos le quedan a la pausa antes de enfriarse (0 si ya pasó). */
export const pauseLeft = (p: PausedFight, now: Tick): number =>
  Math.max(0, PAUSE_WINDOW - (now - p.snapshot.next));

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
  /** Opt-in: el núcleo de cada uno (`THERMAL`) entumece o deja inconsciente en la pelea (`applyCore`). */
  readonly coreEffects?: boolean;
  /**
   * Quien huye o cae suelta lo que lleva y abulta donde pasó (`shedCarried`,
   * play-refs-objects-source-flee); apagado solo en el replay de motores anteriores a `life-45`.
   */
  readonly shed?: boolean;
  /**
   * Opt-in (novel3-refined-wire): el cuerpo de cada uno sale de los umbrales que cruzó
   * (`CULTIVATION_STATE.stage`, `refinementOf`). Apagado, todos pelean como mortales.
   */
  readonly refined?: boolean;
  /**
   * Opt-in (novel3-weapons-wire): cada uno pelea con el arma que tiene en la mano (la de más
   * `rank` del catálogo, sin gastar del todo) y la gasta en `ITEM_WEAR`. Sin esto, a mano limpia.
   */
  readonly weapons?: readonly WeaponDef[];
  /**
   * Opt-in (novel3-beasts-fight-strike): los linajes del monte. Una bestia que bajó (`BEAST`) pelea
   * con el perfil de su linaje (arma natural, instinto, destreza) en vez de habilidades de persona.
   */
  readonly beasts?: readonly LineageDef[];
}

/** Lo que alguien tiene en la mano y sirve de arma (combat §6): el objeto, su forma y su desgaste. */
export interface Wielded {
  readonly item: ItemId;
  readonly def: WeaponDef;
  readonly wear: number;
}

/**
 * El arma en la mano de `who` (novel3-weapons-wire): un objeto que lleva encima (sin lugar propio),
 * de una forma del catálogo y sin gastar del todo; entre varias, la de más `rank` y después el id.
 */
export function wieldedWeapon(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  weapons: readonly WeaponDef[],
): Wielded | undefined {
  const byShape = new Map(weapons.map((w) => [w.shape, w]));
  let best: Wielded | undefined;
  for (const item of [...truth.ids(ITEM_HOLD)].sort() as ItemId[]) {
    if (!String(item).startsWith("item:")) continue;
    if (truth.get(ITEM_HOLD, item)?.possession !== (who as unknown as HolderRef)) continue;
    if (truth.get(LOCATION, item) !== undefined) continue;
    if (truth.get(ENTITY, item)?.endedAt !== undefined) continue;
    const def = byShape.get(truth.get(ITEM_LOOK, item)?.shape ?? "");
    if (!def) continue;
    const wear = truth.get(ITEM_WEAR, item)?.wear ?? 0;
    if (wear >= 1) continue;
    if (best === undefined || def.rank > best.def.rank) best = { item, def, wear };
  }
  return best;
}

/** Cuánto más rápido tiene que ser uno para que el otro no alcance a seguirlo. */
export const BLUR_RATIO = 1.4;

/** Los finales en que a alguien se le cae lo que lleva: corrió o quedó en el suelo. */
const SHEDS: ReadonlySet<FighterOutcome> = new Set(["fled", "down", "dead"]);

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

/**
 * Si el rival decide pelear por debajo de su nivel para que el otro se confíe (skills §9): el astuto
 * y audaz que cree que le sobra, con lo que cree de quien le pega (su opinión ajena). 0 es no.
 * Sale del rng de la pelea, así que es determinista.
 */
function npcHoldBack(i: StrikeFightInput): number {
  if (i.target === i.me) return 0;
  const use = i.skills.forVerb("strike");
  const p = i.truth.get(PERSON, i.target);
  const n = i.truth.get(INNATE, i.target);
  if (!use || !p || !n) return 0;
  const believed = i.truth.get(OPINIONS, i.target)?.[opinionKey(i.me, use.skill.id)];
  const wish = holdBackWish(
    standardize(n, i.traits, p.sex),
    verbSkill(i.skills, i.truth.get(SKILL_STATE, i.target), "strike"),
    believed?.estimate.level,
  );
  return i.rng.fork("hold-back", i.target).chance(wish.chance) ? wish.amount : 0;
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

/** Cuánto tiene que conocerlo para aceptarle una práctica (calibración abierta). */
export const SPAR_FAMILIARITY = 0.1;
/** Con menos afecto que esto no practica con él: no le tiene confianza (calibración abierta). */
export const SPAR_AFFECTION = -0.3;

/**
 * Si `target` acepta practicar con `me` (novel3-spar-act, combat §13): puede pelear, está despierto,
 * no está en otra pelea, lo conoce y no le tiene inquina. Se lee de la verdad del turno.
 */
export function sparWilling(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  target: AgentId,
  now: Tick,
): boolean {
  if (target === me || !canFight(truth, target)) return false;
  if (truth.get(BODY_STATE, target)?.activity === "sleep") return false;
  if (truth.get(FIGHT_STATE, target) || truth.get(YIELDED, target)) return false;
  if (atMyMercy(truth, target, me, now)) return false;
  const dims = truth.get(RELATIONS, target)?.toward[me]?.dims;
  return (dims?.familiarity ?? 0) >= SPAR_FAMILIARITY && (dims?.affection ?? 0) > SPAR_AFFECTION;
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
  const theirHold = npcHoldBack(i);
  const coreOf = (id: AgentId) => {
    const t = i.coreEffects ? i.truth.get(THERMAL, id) : undefined;
    return t ? { coreC: t.coreC } : {};
  };
  const stageOf = (id: AgentId) =>
    i.refined ? (i.truth.get(CULTIVATION_STATE, id)?.stage ?? 0) : 0;
  const refinedOf = (id: AgentId) => {
    const stage = stageOf(id);
    return stage > 0 ? { refined: refinementOf(stage) } : {};
  };
  const person = (id: AgentId) => i.truth.get(PERSON, id);
  const z = (id: AgentId) => {
    const p = person(id);
    const n = i.truth.get(INNATE, id);
    return p && n ? standardize(n, i.traits, p.sex) : {};
  };
  const myWeapon = i.weapons ? wieldedWeapon(i.truth, i.me, i.weapons) : undefined;
  const theirWeapon = i.weapons ? wieldedWeapon(i.truth, i.target, i.weapons) : undefined;
  const armed = (w: Wielded | undefined) => (w ? { weapon: fighterWeapon(w.def, w.wear) } : {});
  // Una bestia pelea con su linaje: ni habilidades, ni estilos, ni contenerse (novel3-beasts-fight-strike).
  const wild = (id: AgentId) => {
    const b = i.beasts ? beastFighter(i.truth, id, i.beasts) : undefined;
    return b ? { beast: b.beast, skill: b.skill, eye: b.skill, familiarity: 0, hides: 0 } : {};
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
        ...coreOf(i.me),
        ...refinedOf(i.me),
        ...armed(myWeapon),
        ...wild(i.me),
      },
      {
        id: i.target,
        side: "them",
        plan: plan(theirBody),
        body: theirBody,
        z: z(i.target),
        skill:
          verbSkill(i.skills, i.truth.get(SKILL_STATE, i.target), "strike") *
          (1 - HOLD_BACK_COST * theirHold),
        hides: theirHold,
        eye: fightEye(i.skills, i.truth.get(SKILL_STATE, i.target), "strike"),
        familiarity: fightFamiliarity(
          i.skills,
          i.truth.get(SKILL_STATE, i.target),
          i.me,
          styleOf(i.truth, i.me),
          i.start,
          day,
        ),
        // En la práctica los dos frenan el golpe; si no, el otro se defiende para echarlo.
        intent: i.intent === "spar" ? "spar" : "drive_off",
        at: { x: 0.7, y: 0 },
        ...coreOf(i.target),
        ...refinedOf(i.target),
        ...armed(theirWeapon),
        ...wild(i.target),
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
  const myStage = stageOf(i.me);
  const theirStage = stageOf(i.target);
  const speed = (stage: number) => refinementOf(stage).speed;
  const blur =
    speed(theirStage) >= speed(myStage) * BLUR_RATIO
      ? "foe"
      : speed(myStage) >= speed(theirStage) * BLUR_RATIO
        ? "me"
        : undefined;
  const event: EventDraft = {
    kind: i.intent === "spar" ? "combat.spar" : "combat.fight",
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
      // Los umbrales cruzados de cada uno, si alguno pelea con el cuerpo refinado.
      ...(myStage > 0 || theirStage > 0
        ? { stages: { [i.me]: myStage, [i.target]: theirStage } }
        : {}),
      // Con qué peleó cada uno y cómo quedó el arma (novel3-weapons-wire).
      ...(myWeapon || theirWeapon
        ? {
            weapons: Object.fromEntries(
              (
                [
                  [i.me, myWeapon, mine.weaponWear],
                  [i.target, theirWeapon, theirs.weaponWear],
                ] as const
              ).flatMap(([id, w, wear]) =>
                w ? [[id, { item: w.item, shape: w.def.shape, wear: wear ?? w.wear }]] : [],
              ),
            ),
          }
        : {}),
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
      // El arma se gasta con cada golpe que mete o para; a 1 ya no sirve (novel3-weapons-wire).
      ...(
        [
          [myWeapon, mine.weaponWear],
          [theirWeapon, theirs.weaponWear],
        ] as const
      ).flatMap(([w, wear]) =>
        w && wear !== undefined && wear !== w.wear
          ? [setComponent(ITEM_WEAR, w.item, { ...i.truth.get(ITEM_WEAR, w.item), wear })]
          : [],
      ),
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
              reason: result.paused.reason,
              intent: i.intent,
            }),
          ]
        : i.truth.get(FIGHT_STATE, i.me)
          ? [deleteComponent(FIGHT_STATE, i.me)]
          : []),
      // Quien se rinde queda a merced del que ganó: rematarlo o perdonarlo es de ahora en más.
      // En la práctica conceder no deja a nadie a merced del otro.
      ...(theirs.outcome === "yielded" && mine.outcome === "standing" && i.intent !== "spar"
        ? [
            setComponent(YIELDED, i.target, {
              to: i.me,
              at: i.start + result.seconds,
              event: i.cause,
            }),
          ]
        : []),
      ...(i.shed
        ? [mine, theirs].flatMap((f) =>
            SHEDS.has(f.outcome) ? shedCarried(i.truth, f.id as AgentId, i.place, i.cause) : [],
          )
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
      ...(blur ? { blur } : {}),
      ...(i.intent === "spar" ? { spar: true } : {}),
      ...(myWeapon ? { weapon: myWeapon.def.shape } : {}),
      ...(theirWeapon ? { theirWeapon: theirWeapon.def.shape } : {}),
      ...(myWeapon && (mine.weaponWear ?? 0) >= 1 ? { weaponSpent: true } : {}),
    },
  };
}
