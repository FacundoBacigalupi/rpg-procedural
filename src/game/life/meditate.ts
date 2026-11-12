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

import type { AgentId, EntityRef, Event, EventId, Rng } from "../../core/index.ts";
import {
  ABSORBED_EVENT,
  type Aptitude,
  absorbDraw,
  absorbWant,
  aptitudeOf,
  BODY_STATE,
  type Body,
  type BodyPlanDef,
  BREAKTHROUGH_EVENT,
  breakOutcome,
  breakPreparation,
  CAVE_FOCUS,
  CULTIVATION_LAW,
  CULTIVATION_STATE,
  CULTIVATION_TECHNIQUE,
  type CultivationLaw,
  type CultivationState,
  deleteComponent,
  type EventDraft,
  gatherHours,
  HEAVEN_LAW,
  isSectCave,
  LOCATION,
  type LocalMap,
  MAX_MERIDIAN_DAMAGE,
  meditationGain,
  mixedPurity,
  needsFrom,
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
  SENSE_THRESHOLD,
  SENSED_QI_EVENT,
  type StateChange,
  setComponent,
  TALENT,
  TRIBULATION,
  TRIBULATION_GATHERS_EVENT,
  TRIBULATION_STRIKES_EVENT,
  type Tribulation,
  tribulationDue,
  tribulationEnergy,
  vesselCapacity,
} from "../../sim/index.ts";
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
): { next: CultivationState; taken: QiTaken | undefined; event: EventDraft } | undefined {
  if (!before.sensed) return undefined;
  const stage = before.stage ?? 0;
  const threshold = law.paths[0]?.thresholds[stage];
  if (!threshold) return undefined;
  const qi = before.qi ?? 0;
  const capacity = threshold.capacity;
  const prep = breakPreparation(apt, {
    qi,
    capacity,
    purity: before.purity ?? 0,
    calm,
    meridianDamage: before.meridianDamage ?? 0,
    foundation: before.foundation ?? 0,
  });
  const outcome = breakOutcome(prep, threshold.bottleneck, rng.float(), rng.float());
  let next = before;
  let lost = 0;
  if (outcome.kind === "success") {
    next = {
      ...before,
      stage: stage + 1,
      foundation: round4((before.foundation ?? 0) + outcome.quality),
    };
  } else if (outcome.kind === "backlash") {
    lost = round4(qi * outcome.lostShare);
    next = {
      ...before,
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
      data: { outcome: outcome.kind, threshold: threshold.id, prep, lost, ...outcome },
      emissions: seen > 0 ? { sight: seen } : {},
      causes: [
        { kind: "event", event: e.id },
        { kind: "state", entity: who, key: CULTIVATION_STATE.name },
      ],
    },
  };
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
}): ProcessDef {
  const plans = new Map(o.bodyPlans.map((p) => [p.id, p]));
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
      LOCATION.name,
      ...(pooled ? [PLACE.name] : []),
      ...(o.dayTicks !== undefined ? [HEAVEN_LAW.name, TRIBULATION.name] : []),
    ],
    writes: [
      CULTIVATION_STATE.name,
      QI_TAKEN.name,
      ...(o.dayTicks !== undefined ? [TRIBULATION.name] : []),
    ],
    run(ctx) {
      const plane = ctx.truth.ids(CULTIVATION_LAW)[0];
      const law = plane ? ctx.truth.get(CULTIVATION_LAW, plane) : undefined;
      if (!plane || !law) return {};
      const heaven = o.dayTicks !== undefined ? ctx.truth.get(HEAVEN_LAW, plane) : undefined;
      /** Las tribulaciones que esta corrida abre (`Tribulation`) o cierra (`null`). */
      const tribs = new Map<AgentId, Tribulation | null>();
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
          const before = stateOf(struck);
          const apt = healthyAptitude(aptitudeOf(law, talent.innate), before);
          const calm = calmOf(plans, ctx.truth.get(BODY_STATE, struck));
          const pool = pools.get(poolFor(struck)) as { taken?: QiTaken };
          const r = resolveBreak(e, struck, law, apt, before, calm, pool.taken, ctx.rng);
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
          const r = resolveBreak(e, breaker, law, apt, before, calm, pool.taken, ctx.rng);
          if (!r) continue;
          rows.set(breaker, r.next);
          if (r.taken) pool.taken = r.taken;
          else delete pool.taken;
          events.push(r.event);
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
        const method = ctx.truth.get(CULTIVATION_TECHNIQUE, m.who)?.factor ?? 1;
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
            },
            emissions: {},
            causes: [
              { kind: "event", event: e.id },
              { kind: "state", entity: poolId, key: PLACE_QI.name },
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
