// El scheduler (simulation §3): ruedas de cadencia para lo periódico y una cola con hora para lo
// puntual. Un paso va hasta el próximo ítem agendado o el próximo borde de cadencia; dentro del
// paso, las fases corren en orden fijo y, dentro de cada fase, las corridas en orden canónico
// (proceso, alcance, creación). Todas las corridas de una fase leen el mismo estado: sus diffs se
// aplican juntos al cerrar la fase. Si dos corridas de `act` escriben en exclusiva el mismo
// componente, no gana la que corrió primero: se resuelve una contienda con iniciativa y una
// tirada con clave ("contest", componente, tick).
//
// Lo que este scheduler todavía no hace (llega con su tarea): zonas con resoluciones distintas
// (ahora hay una sola para todo el mundo), partir ventanas cuando un ítem cae adentro, procesos
// "onEvent" disparados por eventos (ahora corren solo si se los agenda), presupuesto, materializar
// y el caché de presiones.

import {
  assertTick,
  compareStrings,
  type Event,
  type IdAllocator,
  type PlanetClock,
  type Rng,
  type Tick,
  type TimeScale,
  windowDuration,
  windowIndex,
  windowStart,
  type ZoneResolution,
} from "../../core/index.ts";
import type { ReadonlyWorldTruth, WorldTruth } from "../world/index.ts";
import {
  type ContestClaim,
  changeKey,
  compareScopes,
  PHASES,
  type Phase,
  type ProcessContext,
  type ProcessDef,
  type ProcessId,
  type ProcessResult,
  phaseIndex,
  type ScheduledItem,
  type ScheduleRequest,
  type ScopeKind,
  type ScopeRef,
  type StateChange,
} from "./process.ts";
import { ScheduleQueue } from "./queue.ts";

export class SchedulerError extends Error {
  override name = "SchedulerError";
}

export interface SchedulerOptions {
  /** Raíz del rng del mundo; cada corrida usa un fork con su clave. */
  readonly rng: Rng;
  readonly clock: PlanetClock;
  readonly truth: WorldTruth;
  readonly ids: IdAllocator;
  readonly processes: readonly ProcessDef[];
  /** Una sola resolución para todo el mundo hasta que lleguen las zonas (Fase 5). */
  readonly resolution: ZoneResolution;
  /** Sobre qué alcances corre un proceso de cada tipo. "world" no hace falta declararlo. */
  readonly scopes?: (kind: ScopeKind, truth: ReadonlyWorldTruth) => readonly ScopeRef[];
}

/** Lo que hay que guardar para seguir exactamente donde se quedó. */
export interface SchedulerState {
  readonly now: Tick;
  readonly seq: number;
  readonly queue: readonly ScheduledItem[];
}

export interface Contender {
  readonly process: ProcessId;
  readonly scope: ScopeRef;
  readonly initiative: number;
  readonly score: number;
}

export interface ContestRecord {
  readonly key: string;
  readonly contenders: readonly Contender[];
  readonly winner: number; // índice en `contenders`
}

export interface StepReport {
  readonly tick: Tick;
  readonly events: readonly Event[];
  readonly contests: readonly ContestRecord[];
}

export interface AdvanceResult {
  readonly now: Tick;
  readonly interrupted: boolean;
  readonly steps: number;
}

interface RunSpec {
  readonly def: ProcessDef;
  readonly scope: ScopeRef;
  readonly window: number;
  readonly windowIndex: number | undefined;
  readonly item: ScheduledItem | undefined;
  readonly rngParts: readonly (string | number)[];
}

interface Run extends RunSpec {
  readonly result: ProcessResult;
  alive: boolean;
}

export class Scheduler {
  readonly #o: SchedulerOptions;
  readonly #defs: ReadonlyMap<ProcessId, ProcessDef>;
  readonly #periodic: readonly { def: ProcessDef; scale: TimeScale }[];
  readonly #scales: readonly TimeScale[];
  readonly #queue = new ScheduleQueue();
  #now: Tick;
  #seq: number;
  #stepping: Tick | undefined;

  constructor(options: SchedulerOptions, state: SchedulerState = { now: 0, seq: 0, queue: [] }) {
    this.#o = options;
    const defs = new Map<ProcessId, ProcessDef>();
    for (const def of options.processes) {
      if (defs.has(def.id)) throw new SchedulerError(`proceso repetido: ${def.id}`);
      if (!def.id.startsWith(`${def.system}.`)) {
        throw new SchedulerError(`el id ${def.id} no empieza con su sistema ${def.system}`);
      }
      phaseIndex(def.phase);
      defs.set(def.id, def);
    }
    this.#defs = defs;
    const periodic: { def: ProcessDef; scale: TimeScale }[] = [];
    for (const id of [...defs.keys()].sort(compareStrings)) {
      const def = defs.get(id) as ProcessDef;
      const cadence = def.cadence[options.resolution];
      if (cadence !== undefined && cadence !== "onEvent") periodic.push({ def, scale: cadence });
    }
    this.#periodic = periodic;
    this.#scales = [...new Set(periodic.map((p) => p.scale))];

    this.#now = assertTick(state.now);
    if (!Number.isSafeInteger(state.seq) || state.seq < 0) {
      throw new SchedulerError(`seq inválido: ${state.seq}`);
    }
    this.#seq = state.seq;
    for (const item of state.queue) {
      this.#checkItem(item, this.#now, undefined);
      if (item.seq >= this.#seq)
        throw new SchedulerError(`ítem con seq ${item.seq} ≥ ${this.#seq}`);
      this.#queue.push(item);
    }
  }

  /** Hasta dónde está simulado el mundo. */
  get now(): Tick {
    return this.#now;
  }

  state(): SchedulerState {
    return { now: this.#now, seq: this.#seq, queue: this.#queue.items() };
  }

  /** Agenda algo desde afuera (el turno, worldgen). Tiene que ser después de `now`. */
  schedule(request: ScheduleRequest): ScheduledItem {
    if (this.#stepping !== undefined) {
      throw new SchedulerError("durante un paso se agenda devolviendo `schedule` desde un proceso");
    }
    const item = { ...request, seq: this.#seq };
    this.#checkItem(item, this.#now, undefined);
    this.#seq++;
    this.#queue.push(item);
    return item;
  }

  /** El tick del próximo paso: el próximo ítem o el próximo borde de cadencia. */
  nextStepTick(): Tick | undefined {
    let next = this.#queue.peek()?.at;
    for (const scale of this.#scales) {
      const b = windowStart(this.#o.clock, scale, windowIndex(this.#o.clock, scale, this.#now) + 1);
      if (next === undefined || b < next) next = b;
    }
    return next;
  }

  advanceTo(target: Tick, onStep?: (report: StepReport) => void): AdvanceResult {
    return this.advanceUntil(target, (r) => {
      onStep?.(r);
      return false;
    });
  }

  /**
   * Avanza paso a paso hasta `target`, o hasta que `interrupt` diga que basta después de un paso
   * (una amenaza, un mensaje: lo usa el bucle del jugador para los saltos de tiempo).
   */
  advanceUntil(target: Tick, interrupt?: (report: StepReport) => boolean): AdvanceResult {
    assertTick(target);
    if (target < this.#now)
      throw new SchedulerError(`no se vuelve atrás: ${target} < ${this.#now}`);
    let steps = 0;
    for (;;) {
      const t = this.nextStepTick();
      if (t === undefined || t > target) break;
      const report = this.#step(t);
      steps++;
      if (interrupt?.(report)) return { now: this.#now, interrupted: true, steps };
    }
    this.#now = target;
    return { now: target, interrupted: false, steps };
  }

  // -------------------------------------------------------------------------------------------

  #step(t: Tick): StepReport {
    const { clock } = this.#o;
    this.#stepping = t;
    const due = new Set(
      this.#scales.filter((s) => windowStart(clock, s, windowIndex(clock, s, t)) === t),
    );
    const ordinals = new Map<string, number>();
    const events: Event[] = [];
    const contests: ContestRecord[] = [];
    try {
      for (const phase of PHASES) {
        const specs: RunSpec[] = [];
        for (const { def, scale } of this.#periodic) {
          if (def.phase !== phase || !due.has(scale)) continue;
          const index = windowIndex(clock, scale, t) - 1; // la ventana que termina ahora
          const window = windowDuration(clock, scale, index);
          for (const scope of this.#scopesOf(def)) {
            specs.push({
              def,
              scope,
              window,
              windowIndex: index,
              item: undefined,
              rngParts: [def.system, def.id, scope, index],
            });
          }
        }
        for (
          let head = this.#queue.peek();
          head && head.at === t && head.phase === phase;
          head = this.#queue.peek()
        ) {
          this.#queue.pop();
          const def = this.#defs.get(head.process) as ProcessDef;
          const k = `${head.process}|${head.scope}`;
          const n = ordinals.get(k) ?? 0;
          ordinals.set(k, n + 1);
          specs.push({
            def,
            scope: head.scope,
            window: 0,
            windowIndex: undefined,
            item: head,
            rngParts: [def.system, def.id, head.scope, "at", t, n],
          });
        }
        specs.sort(
          (a, b) =>
            compareStrings(a.def.id, b.def.id) ||
            compareScopes(a.scope, b.scope) ||
            (a.item?.seq ?? -1) - (b.item?.seq ?? -1),
        );
        const runs = specs.map((spec) => this.#run(spec, t, phase));
        this.#commit(runs, t, phase, events, contests);
      }
    } finally {
      this.#stepping = undefined;
    }
    this.#now = t;
    return { tick: t, events, contests };
  }

  #scopesOf(def: ProcessDef): readonly ScopeRef[] {
    if (def.scope === "world") return ["world"];
    const scopes = this.#o.scopes;
    if (!scopes)
      throw new SchedulerError(`no hay cómo enumerar alcances "${def.scope}" (${def.id})`);
    return [...scopes(def.scope, this.#o.truth)].sort(compareScopes);
  }

  #run(spec: RunSpec, t: Tick, phase: Phase): Run {
    const ctx: ProcessContext = {
      now: t,
      window: spec.window,
      windowIndex: spec.windowIndex,
      scope: spec.scope,
      resolution: this.#o.resolution,
      phase,
      truth: this.#o.truth,
      rng: this.#o.rng.fork(...spec.rngParts),
      item: spec.item,
    };
    const result = spec.def.run(ctx);
    this.#checkResult(spec, result, t, phase);
    return { ...spec, result, alive: true };
  }

  #checkResult(spec: RunSpec, result: ProcessResult, t: Tick, phase: Phase): void {
    const { def } = spec;
    for (const c of result.changes ?? []) {
      if (!def.writes.includes(c.table)) {
        throw new SchedulerError(`${def.id} escribe ${c.table} sin declararlo en writes`);
      }
      if (c.op === "add" && !Number.isFinite(c.amount)) {
        throw new SchedulerError(`${def.id}: suma no finita en ${changeKey(c)}.${c.field}`);
      }
    }
    for (const e of result.events ?? []) {
      if (e.tick === undefined) continue;
      if (!Number.isSafeInteger(e.tick) || e.tick > t || e.tick < t - spec.window) {
        throw new SchedulerError(`${def.id}: evento con tick ${e.tick} fuera de su ventana`);
      }
    }
    for (const r of result.schedule ?? []) this.#checkItem({ ...r, seq: 0 }, t, phase);
  }

  /** Un ítem tiene que ir a un proceso conocido y al futuro (o a una fase posterior de este paso). */
  #checkItem(item: ScheduledItem, now: Tick, phase: Phase | undefined): void {
    if (!this.#defs.has(item.process))
      throw new SchedulerError(`proceso desconocido: ${item.process}`);
    assertTick(item.at);
    const later =
      item.at > now ||
      (item.at === now && phase !== undefined && phaseIndex(item.phase) > phaseIndex(phase));
    if (!later) {
      throw new SchedulerError(
        `${item.process} agendado en el pasado: ${item.at} (${item.phase}) en ${now}`,
      );
    }
  }

  #commit(runs: Run[], t: Tick, phase: Phase, events: Event[], contests: ContestRecord[]): void {
    // Quién toca cada componente, y si alguno lo hace en exclusiva.
    const touches = new Map<string, { runs: number[]; exclusive: boolean }>();
    runs.forEach((run, i) => {
      for (const c of run.result.changes ?? []) {
        const key = changeKey(c);
        let entry = touches.get(key);
        if (!entry) {
          entry = { runs: [], exclusive: false };
          touches.set(key, entry);
        }
        if (entry.runs.at(-1) !== i) entry.runs.push(i);
        if (c.op !== "add") entry.exclusive = true;
      }
    });
    const conflicts = [...touches]
      .filter(([, e]) => e.exclusive && e.runs.length > 1)
      .map(([key]) => key)
      .sort(compareStrings);
    if (conflicts.length > 0 && phase !== "act") {
      throw new SchedulerError(
        `conflicto de escritura fuera de act (${phase}): ${conflicts
          .map(
            (k) => `${k} ← ${(touches.get(k)?.runs ?? []).map((i) => runs[i]?.def.id).join(", ")}`,
          )
          .join("; ")}`,
      );
    }

    const contestEvents: Omit<Event, "id">[] = [];
    for (const key of conflicts) {
      const contenders = (touches.get(key)?.runs ?? [])
        .map((i) => runs[i] as Run)
        .filter((r) => r.alive);
      if (contenders.length < 2) continue; // los demás ya perdieron otra contienda
      const rng = this.#o.rng.fork("contest", key, t);
      const scored = contenders.map((r) => {
        const claim = r.result.contest;
        if (!claim) {
          throw new SchedulerError(
            `${r.def.id} (${r.scope}) disputa ${key} sin declarar iniciativa`,
          );
        }
        return { run: r, claim, score: claim.initiative + rng.normal() };
      });
      let winner = 0;
      scored.forEach((s, i) => {
        if (s.score > (scored[winner] as (typeof scored)[number]).score) winner = i;
      });
      scored.forEach((s, i) => {
        if (i !== winner) s.run.alive = false;
      });
      const record: ContestRecord = {
        key,
        contenders: scored.map((s) => ({
          process: s.run.def.id,
          scope: s.run.scope,
          initiative: s.claim.initiative,
          score: s.score,
        })),
        winner,
      };
      contests.push(record);
      const [table, id] = splitKey(key, runs);
      contestEvents.push({
        tick: t,
        kind: "contest",
        actors: scored.flatMap((s) => actorOf(s.claim, s.run.scope)),
        place: (scored[winner] as (typeof scored)[number]).claim.place,
        data: record,
        emissions: {},
        causes: [{ kind: "state", entity: id, key: table }],
        resolution: this.#o.resolution,
      });
    }

    const truth = this.#o.truth;
    for (const run of runs) {
      if (!run.alive) continue;
      for (const c of run.result.changes ?? []) applyChange(truth, c, run.def.id);
    }

    for (const e of contestEvents) events.push({ id: this.#o.ids.next("event"), ...e });
    for (const run of runs) {
      if (!run.alive) continue;
      for (const draft of run.result.events ?? []) {
        events.push({
          ...draft,
          id: this.#o.ids.next("event"),
          tick: draft.tick ?? t,
          resolution: this.#o.resolution,
        });
      }
    }
    for (const run of runs) {
      if (!run.alive) continue;
      for (const r of run.result.schedule ?? []) this.#queue.push({ ...r, seq: this.#seq++ });
    }
  }
}

function applyChange(truth: WorldTruth, c: StateChange, by: ProcessId): void {
  switch (c.op) {
    case "set":
      truth.setRaw(c.table, c.id, c.value);
      return;
    case "delete":
      if (!truth.hasRaw(c.table, c.id)) {
        throw new SchedulerError(`${by} borra ${changeKey(c)}, que no existe`);
      }
      truth.deleteRaw(c.table, c.id);
      return;
    case "add": {
      const current = truth.getRaw(c.table, c.id);
      const value = (current as Record<string, unknown> | undefined)?.[c.field];
      if (typeof value !== "number") {
        throw new SchedulerError(`${by} suma a ${changeKey(c)}.${c.field}, que no es un número`);
      }
      truth.setRaw(c.table, c.id, { ...(current as object), [c.field]: value + c.amount });
      return;
    }
  }
}

/** La tabla y la entidad de una clave de conflicto, tomadas del primer cambio que la usa. */
function splitKey(key: string, runs: readonly Run[]): [string, StateChange["id"]] {
  for (const run of runs) {
    for (const c of run.result.changes ?? []) if (changeKey(c) === key) return [c.table, c.id];
  }
  throw new SchedulerError(`clave sin cambio: ${key}`);
}

function actorOf(claim: ContestClaim, scope: ScopeRef): StateChange["id"][] {
  if (claim.actor !== undefined) return [claim.actor];
  return scope === "world" ? [] : [scope];
}
