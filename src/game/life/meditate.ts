// Meditar (novel-cult-meditate, cultivation §4): cada `action.meditate` suma a la sensibilidad al qi
// de quien meditó según su talento, su calma (el dolor y el hambre la bajan) y el qi de la aldea; la
// primera vez que cruza el umbral nace `cultivation.sensed_qi`, causado por esa meditación y por el
// talento. Sin raíz la sensibilidad no se mueve y solo quedan las horas: se narra que no pasa nada.
// Solo con el cultivo encendido (la ley en la verdad).
//
// Absorber (novel-cult-absorb): quien ya lo sentía antes de esta meditación saca qi de la celda de la
// aldea hacia su recipiente (`absorbDraw`: lo pide el cuerpo, lo acota la celda y la capacidad del
// primer umbral), con la pureza de cuánto se parece a su raíz; la celda lo anota en `QI_TAKEN` (en
// la fila del plano, repuesto por su regeneración) y cada toma deja `cultivation.absorbed`.
//
// Romper (novel-cult-break): `action.breakthrough` de quien ya siente el qi tira contra el cuello de
// botella del umbral que le falta (`breakOutcome`); el éxito sube el tramo y el fundamento, el
// retroceso devuelve parte del qi a la celda (baja `QI_TAKEN`: conservación) y daña los meridianos.
// Deja `cultivation.breakthrough`, visible si pasó algo (el qi se arremolina, escupe sangre). En el
// mismo proceso que meditar porque los dos escriben la fila de la celda.
//
// La técnica (novel-cult-school): quien aprendió la de entrada de una secta medita y absorbe con su
// factor (lo que pide; la celda y la capacidad siguen acotando).
//
// La tribulación (novel2-trib-gather): si el umbral ofende al Cielo (`tribulationDue`), el intento no
// se resuelve en el acto: el Cielo saca qi de la reserva (`TRIBULATION`, débito en `QI_TAKEN`), las
// nubes se juntan a la vista y `tribulationProcess` agenda la caída; al verla, la ruptura se resuelve
// y la energía vuelve a la reserva. Mientras hay una en curso, otro intento no hace nada.
//
// Las olas (novel2-trib-waves): antes de resolver, la caída se reparte en rayos que hieren el cuerpo
// y los meridianos según lo que se aguanta (`strikeWaves`) y templan lo aguantado; el templado suma
// a la calidad si rompe. Escribe el cuerpo acá (percepción: nadie más lo escribe en esta fase).

import type { AgentId, EntityRef, Event, EventId, Rng } from "../../core/index.ts";
import {
  ABSORBED_EVENT,
  type Aptitude,
  absorbDraw,
  absorbWant,
  aptitudeOf,
  BLIND_PREP,
  BODY_STATE,
  type Body,
  type BodyPlanDef,
  BREAKTHROUGH_EVENT,
  breakAidOf,
  breakOutcome,
  breakPreparation,
  breaksBlind,
  CAVE_FOCUS,
  CULTIVATION_LAW,
  CULTIVATION_STATE,
  CULTIVATION_TECHNIQUE,
  type CultivationLaw,
  type CultivationState,
  deleteComponent,
  ENTITY,
  type EventDraft,
  gatherHours,
  guardShare,
  HEAVEN_LAW,
  injure,
  isSectCave,
  type KnownTechnique,
  LOCATION,
  type LocalMap,
  MASTER_OF,
  MAX_MERIDIAN_DAMAGE,
  type MasterGuide,
  masterGuide,
  meditationGain,
  methodCovers,
  mixedPurity,
  NO_GUIDE,
  needsFrom,
  PILL_TAKEN_EVENT,
  type PillDef,
  PLACE,
  PLACE_QI,
  type PlaceQi,
  type ProcessDef,
  patchOf,
  QI_TAKEN,
  type QiTaken,
  qiFactor,
  type ReadonlyWorldTruth,
  regrown,
  rootMatch,
  type ScheduleRequest,
  type School,
  SECT_SCHOOL,
  SENSE_THRESHOLD,
  SENSED_QI_EVENT,
  type StateChange,
  setComponent,
  swallowGather,
  TALENT,
  TRIBULATION,
  TRIBULATION_GATHERS_EVENT,
  TRIBULATION_STRIKES_EVENT,
  TRIBULATION_WAVE_EVENT,
  type Tribulation,
  tribulationDue,
  tribulationEnergy,
  vesselCapacity,
  WAVE_MERIDIAN,
  waveCount,
  waveForce,
  waveTemper,
} from "../../sim/index.ts";
import { ART_EVENT } from "./art.ts";
import { TRIBULATION_PROCESS } from "./tribulation.ts";

export const MEDITATE_PROCESS = "life.cultivation.meditate";
/** Una hora de meditar o un intento de romper de la rutina delegada (novel-cult-delegate). */
export const ROUTINE_MEDITATE_EVENT = "routine.meditate";
export const ROUTINE_BREAK_EVENT = "routine.breakthrough";

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/** Quién meditó y cuántas horas, de un `action.meditate` o de una hora de la rutina delegada. */
export function meditation(e: Event): { who: AgentId; hours: number } | undefined {
  if (e.kind !== "action.meditate" && e.kind !== ROUTINE_MEDITATE_EVENT) return undefined;
  const who = e.actors[0] as AgentId | undefined;
  const seconds = (e.data as { seconds?: unknown } | null)?.seconds;
  if (!who || typeof seconds !== "number" || seconds <= 0) return undefined;
  return { who, hours: seconds / 3600 };
}

/** Quién tragó qué píldora, de un `action.consume` que gastó una. */
function pillTaken(
  e: Event,
  pills: ReadonlyMap<string, PillDef>,
): { who: AgentId; pill: PillDef } | undefined {
  if (e.kind !== "action.consume") return undefined;
  const eff = (e.data as { effect?: { good?: unknown; units?: unknown } } | null)?.effect;
  const pill = typeof eff?.good === "string" ? pills.get(eff.good) : undefined;
  const who = e.actors[0] as AgentId | undefined;
  if (!pill || !who || typeof eff?.units !== "number" || eff.units <= 0) return undefined;
  return { who, pill };
}

/** Quién intentó romper, de un `action.breakthrough` o de la rutina delegada. */
export function breakAttempt(e: Event): AgentId | undefined {
  if (e.kind !== "action.breakthrough" && e.kind !== ROUTINE_BREAK_EVENT) return undefined;
  return e.actors[0] as AgentId | undefined;
}

/** Los meridianos que quedan sanos: el daño de los retrocesos los achica. */
function healthyAptitude(apt: Aptitude, s: CultivationState): Aptitude {
  const damage = s.meridianDamage ?? 0;
  return damage > 0 ? { ...apt, meridians: apt.meridians * (1 - damage) } : apt;
}

/**
 * Una ruptura: la tirada contra el cuello de botella del umbral que falta. Devuelve la fila nueva,
 * el débito de la celda (el qi perdido vuelve a ella) y el evento; sin sentir el qi, nada.
 */
function resolveBreak(
  e: Event,
  who: AgentId,
  law: CultivationLaw,
  apt: Aptitude,
  before: CultivationState,
  calm: number,
  taken: QiTaken | undefined,
  rng: Rng,
  /** Sin método que cubra el tramo al que se llega (novel2-method-school): la preparación baja. */
  blind: boolean,
  /** Lo que templó una tribulación aguantada: suma a la calidad si rompe. */
  temper = 0,
  /** La guía del maestro presente (novel2-master-guide): suma a la preparación. */
  guide: MasterGuide = NO_GUIDE,
): { next: CultivationState; taken: QiTaken | undefined; event: EventDraft } | undefined {
  if (!before.sensed) return undefined;
  const stage = before.stage ?? 0;
  const threshold = law.paths[0]?.thresholds[stage];
  if (!threshold) return undefined;
  const qi = before.qi ?? 0;
  const capacity = threshold.capacity;
  const ready = breakPreparation(apt, {
    qi,
    capacity,
    purity: before.purity ?? 0,
    calm,
    meridianDamage: before.meridianDamage ?? 0,
    foundation: before.foundation ?? 0,
  });
  // La píldora de romper tragada antes (novel2-pills-take) empuja; se gasta en este intento.
  const aid = before.aid;
  const prep = round4(
    Math.min(1, (blind ? ready * BLIND_PREP : ready) + (aid?.prep ?? 0) + guide.prep),
  );
  const outcome = breakOutcome(prep, threshold.bottleneck, rng.float(), rng.float());
  const { aid: _spent, ...rest } = before;
  let next: CultivationState = rest;
  let lost = 0;
  if (outcome.kind === "success") {
    next = {
      ...rest,
      stage: stage + 1,
      foundation: round4(
        (before.foundation ?? 0) + Math.max(0, outcome.quality - (aid?.cost ?? 0)) + temper,
      ),
    };
  } else if (outcome.kind === "backlash") {
    lost = round4(qi * outcome.lostShare);
    next = {
      ...rest,
      qi: round4(qi - lost),
      meridianDamage: round4(
        Math.min(MAX_MERIDIAN_DAMAGE, (before.meridianDamage ?? 0) + outcome.damage),
      ),
    };
  }
  const back =
    taken && lost > 0
      ? {
          ...taken,
          taken: round4(Math.max(0, taken.taken - lost)),
          drawn: round4(taken.drawn - lost),
        }
      : taken;
  const seen = outcome.kind === "success" ? 0.5 : outcome.kind === "backlash" ? 0.3 : 0;
  return {
    next,
    taken: back,
    event: {
      kind: BREAKTHROUGH_EVENT,
      actors: [who],
      place: e.place,
      data: {
        outcome: outcome.kind,
        threshold: threshold.id,
        prep,
        lost,
        ...outcome,
        ...(blind ? { blind } : {}),
        ...(aid ? { aid: aid.pill } : {}),
        ...(temper > 0 ? { temper } : {}),
        ...(guide.prep > 0 ? { guided: guide.prep } : {}),
      },
      emissions: seen > 0 ? { sight: seen } : {},
      causes: [
        { kind: "event", event: e.id },
        { kind: "state", entity: who, key: CULTIVATION_STATE.name },
        ...(guide.prep > 0 ? [{ kind: "state" as const, entity: who, key: MASTER_OF.name }] : []),
      ],
    },
  };
}

/** El método que alguien sabe y la escuela que lo enseñó. */
function methodOf(
  truth: ReadonlyWorldTruth,
  who: AgentId,
): { known: KnownTechnique | undefined; school: School | undefined } {
  const known = truth.get(CULTIVATION_TECHNIQUE, who);
  return { known, school: known ? truth.get(SECT_SCHOOL, known.org) : undefined };
}

/** Si romper desde `stage` va a ciegas para `who` (novel2-method-school). */
function blindAt(truth: ReadonlyWorldTruth, who: AgentId, stage: number): boolean {
  const { known, school } = methodOf(truth, who);
  return breaksBlind(school, known, stage);
}

/**
 * La guía de su maestro (novel2-master-guide): vivo, en el mismo hex y más arriba en el camino.
 * Sin maestro, nada.
 */
function guideOf(truth: ReadonlyWorldTruth, who: AgentId, stage: number): MasterGuide {
  const bond = truth.get(MASTER_OF, who);
  if (!bond) return NO_GUIDE;
  const master = bond.master;
  const alive = truth.has(ENTITY, master) && truth.get(ENTITY, master)?.endedAt === undefined;
  const here = truth.get(LOCATION, who);
  const there = truth.get(LOCATION, master);
  return masterGuide({
    present: alive && here !== undefined && there !== undefined && here.hex === there.hex,
    masterStage: truth.get(CULTIVATION_STATE, master)?.stage ?? 0,
    discipleStage: stage,
  });
}

/** Lo que rinde el método al meditar en `stage`: nada fuera de su reino (o sin método). */
function methodFactor(truth: ReadonlyWorldTruth, who: AgentId, stage: number): number {
  const { known, school } = methodOf(truth, who);
  if (!known) return 1;
  return !school || methodCovers(school, known, stage) ? known.factor : 1;
}

/**
 * Las olas de una tribulación que cae (novel2-trib-waves): la energía repartida en `t.waves` rayos;
 * cada uno pega con la fuerza que deja pasar lo que aguanta quien rompe (`waveForce`), le hace una
 * herida (contusa: la quemadura llega con su tipo de herida) y le daña los meridianos; si sigue vivo,
 * lo templa. Un rayo en la cabeza puede matar y ahí se cortan.
 */
function strikeWaves(
  e: Event,
  who: AgentId,
  t: Tribulation,
  state: CultivationState,
  law: CultivationLaw,
  plans: ReadonlyMap<string, BodyPlanDef>,
  ctx: { readonly truth: ReadonlyWorldTruth; readonly now: number; readonly rng: Rng },
  /** El maestro que se pone delante (novel2-master-guard): carga `share` de cada ola. */
  guard?: { readonly who: AgentId; readonly share: number; readonly state: CultivationState },
): {
  state: CultivationState;
  body: Body | undefined;
  temper: number;
  dead: boolean;
  events: EventDraft[];
  /** Cómo quedó el maestro que cargó parte (sin guardia, nada). */
  guarded?: { readonly state: CultivationState; readonly body: Body | undefined };
} {
  let body = ctx.truth.get(BODY_STATE, who);
  // El maestro: su cuerpo y su recipiente aguantan su parte con lo suyo.
  let gBody = guard ? ctx.truth.get(BODY_STATE, guard.who) : undefined;
  const gPlan = gBody ? plans.get(gBody.plan) : undefined;
  const gCapacity = guard ? vesselCapacity(law, guard.state.stage ?? 0) : 0;
  let gMeridian = guard?.state.meridianDamage ?? 0;
  let gHit = false;
  const plan = body ? plans.get(body.plan) : undefined;
  const capacity = vesselCapacity(law, state.stage ?? 0);
  const per = t.waves > 0 ? t.energy / t.waves : 0;
  let meridian = state.meridianDamage ?? 0;
  let temper = 0;
  let dead = false;
  let hit = false;
  const events: EventDraft[] = [];
  for (let i = 0; i < t.waves; i++) {
    if (!body || !plan || body.death) break;
    const rng = ctx.rng.fork("tribulation", who, t.attempt, i);
    // El maestro se pone delante (novel2-master-guard): carga su parte con su cuerpo, mientras viva.
    const share = guard && gBody && gPlan && !gBody.death ? guard.share : 0;
    let shielded: Record<string, unknown> | undefined;
    if (guard && gBody && gPlan && share > 0) {
      const g = ctx.rng.fork("guard", who, t.attempt, i);
      const gForce = waveForce(
        per * share,
        {
          capacity: gCapacity,
          qi: guard.state.qi ?? 0,
          foundation: guard.state.foundation ?? 0,
          health: 1 - Math.min(1, openOf(gBody) / 2),
        },
        g.float(),
      );
      const gInjury = injure(
        gPlan,
        gBody,
        { kind: "blunt", force: gForce, dirt: 0, cause: e.id as EventId, at: ctx.now },
        g.fork("injure"),
      );
      gBody = gInjury.body;
      gHit = true;
      gMeridian = round4(Math.min(MAX_MERIDIAN_DAMAGE, gMeridian + WAVE_MERIDIAN * gForce));
      shielded = {
        by: guard.who,
        share,
        force: gForce,
        zone: gInjury.wound.zone,
        severity: round4(gInjury.wound.severity),
        ...(gInjury.died ? { died: gInjury.died } : {}),
      };
    }
    // Las heridas abiertas pesan a medias: dos graves dejan el cuerpo sin aguante.
    const open = openOf(body);
    const force = waveForce(
      per * (1 - share),
      {
        capacity,
        qi: state.qi ?? 0,
        foundation: state.foundation ?? 0,
        health: 1 - Math.min(1, open / 2),
      },
      rng.float(),
    );
    const injury = injure(
      plan,
      body,
      { kind: "blunt", force, dirt: 0, cause: e.id as EventId, at: ctx.now },
      rng.fork("injure"),
    );
    body = injury.body;
    hit = true;
    meridian = round4(Math.min(MAX_MERIDIAN_DAMAGE, meridian + WAVE_MERIDIAN * force));
    if (!injury.died) temper = round4(temper + waveTemper(force));
    events.push({
      kind: TRIBULATION_WAVE_EVENT,
      actors: [who],
      place: e.place,
      data: {
        wave: i + 1,
        of: t.waves,
        energy: round4(per),
        force,
        zone: injury.wound.zone,
        severity: round4(injury.wound.severity),
        ...(injury.died ? { died: injury.died } : {}),
        ...(shielded ? { guard: shielded } : {}),
      },
      emissions: { sight: 1, sound: 1 },
      causes: [
        { kind: "event", event: e.id },
        { kind: "state", entity: who, key: CULTIVATION_STATE.name },
        ...(shielded ? [{ kind: "state" as const, entity: who, key: MASTER_OF.name }] : []),
      ],
    });
    if (injury.died) {
      dead = true;
      break;
    }
  }
  return {
    state:
      meridian !== (state.meridianDamage ?? 0) ? { ...state, meridianDamage: meridian } : state,
    body: hit ? body : undefined,
    temper,
    dead,
    events,
    ...(guard && gHit
      ? {
          guarded: {
            state:
              gMeridian !== (guard.state.meridianDamage ?? 0)
                ? { ...guard.state, meridianDamage: gMeridian }
                : guard.state,
            body: gBody,
          },
        }
      : {}),
  };
}

/** Lo abierto de las heridas de un cuerpo (lo que todavía no cerró). */
function openOf(body: Body): number {
  return body.wounds
    .filter((w) => w.stage !== "healed")
    .reduce((sum, w) => sum + w.severity * (1 - w.repair), 0);
}

/**
 * El maestro que se pone delante en la tribulación de `who` (novel2-master-guard): vivo, en el mismo
 * hex y más arriba. Sin eso, nadie.
 */
function guardOf(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  stage: number,
  stateOf: (id: AgentId) => CultivationState,
): { who: AgentId; share: number; state: CultivationState } | undefined {
  const bond = truth.get(MASTER_OF, who);
  if (!bond) return undefined;
  const master = bond.master;
  if (!truth.has(ENTITY, master) || truth.get(ENTITY, master)?.endedAt !== undefined) {
    return undefined;
  }
  const here = truth.get(LOCATION, who);
  const there = truth.get(LOCATION, master);
  const state = stateOf(master);
  const share = guardShare({
    present: here !== undefined && there !== undefined && here.hex === there.hex,
    masterStage: state.stage ?? 0,
    discipleStage: stage,
  });
  return share > 0 ? { who: master, share, state } : undefined;
}

/** La calma para meditar: el dolor la corta, el hambre y la sed la distraen. */
function calmOf(plans: ReadonlyMap<string, BodyPlanDef>, b: Body | undefined): number {
  const plan = b ? plans.get(b.plan) : undefined;
  if (!b || !plan) return 1;
  const n = needsFrom(plan, b);
  const distraction = Math.max(n.hunger ?? 0, n.thirst ?? 0);
  return Math.max(0, 1 - (n.pain ?? 0) - 0.3 * distraction);
}

/**
 * La reserva de qi donde está `who` (novel-sect-seat-hall-qi): con varios parches, la del lugar con
 * `PLACE_QI` cuyo hex está en el mismo parche (la sede); en el de la aldea, o sin otra, la del plano.
 */
export function qiPoolOf(
  truth: ReadonlyWorldTruth,
  map: LocalMap,
  plane: EntityRef,
  who: AgentId,
): EntityRef {
  const hex = truth.get(LOCATION, who)?.hex;
  if (hex === undefined || map.patches === undefined) return plane;
  const base = patchOf(map, hex).base;
  if (base === 0) return plane;
  for (const id of [...truth.ids(PLACE_QI)].sort()) {
    if (id === plane) continue;
    const at = truth.get(PLACE, id)?.hexes[0];
    if (at !== undefined && patchOf(map, at).base === base) return id;
  }
  return plane;
}

export function meditateProcess(o: {
  readonly bodyPlans: readonly BodyPlanDef[];
  /** Ticks por año, para la regeneración de la celda. */
  readonly yearTicks: number;
  /**
   * Opt-in (novel-sect-seat-hall-qi): el mapa con parches; con él cada uno medita sobre la reserva
   * del parche donde está (`qiPoolOf`). Sin él, todos sobre la del plano.
   */
  readonly map?: LocalMap;
  /**
   * Ticks por día (novel2-trib-gather): con él, los umbrales que ofenden al Cielo llaman
   * tribulación (las horas de nubes se cuentan con él). Sin él, toda ruptura se resuelve en el acto.
   */
  readonly dayTicks?: number;
  /** Las píldoras (novel2-pills-take): con ellas, tragar una (`action.consume`) hace lo suyo. */
  readonly pills?: readonly PillDef[];
}): ProcessDef {
  const plans = new Map(o.bodyPlans.map((p) => [p.id, p]));
  const pillByUnit = new Map((o.pills ?? []).map((p) => [`good:${p.good}`, p] as const));
  const pooled = o.map?.patches !== undefined;
  return {
    id: MEDITATE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [
      CULTIVATION_LAW.name,
      PLACE_QI.name,
      TALENT.name,
      BODY_STATE.name,
      CULTIVATION_STATE.name,
      QI_TAKEN.name,
      CULTIVATION_TECHNIQUE.name,
      SECT_SCHOOL.name,
      LOCATION.name,
      MASTER_OF.name,
      ENTITY.name,
      ...(pooled ? [PLACE.name] : []),
      ...(o.dayTicks !== undefined ? [HEAVEN_LAW.name, TRIBULATION.name] : []),
    ],
    writes: [
      CULTIVATION_STATE.name,
      QI_TAKEN.name,
      ...(o.dayTicks !== undefined ? [TRIBULATION.name, BODY_STATE.name] : []),
    ],
    run(ctx) {
      const plane = ctx.truth.ids(CULTIVATION_LAW)[0];
      const law = plane ? ctx.truth.get(CULTIVATION_LAW, plane) : undefined;
      if (!plane || !law) return {};
      const heaven = o.dayTicks !== undefined ? ctx.truth.get(HEAVEN_LAW, plane) : undefined;
      /** Las tribulaciones que esta corrida abre (`Tribulation`) o cierra (`null`). */
      const tribs = new Map<AgentId, Tribulation | null>();
      /** Los cuerpos que golpearon las olas. */
      const bodies = new Map<AgentId, Body>();
      const schedule: ScheduleRequest[] = [];
      const pending = (who: AgentId): Tribulation | undefined => {
        const t = tribs.get(who);
        return t === null ? undefined : (t ?? ctx.truth.get(TRIBULATION, who));
      };
      // Cada reserva con su débito; la del plano es la de la aldea.
      const pools = new Map<
        EntityRef,
        { place: PlaceQi | undefined; factor: number; row?: QiTaken; taken?: QiTaken }
      >();
      const poolFor = (who: AgentId): EntityRef => {
        const id = pooled && o.map ? qiPoolOf(ctx.truth, o.map, plane, who) : plane;
        if (!pools.has(id)) {
          const place: PlaceQi | undefined = ctx.truth.get(PLACE_QI, id);
          const row = ctx.truth.get(QI_TAKEN, id);
          pools.set(id, {
            place,
            factor: qiFactor(place),
            ...(row ? { row } : {}),
            ...(place && row ? { taken: regrown(row, place, ctx.now, o.yearTicks) } : {}),
          });
        }
        return id;
      };
      const rows = new Map<AgentId, CultivationState>();
      const events: EventDraft[] = [];
      const stateOf = (who: AgentId): CultivationState =>
        rows.get(who) ?? ctx.truth.get(CULTIVATION_STATE, who) ?? { sensitivity: 0, hours: 0 };
      for (const e of ctx.recent) {
        // Lanzó una técnica de ataque (novel3-technique-act): el qi sale del recipiente y vuelve a
        // la reserva de donde está; un contragolpe le deja los meridianos dañados.
        if (e.kind === ART_EVENT) {
          const caster = e.actors[0] as AgentId | undefined;
          const d = (e.data ?? {}) as { spent?: number; backlash?: number };
          const spent = d.spent ?? 0;
          const backlash = d.backlash ?? 0;
          if (!caster || (spent <= 0 && backlash <= 0)) continue;
          const before = stateOf(caster);
          rows.set(caster, {
            ...before,
            qi: round4(Math.max(0, (before.qi ?? 0) - spent)),
            ...(backlash > 0
              ? { meridianDamage: round4(Math.min(1, (before.meridianDamage ?? 0) + backlash)) }
              : {}),
          });
          const back = pools.get(poolFor(caster)) as { taken?: QiTaken };
          if (back.taken) {
            back.taken = { ...back.taken, taken: round4(Math.max(0, back.taken.taken - spent)) };
          }
          continue;
        }
        // La tribulación cayó: la energía vuelve a su reserva y la ruptura se resuelve.
        const struck = e.kind === TRIBULATION_STRIKES_EVENT ? (e.actors[0] as AgentId) : undefined;
        if (struck) {
          const t = pending(struck);
          if (!t) continue;
          tribs.set(struck, null);
          poolFor(struck);
          const back = pools.get(t.pool);
          if (back?.taken) {
            back.taken = { ...back.taken, taken: round4(Math.max(0, back.taken.taken - t.energy)) };
          }
          const talent = ctx.truth.get(TALENT, struck);
          if (!talent) continue;
          const struckState = stateOf(struck);
          const guard = guardOf(ctx.truth, struck, struckState.stage ?? 0, stateOf);
          const waved = strikeWaves(e, struck, t, struckState, law, plans, ctx, guard);
          events.push(...waved.events);
          if (waved.body) bodies.set(struck, waved.body);
          if (guard && waved.guarded) {
            rows.set(guard.who, waved.guarded.state);
            if (waved.guarded.body) bodies.set(guard.who, waved.guarded.body);
          }
          rows.set(struck, waved.state);
          // Murió bajo el rayo: no hay ruptura que resolver.
          if (waved.dead) continue;
          const before = waved.state;
          const apt = healthyAptitude(aptitudeOf(law, talent.innate), before);
          const calm = calmOf(plans, waved.body ?? ctx.truth.get(BODY_STATE, struck));
          const pool = pools.get(poolFor(struck)) as { taken?: QiTaken };
          const r = resolveBreak(
            e,
            struck,
            law,
            apt,
            before,
            calm,
            pool.taken,
            ctx.rng,
            blindAt(ctx.truth, struck, before.stage ?? 0),
            waved.temper,
            guideOf(ctx.truth, struck, before.stage ?? 0),
          );
          if (!r) continue;
          rows.set(struck, r.next);
          if (r.taken) pool.taken = r.taken;
          else delete pool.taken;
          events.push(r.event);
          continue;
        }
        const breaker = breakAttempt(e);
        if (breaker) {
          const talent = ctx.truth.get(TALENT, breaker);
          if (!talent) continue;
          // Ya hay nubes sobre él: el intento no agrega nada.
          if (pending(breaker)) continue;
          const before = stateOf(breaker);
          const threshold = law.paths[0]?.thresholds[before.stage ?? 0];
          if (
            o.dayTicks !== undefined &&
            heaven &&
            before.sensed &&
            threshold &&
            tribulationDue(heaven, threshold.transgression)
          ) {
            const poolId = poolFor(breaker);
            const pool = pools.get(poolId) as { place?: PlaceQi; taken?: QiTaken };
            const inCell =
              pool.place && pool.taken ? Math.max(0, pool.place.level - pool.taken.taken) : 0;
            const energy = tribulationEnergy(
              heaven,
              threshold.transgression,
              threshold.capacity,
              inCell,
            );
            if (pool.taken && energy > 0) {
              pool.taken = { ...pool.taken, taken: round4(pool.taken.taken + energy) };
            }
            const hours = gatherHours(heaven, threshold.transgression);
            const strikeAt = ctx.now + Math.max(1, Math.round((hours * o.dayTicks) / 24));
            tribs.set(breaker, {
              threshold: threshold.id,
              stage: before.stage ?? 0,
              energy,
              waves: waveCount(heaven, threshold.transgression),
              pool: poolId,
              gatheredAt: ctx.now,
              strikeAt,
              place: e.place,
              attempt: e.id,
            });
            schedule.push({
              at: strikeAt,
              phase: "physics",
              process: TRIBULATION_PROCESS,
              scope: breaker,
              reason: { kind: "event", event: e.id },
            });
            events.push({
              kind: TRIBULATION_GATHERS_EVENT,
              actors: [breaker],
              place: e.place,
              data: { threshold: threshold.id, energy, hours, strikeAt },
              emissions: { sight: 1 },
              causes: [
                { kind: "event", event: e.id },
                { kind: "state", entity: plane, key: HEAVEN_LAW.name },
                { kind: "state", entity: poolId, key: PLACE_QI.name },
              ],
            });
            continue;
          }
          const apt = healthyAptitude(aptitudeOf(law, talent.innate), before);
          const calm = calmOf(plans, ctx.truth.get(BODY_STATE, breaker));
          const pool = pools.get(poolFor(breaker)) as { taken?: QiTaken };
          const r = resolveBreak(
            e,
            breaker,
            law,
            apt,
            before,
            calm,
            pool.taken,
            ctx.rng,
            blindAt(ctx.truth, breaker, before.stage ?? 0),
            0,
            guideOf(ctx.truth, breaker, before.stage ?? 0),
          );
          if (!r) continue;
          rows.set(breaker, r.next);
          if (r.taken) pool.taken = r.taken;
          else delete pool.taken;
          events.push(r.event);
          continue;
        }
        const swallowed = pillByUnit.size > 0 ? pillTaken(e, pillByUnit) : undefined;
        if (swallowed) {
          const { who, pill } = swallowed;
          const before = stateOf(who);
          if (pill.effect === "break") {
            const aid = breakAidOf(pill, before.aid);
            rows.set(who, { ...before, aid });
            events.push({
              kind: PILL_TAKEN_EVENT,
              actors: [who],
              place: e.place,
              data: { pill: pill.id, effect: "break", prep: aid.prep },
              emissions: {},
              causes: [{ kind: "event", event: e.id }],
            });
            continue;
          }
          // Sin sentir el qi no hay recipiente: todo lo que lleva se escapa.
          const capacity = before.sensed ? vesselCapacity(law, before.stage ?? 0) : 0;
          const r = swallowGather(pill, before.qi ?? 0, before.purity ?? 0, capacity);
          if (r.taken > 0) rows.set(who, { ...before, qi: r.qi, purity: r.purity });
          const poolId = poolFor(who);
          const pool = pools.get(poolId) as { taken?: QiTaken };
          // Lo que no cabe se escapa al lugar: la reserva lo recupera.
          if (r.spilled > 0 && pool.taken) {
            pool.taken = {
              ...pool.taken,
              taken: round4(Math.max(0, pool.taken.taken - r.spilled)),
            };
          }
          events.push({
            kind: PILL_TAKEN_EVENT,
            actors: [who],
            place: e.place,
            data: {
              pill: pill.id,
              effect: "gather",
              taken: r.taken,
              spilled: r.spilled,
              qi: r.qi,
              capacity,
            },
            emissions: {},
            causes: [{ kind: "event", event: e.id }],
          });
          continue;
        }
        const m = meditation(e);
        if (!m) continue;
        const talent = ctx.truth.get(TALENT, m.who);
        if (!talent) continue;
        const before = stateOf(m.who);
        const apt = healthyAptitude(aptitudeOf(law, talent.innate), before);
        const capacity = vesselCapacity(law, before.stage ?? 0);
        const calm = calmOf(plans, ctx.truth.get(BODY_STATE, m.who));
        const poolId = poolFor(m.who);
        const pool = pools.get(poolId) as { place?: PlaceQi; factor: number; taken?: QiTaken };
        const { place } = pool;
        // En la cueva de la sede, sobre el nudo de la veta, la misma reserva rinde más.
        const focus = isSectCave(ctx.truth.get(LOCATION, m.who)?.space) ? CAVE_FOCUS : 1;
        const factor = pool.factor * focus;
        const taken = pool.taken;
        // La guía del maestro presente (novel2-master-guide) rinde como un método más.
        const guide = guideOf(ctx.truth, m.who, before.stage ?? 0);
        const method = methodFactor(ctx.truth, m.who, before.stage ?? 0) * guide.gain;
        const gain = meditationGain(apt, m.hours, calm, factor) * method;
        let next: CultivationState = {
          ...before,
          sensitivity: round4(before.sensitivity + gain),
          hours: round4(before.hours + m.hours),
        };
        if (before.sensed && place && taken) {
          const match = rootMatch(apt, place);
          const qi = before.qi ?? 0;
          const drawn = absorbDraw(
            absorbWant(apt, m.hours, calm, factor, match) * method,
            place,
            taken.taken,
            qi,
            capacity,
          );
          const purity = mixedPurity(qi, before.purity ?? 0, drawn, match);
          next = { ...next, qi: round4(qi + drawn), purity };
          if (drawn > 0) {
            pool.taken = {
              ...taken,
              taken: round4(taken.taken + drawn),
              drawn: round4(taken.drawn + drawn),
            };
          }
          events.push({
            kind: ABSORBED_EVENT,
            actors: [m.who],
            place: e.place,
            data: {
              drawn,
              qi: next.qi,
              capacity,
              match,
              purity,
              cell: place.cell,
              ...(focus > 1 ? { focus } : {}),
              ...(guide.gain > 1 ? { guided: guide.gain } : {}),
            },
            emissions: {},
            causes: [
              { kind: "event", event: e.id },
              { kind: "state", entity: poolId, key: PLACE_QI.name },
              ...(guide.gain > 1
                ? [{ kind: "state" as const, entity: m.who, key: MASTER_OF.name }]
                : []),
            ],
          });
        }
        if (!before.sensed && next.sensitivity >= SENSE_THRESHOLD) {
          // La fila guarda la meditación que lo dio; el evento nuevo la nombra como causa.
          next = { ...next, sensed: { at: e.tick, event: e.id as EventId } };
          events.push({
            kind: SENSED_QI_EVENT,
            actors: [m.who],
            place: e.place,
            data: { sensitivity: next.sensitivity, hours: next.hours },
            emissions: {},
            causes: [
              { kind: "event", event: e.id },
              { kind: "state", entity: m.who, key: TALENT.name },
            ],
          });
        }
        rows.set(m.who, next);
      }
      const changes: StateChange[] = [...rows].map(([id, row]) =>
        setComponent(CULTIVATION_STATE, id, row),
      );
      for (const [id, b] of [...bodies].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        changes.push(setComponent(BODY_STATE, id, b));
      }
      for (const [id, t] of [...tribs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        changes.push(
          t === null ? deleteComponent(TRIBULATION, id) : setComponent(TRIBULATION, id, t),
        );
      }
      if (changes.length > 0) {
        for (const [id, pool] of [...pools].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
          if (pool.taken && pool.taken !== pool.row)
            changes.push(setComponent(QI_TAKEN, id, pool.taken));
        }
      }
      if (changes.length === 0) return {};
      return { changes, events, ...(schedule.length > 0 ? { schedule } : {}) };
    },
  };
}
