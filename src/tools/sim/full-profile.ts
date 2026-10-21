// Configuración y acumuladores de medición: no crean una Life ni llaman al LLM.
import type { AgentId, Event, PlanetClock, Tick } from "../../core/index.ts";
import { LABOR, NPC_JOURNEY, PREGNANCY, SPACING_DAYS } from "../../game/index.ts";
import {
  ASLEEP,
  band,
  type Demography,
  ENTITY,
  PERSON,
  type ReadonlyWorldTruth,
} from "../../sim/index.ts";

/** Oportunidades presentes, independientes de que el azar haya producido un evento. Sin ids personales. */
export function profileCoverage(
  truth: ReadonlyWorldTruth,
  now: Tick,
  clock: Pick<PlanetClock, "day" | "year">,
  fertility: Demography["fertility"],
) {
  const alive = (who: AgentId) => {
    const entity = truth.get(ENTITY, who);
    return entity !== undefined && entity.endedAt === undefined;
  };
  const people = truth.ids(PERSON).filter((id) => alive(id as AgentId));
  const activePregnancy = (who: AgentId) => {
    const pregnancy = truth.get(PREGNANCY, who);
    return pregnancy !== undefined && (truth.get(LABOR, who)?.dueAt ?? -1) < pregnancy.dueAt;
  };
  const byAge = fertility.map((entry) => ({
    fromAge: entry.fromAge,
    annualRate: entry.rate,
    couples: 0,
  }));
  let fertileCouples = 0;
  let conceptionEligibleCouples = 0;
  for (const id of people) {
    const mother = truth.get(PERSON, id);
    if (mother?.sex !== "female" || mother.spouse === null) continue;
    const father = truth.get(PERSON, mother.spouse);
    if (father?.sex !== "male" || father.spouse !== id || !alive(mother.spouse)) continue;
    const ageBand = band(fertility, (now - mother.born) / clock.year);
    if (!ageBand || !(ageBand.rate > 0)) continue;
    fertileCouples++;
    const age = byAge.find((entry) => entry.fromAge === ageBand.fromAge);
    if (age) age.couples++;
    if (
      !activePregnancy(id as AgentId) &&
      now - (truth.get(LABOR, id)?.at ?? Number.NEGATIVE_INFINITY) >= SPACING_DAYS * clock.day
    ) {
      conceptionEligibleCouples++;
    }
  }
  return {
    tick: now,
    livingPeople: people.length,
    fertileCouples,
    fertileCouplesByAge: byAge.sort((a, b) => a.fromAge - b.fromAge),
    conceptionEligibleCouples,
    activePregnancies: people.filter((id) => activePregnancy(id as AgentId)).length,
    npcJourneys: people.filter((id) => truth.has(NPC_JOURNEY, id)).length,
    asleepPeople: people.filter((id) => truth.has(ASLEEP, id)).length,
  };
}

export interface FullProfileConfig {
  readonly seeds: readonly number[];
  readonly years: number;
  readonly days?: number;
  readonly checkEveryDays: number;
  readonly frequency?: number;
  /** Cobertura dirigida de préstamos con garantía, promesas y contratación (`rescue-coverage.ts`). */
  readonly rescue?: boolean;
  /** Cobertura dirigida de encuentros y comercio: oficios vistos, profecía contada, oferta del vecino (`commerce-coverage.ts`). */
  readonly commerce?: boolean;
  /** Cobertura dirigida de mirar y suponer: turnos `look` y `ponder` del personaje (`senses-coverage.ts`). */
  readonly senses?: boolean;
  /** Cobertura dirigida de natalidad: fecundidad x12 y gestación de 30 días, para ver parto, nacimiento y crianza (`natality-coverage.ts`). */
  readonly natality?: boolean;
  /** Escenario `full-profile-focus`: suma el foco de salud y deuda (`full-profile-focus.ts`) a FULL_PROFILE. */
  readonly focus?: boolean;
}

/** Observación del tooling; el callback nunca entra al estado ni al setup de replay. */
export interface FullProfileProgress {
  readonly seed: number;
  readonly stage: "creation-start" | "creation-complete" | "checkpoint";
  readonly elapsedMs: number;
  readonly tick?: number;
  readonly worldDays?: number;
  readonly checks?: number;
  readonly problems?: number;
  readonly rssBytes?: number;
}

export function validateFullProfileConfig(config: FullProfileConfig): FullProfileConfig {
  if (config.seeds.length === 0 || config.seeds.some((s) => !Number.isSafeInteger(s) || s < 0))
    throw new RangeError("seeds debe contener enteros no negativos");
  if (!Number.isFinite(config.years) || config.years <= 0)
    throw new RangeError("years debe ser positivo y finito");
  for (const [name, value] of [
    ["days", config.days],
    ["checkEveryDays", config.checkEveryDays],
    ["frequency", config.frequency],
  ] as const)
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
      throw new RangeError(`${name} debe ser entero positivo`);
  return config;
}

export interface ProcessMeasurement {
  calls: number;
  effectiveCalls: number;
  changes: number;
  events: number;
  /** Tiempo acumulado en el proceso (ms); solo si la corrida inyectó un reloj. */
  ms?: number;
}

export function recordProcess(
  counts: Map<string, ProcessMeasurement>,
  id: string,
  changes: number,
  events: number,
  ms?: number,
): void {
  const count = counts.get(id) ?? { calls: 0, effectiveCalls: 0, changes: 0, events: 0 };
  count.calls++;
  if (changes > 0 || events > 0) count.effectiveCalls++;
  count.changes += changes;
  count.events += events;
  if (ms !== undefined) count.ms = (count.ms ?? 0) + ms;
  counts.set(id, count);
}

/** Solo eventos posteriores a la creación; no mezcla la prehistoria familiar con la corrida. */
export function profileDemography(events: readonly Event[], from: number) {
  const byKind = new Map<string, number>();
  const deathsByCause = new Map<string, number>();
  for (const event of events) {
    if (event.tick <= from) continue;
    byKind.set(event.kind, (byKind.get(event.kind) ?? 0) + 1);
    if (event.kind === "body.died") {
      const cause = String((event.data as { cause?: unknown }).cause ?? "unknown");
      deathsByCause.set(cause, (deathsByCause.get(cause) ?? 0) + 1);
    }
  }
  return {
    eventsByKind: Object.fromEntries([...byKind].sort(([a], [b]) => a.localeCompare(b))),
    births: byKind.get("family.birth") ?? 0,
    deaths: byKind.get("body.died") ?? 0,
    deathsByCause: Object.fromEntries([...deathsByCause].sort(([a], [b]) => a.localeCompare(b))),
  };
}
