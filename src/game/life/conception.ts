// Concepción y embarazo en la vida (family-lineage §3, body-health §6): una casada con el marido
// vivo concibe con la probabilidad de su edad (la misma curva de fecundidad que la pre-corrida:
// `Demography.fertility`, probabilidad anual de parir) y el embarazo queda como una fila con su
// causa, de modo que el parto lo resuelva `life.labor` con la partera. Opt-in (`LifeOptions.conception`):
// sin esto nadie concibe en la vida viva. No mueve bienes: el embarazo no crea ni gasta nada del
// ledger (el feto se nutre de la madre cuando nutrición y salud salgan del cuerpo; ítem aparte).
// Determinista: el azar de cada día sale de `ctx.rng.fork("conception", madre, día)`.

import {
  type AgentId,
  type EntityRef,
  type PlaceRef,
  type PlanetClock,
  pow,
  type Tick,
} from "../../core/index.ts";
import {
  band,
  type Demography,
  draftEvent,
  ENTITY,
  type EventDraft,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  table,
} from "../../sim/index.ts";
import { LABOR, type Labor } from "./midwife.ts";

export const CONCEPTION_PROCESS = "life.conception";

/** Un embarazo en curso: de quién, cuándo se concibió, cuándo sale de cuenta y qué evento lo causó. */
export interface Pregnancy {
  readonly father: AgentId;
  readonly conceivedAt: Tick;
  readonly dueAt: Tick;
  /** Con este parto, cuántos lleva la madre (el primero es 1). */
  readonly parity: number;
  /** El evento `family.conception`. */
  readonly originEventId: string;
}

export const PREGNANCY = table<Pregnancy>("life.pregnancy");

/** Días de embarazo y de espera entre un parto y la próxima concepción (sin calibrar). */
export const GESTATION_DAYS = 280;
export const SPACING_DAYS = 365;

export interface ConceptionOptions {
  readonly clock: PlanetClock;
  readonly demography: Pick<Demography, "fertility">;
  readonly gestationDays?: number;
  readonly spacingDays?: number;
  /** Multiplica la fecundidad de la curva (por defecto 1): para calibrar y para tests cortos. */
  readonly rateScale?: number;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/**
 * Probabilidad de concebir en un día dada la probabilidad anual de parir (puro): el riesgo diario
 * constante que, acumulado en el año, da esa probabilidad.
 */
export function dailyConceptionChance(annualRate: number, daysPerYear: number): number {
  const r = Math.min(1, Math.max(0, annualRate));
  if (r >= 1) return 1;
  if (!(daysPerYear > 0)) return 0;
  return 1 - pow(1 - r, 1 / daysPerYear);
}

/** Los partos que vienen de embarazos: se suman a los sembrados (`LifeParts.labors`). */
export function pregnancyLabors(truth: ReadonlyWorldTruth): Labor[] {
  const out: Labor[] = [];
  for (const id of truth.ids(PREGNANCY)) {
    const p = truth.get(PREGNANCY, id);
    if (p) out.push({ mother: id as unknown as AgentId, dueAt: p.dueAt, parity: p.parity });
  }
  return out.sort((a, b) => a.dueAt - b.dueAt || (a.mother < b.mother ? -1 : 1));
}

export function conceptionProcess(o: ConceptionOptions): ProcessDef {
  const gestation = (o.gestationDays ?? GESTATION_DAYS) * o.clock.day;
  const spacing = (o.spacingDays ?? SPACING_DAYS) * o.clock.day;
  const daysPerYear = o.clock.year / o.clock.day;
  return {
    id: CONCEPTION_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [PERSON.name, ENTITY.name, PREGNANCY.name, LABOR.name],
    writes: [PREGNANCY.name],
    run(ctx) {
      const alive = (a: AgentId) =>
        ctx.truth.get(ENTITY, a as unknown as EntityRef)?.endedAt === undefined;
      const day = Math.floor(ctx.now / o.clock.day);
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const mothers = ctx.truth
        .ids(PERSON)
        .map((id) => id as unknown as AgentId)
        .sort();
      for (const mother of mothers) {
        const m = ctx.truth.get(PERSON, mother as unknown as EntityRef);
        if (!m || m.sex !== "female" || m.spouse === null || !alive(mother)) continue;
        const father = ctx.truth.get(PERSON, m.spouse as unknown as EntityRef);
        if (!father || father.sex !== "male" || father.spouse !== mother || !alive(m.spouse)) {
          continue;
        }
        const open = ctx.truth.get(PREGNANCY, mother as unknown as EntityRef);
        const labor = ctx.truth.get(LABOR, mother as unknown as EntityRef);
        // Embarazada hasta que su parto se resolvió; después, un tiempo sin concebir.
        if (open && (labor?.dueAt ?? -1) < open.dueAt) continue;
        const last = labor?.at ?? Number.NEGATIVE_INFINITY;
        if (ctx.now - last < spacing) continue;
        const age = (ctx.now - m.born) / o.clock.year;
        const rate = (band(o.demography.fertility, age)?.rate ?? 0) * (o.rateScale ?? 1);
        const p = dailyConceptionChance(rate, daysPerYear);
        if (!(p > 0) || !ctx.rng.fork("conception", mother, day).chance(p)) continue;
        const k = events.length;
        events.push({
          kind: "family.conception",
          actors: [mother, m.spouse],
          place: o.placeOf(ctx.truth, mother),
          data: { dueAt: ctx.now + gestation, chancePerDay: p },
          emissions: {},
          causes: [{ kind: "state", entity: mother, key: "family.person" }],
        });
        changes.push(
          setComponent(PREGNANCY, mother as unknown as EntityRef, {
            father: m.spouse,
            conceivedAt: ctx.now,
            dueAt: ctx.now + gestation,
            parity: (open?.parity ?? 0) + 1,
            originEventId: draftEvent(k),
          }),
        );
      }
      return { changes, events };
    },
  };
}
