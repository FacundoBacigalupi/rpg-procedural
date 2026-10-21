// Procesos mortales en la aldea (technology §1-§2; opt-in `LifeOptions.mortalTech`): al materializar
// la aldea se siembra el saber tácito de los procesos que la geografía permite (`seedTechKnowledge`,
// con `source` = el evento `tech.seeded`, hijo de la fundación), y cada día quien sabe un proceso lo
// enseña a alguien de su hogar que sabe menos (`techTeachProcess`, `teachProcess` con su evento y su
// causa). El rendimiento del campo lee `yieldFactor` en la rutina (`RoutineOptions.tech`).
// Apagado no hay filas, RNG ni eventos. Constantes sin calibrar.

import {
  type AgentId,
  compareStrings,
  type EntityRef,
  type EventId,
  type EventLog,
  type IdAllocator,
  type PlaceRef,
  type PlanetClock,
  Rng,
  type Seed,
  type Tick,
} from "../../core/index.ts";
import {
  draftEvent,
  ENTITY,
  type EventDraft,
  effectiveness,
  feasibility,
  type KnownProcesses,
  type LocalMap,
  PERSON,
  PROCESS_KNOWLEDGE,
  type ProcessDef,
  type ProcessKnowledge,
  type ReadonlyWorldTruth,
  type StateChange,
  type Surroundings,
  setComponent,
  type TechCatalog,
  teachProcess,
  type WorldTruth,
  withKnowledge,
} from "../../sim/index.ts";

export const TECH_SEEDED_EVENT = "tech.seeded";
export const TECH_TAUGHT_EVENT = "tech.taught";
export const TECH_TEACH_PROCESS = "life.tech-teach";

/** Qué ideas trae la aldea de entrada, hasta que la cultura dé conceptos (culture §3; sin calibrar). */
export const VILLAGE_CONCEPTS: readonly string[] = [
  "draft-traction",
  "fallow-cycle",
  "preservation",
];
/** Fuego del hogar de aldea (°C): alcanza para carbón y no para fundir (sin calibrar). */
export const HEARTH_FIRE_C = 600;
/** Probabilidad de que un adulto sepa un proceso posible aquí (sin calibrar). */
export const SEED_SHARE = 0.7;
/** Horas por día que un maestro dedica a su aprendiz (sin calibrar). */
export const TEACH_HOURS_PER_DAY = 2;
/** Diferencia mínima de fidelidad para que valga la pena enseñar. */
export const TEACH_MIN_GAP = 0.05;

/** Lo que hay en la aldea: lo que dice el mapa, el fuego del hogar y las ideas de entrada. */
export function villageSurroundings(
  map: LocalMap,
  workers: number,
  tools: ReadonlySet<string>,
): Surroundings {
  const resources = new Set<string>(["water"]);
  if (map.forest.some(Boolean)) resources.add("timber");
  return {
    resources,
    energy: { muscle: 1, fire: HEARTH_FIRE_C },
    concepts: new Set(VILLAGE_CONCEPTS),
    tools,
    workers,
    laws: new Set(),
  };
}

/** Los procesos del catálogo que la geografía permite (las herramientas se resuelven en cadena). */
export function possibleProcesses(
  catalog: TechCatalog,
  map: LocalMap,
  workers: number,
): readonly string[] {
  const tools = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const def of catalog.all) {
      if (tools.has(def.id)) continue;
      if (feasibility(def, villageSurroundings(map, workers, tools)).possible) {
        tools.add(def.id);
        changed = true;
      }
    }
  }
  return [...tools].sort(compareStrings);
}

export interface SeedTechOptions {
  readonly seed: Seed;
  readonly catalog: TechCatalog;
  readonly map: LocalMap;
  readonly clock: PlanetClock;
  readonly now: Tick;
  readonly workAge: number;
  readonly place: PlaceRef;
  readonly foundersEvent: EventId;
}

/**
 * Siembra el saber tácito de la aldea: cada adulto sabe, con una tirada por (proceso, persona),
 * algunos de los procesos posibles; fidelidad y mano crecen con la edad. Un proceso solo se siembra
 * a quien ya sabe sus herramientas. Devuelve cuántos registros dejó.
 */
export function seedTechKnowledge(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  o: SeedTechOptions,
): number {
  const adults = truth
    .ids(PERSON)
    .map((p) => p as AgentId)
    .filter((p) => {
      const born = truth.get(PERSON, p)?.born ?? o.now;
      return (
        truth.get(ENTITY, p)?.endedAt === undefined && (o.now - born) / o.clock.year >= o.workAge
      );
    })
    .sort(compareStrings);
  const possible = possibleProcesses(o.catalog, o.map, adults.length);
  if (adults.length === 0 || possible.length === 0) return 0;
  const event = ids.next("event");
  log.append({
    id: event,
    tick: o.now,
    kind: TECH_SEEDED_EVENT,
    actors: [],
    place: o.place,
    data: { processes: possible },
    emissions: {},
    causes: [{ kind: "event", event: o.foundersEvent }],
    resolution: "local",
  });
  const root = Rng.root(o.seed).fork("tech", "seed");
  let rows = 0;
  for (const p of adults) {
    const age = (o.now - (truth.get(PERSON, p)?.born ?? o.now)) / o.clock.year;
    const maturity = Math.min(1, age / 30);
    let known: KnownProcesses = {};
    // Pasadas hasta que no entre nada: un proceso entra cuando ya se saben sus herramientas.
    for (let changed = true; changed; ) {
      changed = false;
      for (const id of possible) {
        if (known[id]) continue;
        const def = o.catalog.get(id);
        if (!def || !def.requires.tools.every((t) => known[t])) continue;
        const rng = root.fork(id, p);
        const knows = rng.float() < SEED_SHARE;
        const fidelity = Math.min(1, (0.5 + 0.4 * rng.float()) * (0.6 + 0.4 * maturity));
        const skill = Math.min(fidelity, fidelity * maturity * (0.5 + 0.5 * rng.float()));
        if (!knows) continue;
        known = withKnowledge(known, {
          process: id,
          fidelity,
          skill,
          source: event,
          secret: false,
          learnedAt: o.now,
        });
        changed = true;
      }
    }
    if (Object.keys(known).length > 0) {
      truth.set(PROCESS_KNOWLEDGE, p, known);
      rows++;
    }
  }
  return rows;
}

export interface TechTeachOptions {
  readonly catalog: TechCatalog;
  readonly clock: PlanetClock;
  readonly workAge: number;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/**
 * Un día de enseñanza: cada maestro (de más a menos eficaz, desempate por id) da `TEACH_HOURS_PER_DAY`
 * horas del proceso con más distancia a alguien de su hogar que lo sabe menos. Un aprendiz recibe una
 * sola lección por día.
 */
export function techTeachProcess(o: TechTeachOptions): ProcessDef {
  return {
    id: TECH_TEACH_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [PROCESS_KNOWLEDGE.name, PERSON.name, ENTITY.name],
    writes: [PROCESS_KNOWLEDGE.name],
    run(ctx) {
      const alive = ctx.truth
        .ids(PERSON)
        .map((p) => p as AgentId)
        .filter((p) => ctx.truth.get(ENTITY, p)?.endedAt === undefined)
        .sort(compareStrings);
      const ageOf = (p: AgentId) =>
        (ctx.now - (ctx.truth.get(PERSON, p)?.born ?? ctx.now)) / o.clock.year;
      const power = (p: AgentId) => {
        const k = ctx.truth.get(PROCESS_KNOWLEDGE, p);
        return Math.max(0, ...Object.values(k ?? {}).map(effectiveness));
      };
      const teachers = alive
        .filter((p) => ageOf(p) >= o.workAge && ctx.truth.get(PROCESS_KNOWLEDGE, p))
        .sort((a, b) => power(b) - power(a) || compareStrings(a, b));
      const taught = new Set<AgentId>();
      const pending = new Map<AgentId, KnownProcesses>();
      const events: EventDraft[] = [];
      const changes: StateChange[] = [];
      for (const t of teachers) {
        const tk = ctx.truth.get(PROCESS_KNOWLEDGE, t) as KnownProcesses;
        const house = ctx.truth.get(PERSON, t)?.household;
        let best:
          | { pupil: AgentId; process: string; gap: number; teacher: ProcessKnowledge }
          | undefined;
        for (const s of alive) {
          if (s === t || taught.has(s) || ctx.truth.get(PERSON, s)?.household !== house) continue;
          if (ageOf(s) < o.workAge) continue;
          const sk = pending.get(s) ?? ctx.truth.get(PROCESS_KNOWLEDGE, s);
          for (const id of Object.keys(tk).sort(compareStrings)) {
            const k = tk[id] as ProcessKnowledge;
            const def = o.catalog.get(id);
            if (!def || k.secret) continue;
            const gap = k.fidelity - (sk?.[id]?.fidelity ?? 0);
            if (gap > TEACH_MIN_GAP && (best === undefined || gap > best.gap)) {
              best = { pupil: s, process: id, gap, teacher: k };
            }
          }
        }
        if (!best) continue;
        const def = o.catalog.get(best.process);
        if (!def) continue;
        const k = events.length;
        const lesson = draftEvent(k);
        const existing = (ctx.truth.get(PROCESS_KNOWLEDGE, best.pupil) ?? {})[best.process];
        const r = teachProcess(
          def,
          { teacherId: t, teacher: best.teacher, hours: TEACH_HOURS_PER_DAY, willing: true },
          {
            id: best.pupil,
            talent: 0,
            ageYears: ageOf(best.pupil),
            ...(existing ? { existing } : {}),
          },
          { rng: ctx.rng, event: lesson, tick: ctx.now },
        );
        if (r.kind !== "learned") continue;
        taught.add(best.pupil);
        const next = withKnowledge(ctx.truth.get(PROCESS_KNOWLEDGE, best.pupil), r.knowledge);
        pending.set(best.pupil, next);
        changes.push(setComponent(PROCESS_KNOWLEDGE, best.pupil, next));
        events.push({
          kind: TECH_TAUGHT_EVENT,
          actors: [t, best.pupil],
          place: o.placeOf(ctx.truth, t),
          data: {
            process: best.process,
            hours: TEACH_HOURS_PER_DAY,
            fidelity: r.knowledge.fidelity,
            skill: r.knowledge.skill,
            copyError: r.copyError,
          },
          emissions: { sight: 0.1, sound: 0.2 },
          causes: [
            { kind: "state", entity: t as unknown as EntityRef, key: PROCESS_KNOWLEDGE.name },
          ],
        });
      }
      return events.length > 0 ? { changes, events } : {};
    },
  };
}
