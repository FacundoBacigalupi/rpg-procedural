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
// "onEvent" disparados por eventos (salvo los de la fase `perceive`, que corren al cerrar el paso
// con lo que se asentó, más una segunda ronda opt-in `perceiveCascade` con lo que emitieron ellos;
// el resto corre solo si se lo agenda), presupuesto, materializar
// y el caché de presiones.

import {
  assertTick,
  compareStrings,
  type EntityKind,
  type EntityRef,
  type Event,
  type EventId,
  type EventLog,
  EventLogError,
  type Id,
  type IdAllocator,
  type Ledger,
  LedgerError,
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
import { BatchLedger, BatchTruth, batchEvents } from "./batch.ts";
import {
  type ContestClaim,
  changeKey,
  compareScopes,
  draftEventCount,
  type EventDraft,
  PHASES,
  type Phase,
  type ProcessContext,
  type ProcessDef,
  type ProcessId,
  type ProcessResult,
  parseDraftRef,
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
  /** Adonde van los eventos asentados; valida causas al recibirlos. */
  readonly log: EventLog;
  readonly ids: IdAllocator;
  /** El ledger de conservación; sin él, un proceso no puede devolver asientos. */
  readonly ledger?: Ledger;
  readonly processes: readonly ProcessDef[];
  /** Una sola resolución para todo el mundo hasta que lleguen las zonas (Fase 5). */
  readonly resolution: ZoneResolution;
  /** Sobre qué alcances corre un proceso de cada tipo. "world" no hace falta declararlo. */
  readonly scopes?: (
    kind: ScopeKind,
    truth: ReadonlyWorldTruth,
    /** El proceso que se va a correr: permite excluir alcances solo para algunos (tier 1). */
    def: ProcessDef,
  ) => readonly ScopeRef[];
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
  readonly recent: readonly Event[];
  readonly rngParts: readonly (string | number)[];
}

interface Run extends RunSpec {
  result: ProcessResult;
  /** El tipo de cada id provisional que pidió, en orden (`agent:~0` es el primero). */
  readonly drafts: readonly EntityKind[];
  /** Los ids reales de sus eventos, una vez repartidos. */
  eventIds: readonly EventId[];
  alive: boolean;
  readonly serialBatch?: true;
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
              recent: [],
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
            recent: [],
            rngParts: [def.system, def.id, head.scope, "at", t, n],
          });
        }
        if (events.length > 0) {
          for (const def of this.#defs.values()) {
            if (
              def.phase !== phase ||
              def.withRecent !== true ||
              def.cadence[this.#o.resolution] !== "onEvent"
            ) {
              continue;
            }
            for (const scope of this.#scopesOf(def)) {
              specs.push({
                def,
                scope,
                window: 0,
                windowIndex: undefined,
                item: undefined,
                recent: [...events],
                rngParts: [def.system, def.id, scope, "event", t],
              });
            }
          }
        }
        specs.sort(
          (a, b) =>
            compareStrings(a.def.id, b.def.id) ||
            compareScopes(a.scope, b.scope) ||
            (a.item?.seq ?? -1) - (b.item?.seq ?? -1),
        );
        const runs: Run[] = [];
        const groups = new Map<string, RunSpec[]>();
        for (const spec of specs) {
          const key = spec.def.serialGroup?.({
            ...this.#context(spec, t, phase, []),
            newId() {
              throw new SchedulerError("serialGroup solo consulta: no crea entidades");
            },
          });
          if (key === undefined) {
            runs.push(this.#run(spec, t, phase));
            continue;
          }
          const groupKey =
            spec.def.serialDomain === undefined
              ? JSON.stringify(["process", spec.def.id, key, spec.window, spec.windowIndex])
              : JSON.stringify(["domain", spec.def.serialDomain, key]);
          const group = groups.get(groupKey) ?? [];
          group.push(spec);
          groups.set(groupKey, group);
        }
        for (const group of groups.values()) runs.push(this.#serial(group, t, phase));
        runs.sort(
          (a, b) =>
            compareStrings(a.def.id, b.def.id) ||
            compareScopes(a.scope, b.scope) ||
            (a.item?.seq ?? -1) - (b.item?.seq ?? -1),
        );
        this.#commit(runs, t, phase, events, contests);
      }
      // Lo percibido en este paso (perception): los procesos `perceive` por evento corren al
      // cerrarlo, con lo que se asentó, así que quien interrumpe un turno ya lo tiene guardado.
      const settled = [...events];
      if (settled.length > 0) {
        const specs: RunSpec[] = [];
        for (const def of this.#defs.values()) {
          if (def.phase !== "perceive" || def.cadence[this.#o.resolution] !== "onEvent") continue;
          for (const scope of this.#scopesOf(def)) {
            specs.push({
              def,
              scope,
              window: 0,
              windowIndex: undefined,
              item: undefined,
              recent: settled,
              rngParts: [def.system, def.id, scope, "event", t],
            });
          }
        }
        specs.sort((a, b) => compareStrings(a.def.id, b.def.id) || compareScopes(a.scope, b.scope));
        // Uno tras otro: cada proceso ve lo que dejó el anterior, así dos que aprenden sobre la
        // misma persona (deeds, testify) se suman en vez de pisarse.
        for (const spec of specs) {
          this.#commit([this.#run(spec, t, "perceive")], t, "perceive", events, contests);
        }
        // Segunda ronda opt-in (`perceiveCascade`): lo que emitieron los `perceive` de la primera
        // llega a quienes lo piden, en el mismo orden canónico y con RNG de otra clave.
        const cascaded = events.slice(settled.length);
        if (cascaded.length > 0) {
          const again: RunSpec[] = [];
          for (const def of this.#defs.values()) {
            if (def.phase !== "perceive" || def.cadence[this.#o.resolution] !== "onEvent") continue;
            const asked = def.perceiveCascade;
            if (asked === undefined) continue;
            const recent =
              asked === true ? cascaded : cascaded.filter((e) => asked.kinds.includes(e.kind));
            if (recent.length === 0) continue;
            for (const scope of this.#scopesOf(def)) {
              again.push({
                def,
                scope,
                window: 0,
                windowIndex: undefined,
                item: undefined,
                recent,
                rngParts: [def.system, def.id, scope, "cascade", t],
              });
            }
          }
          again.sort(
            (a, b) => compareStrings(a.def.id, b.def.id) || compareScopes(a.scope, b.scope),
          );
          for (const spec of again) {
            this.#commit([this.#run(spec, t, "perceive")], t, "perceive", events, contests);
          }
        }
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
    const all = scopes(def.scope, this.#o.truth, def);
    const guard = def.scopeGuard;
    const truth = this.#o.truth;
    return [...(guard ? [...all].filter((s) => guard(truth, s)) : all)].sort(compareScopes);
  }

  #run(spec: RunSpec, t: Tick, phase: Phase): Run {
    const drafts: EntityKind[] = [];
    const ctx = this.#context(spec, t, phase, drafts);
    const result = spec.def.run(ctx);
    this.#checkResult(spec, result, t, phase);
    return { ...spec, result, drafts, eventIds: [], alive: true };
  }

  #context(
    spec: RunSpec,
    t: Tick,
    phase: Phase,
    drafts: EntityKind[],
    truth: ReadonlyWorldTruth = this.#o.truth,
    ledger: ProcessContext["ledger"] = this.#o.ledger,
    offset = 0,
  ): ProcessContext {
    const ctx: ProcessContext = {
      now: t,
      window: spec.window,
      windowIndex: spec.windowIndex,
      scope: spec.scope,
      resolution: this.#o.resolution,
      phase,
      truth,
      ledger,
      rng: this.#o.rng.fork(...spec.rngParts),
      item: spec.item,
      recent: spec.recent,
      newId<K extends EntityKind>(kind: K): Id<K> {
        if ((kind as EntityKind) === "event") {
          throw new SchedulerError("los eventos se nombran con draftEvent, no con newId");
        }
        drafts.push(kind);
        return `${kind}:~${offset + drafts.length - 1}` as Id<K>;
      },
    };
    return ctx;
  }

  #serial(specs: readonly RunSpec[], t: Tick, phase: Phase): Run {
    const first = specs[0] as RunSpec;
    if (phase !== "act") throw new SchedulerError(`${first.def.id}: lote serial solo en act`);
    const truth = new BatchTruth(this.#o.truth);
    const ledger = this.#o.ledger ? new BatchLedger(this.#o.ledger) : undefined;
    const drafts: EntityKind[] = [];
    const eventsOut: EventDraft[] = [];
    const postings: NonNullable<ProcessResult["postings"]>[number][] = [];
    const schedule: ScheduleRequest[] = [];
    for (const spec of specs) {
      const localDrafts: EntityKind[] = [];
      const ctx = this.#context(spec, t, phase, localDrafts, truth, ledger, drafts.length);
      const result = spec.def.run(ctx);
      this.#checkResult(spec, result, t, phase);
      if (result.contest)
        throw new SchedulerError(`${spec.def.id}: el lote serial no admite iniciativa simultánea`);
      const remapped = batchEvents(result, eventsOut.length);
      // Valida todo el débito antes de acumular efectos; los overlays no mutan el mundo.
      for (const posting of remapped.postings ?? []) {
        if (
          !(remapped.events ?? []).some(
            (_, i) => posting.event === `event:batch:${eventsOut.length + i}`,
          )
        )
          throw new SchedulerError(`${spec.def.id}: asiento de evento ajeno al lote`);
        try {
          ledger?.post(posting.transfers);
        } catch (err) {
          throw new SchedulerError(
            `${spec.def.id}: asiento rechazado en lote: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      for (const change of remapped.changes ?? []) {
        try {
          truth.apply(change);
        } catch (err) {
          throw new SchedulerError(
            `${spec.def.id}: diff rechazado en lote: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      drafts.push(...localDrafts);
      eventsOut.push(...(remapped.events ?? []));
      postings.push(...(remapped.postings ?? []));
      schedule.push(...(remapped.schedule ?? []));
    }
    const result = batchEvents(
      { changes: truth.changes(), events: eventsOut, postings, schedule },
      0,
      true,
    );
    const sharedDomain = first.def.serialDomain !== undefined;
    const commitSpec = sharedDomain
      ? {
          ...first,
          def: {
            ...first.def,
            reads: [...new Set(specs.flatMap((spec) => spec.def.reads))].sort(compareStrings),
            writes: [...new Set(specs.flatMap((spec) => spec.def.writes))].sort(compareStrings),
          },
        }
      : first;
    // Cada resultado ya fue validado con su def/ventana. La unión solo autoriza el commit
    // de la tabla final; no autoriza a un miembro escribir la tabla de otro.
    this.#checkResult(commitSpec, result, t, phase, !sharedDomain);
    return { ...commitSpec, result, drafts, eventIds: [], alive: true, serialBatch: true };
  }

  #checkResult(
    spec: RunSpec,
    result: ProcessResult,
    t: Tick,
    phase: Phase,
    checkWindow = true,
  ): void {
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
      if (!checkWindow) continue;
      if (e.tick === undefined) continue;
      if (!Number.isSafeInteger(e.tick) || e.tick > t || e.tick < t - spec.window) {
        throw new SchedulerError(`${def.id}: evento con tick ${e.tick} fuera de su ventana`);
      }
    }
    for (const r of result.schedule ?? []) this.#checkItem({ ...r, seq: 0 }, t, phase);
    if (result.postings?.length && !this.#o.ledger) {
      throw new SchedulerError(`${def.id} devuelve asientos y el mundo no tiene ledger`);
    }
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
        if (parseDraftRef(c.id)) continue; // lo que se crea ahora no lo disputa nadie
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

    // Ids reales: primero los eventos de las contiendas, después cada corrida viva en orden, con sus
    // entidades y sus eventos. Los provisionales se reemplazan en todo el resultado.
    const { ids, log } = this.#o;
    const settled: Event[] = contestEvents.map((e) => ({ id: ids.next("event"), ...e }));
    const minted = draftEventCount() !== seenDraftEvents;
    seenDraftEvents = draftEventCount();
    for (const run of runs) {
      if (!run.alive) continue;
      const real = new Map<string, EntityRef>();
      run.drafts.forEach((kind, n) => {
        real.set(`${kind}:~${n}`, ids.next(kind));
      });
      run.eventIds = (run.result.events ?? []).map((_, n) => {
        const id = ids.next("event");
        real.set(`event:~${n}`, id);
        return id;
      });
      run.result = resolveDrafts(run.result, real, run.def.id, run.serialBatch === true, minted);
    }

    for (const run of runs) {
      if (!run.alive) continue;
      (run.result.events ?? []).forEach((draft, n) => {
        const { tick, ...rest } = draft;
        settled.push({
          ...rest,
          id: run.eventIds[n] as EventId,
          tick: tick ?? t,
          resolution: this.#o.resolution,
        });
      });
    }
    if (runs.some((run) => run.alive && run.serialBatch && run.def.serialDomain !== undefined)) {
      try {
        log.preview(settled);
      } catch (err) {
        if (!(err instanceof EventLogError)) throw err;
        throw new SchedulerError(`evento rechazado antes del commit de dominio: ${err.message}`);
      }
    }
    const truth = this.#o.truth;
    for (const run of runs) {
      if (!run.alive) continue;
      for (const c of run.result.changes ?? []) applyChange(truth, c, run.def.id);
    }
    for (const e of settled) {
      try {
        log.append(e);
      } catch (err) {
        if (!(err instanceof EventLogError)) throw err;
        throw new SchedulerError(`evento rechazado por el registro: ${err.message}`);
      }
      events.push(e);
    }

    const ledger = this.#o.ledger;
    for (const run of runs) {
      if (!run.alive || !ledger) continue;
      for (const p of run.result.postings ?? []) {
        const n = run.eventIds.indexOf(p.event);
        const e = log.get(p.event);
        if (n < 0 || !e) {
          throw new SchedulerError(
            `${run.def.id}: asiento por ${p.event}, que no es un evento suyo`,
          );
        }
        try {
          ledger.post({ tick: e.tick, eventId: e.id, transfers: p.transfers });
        } catch (err) {
          if (!(err instanceof LedgerError)) throw err;
          throw new SchedulerError(`${run.def.id}: asiento rechazado: ${err.message}`);
        }
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

let seenDraftEvents = 0;
const CLEAN = new WeakSet<object>();
const CLEAN_REMAP = new WeakSet<object>();

/** Reemplaza los ids provisionales por los reales en todo el resultado de una corrida. */
function resolveDrafts(
  result: ProcessResult,
  real: ReadonlyMap<string, EntityRef>,
  by: ProcessId,
  remapKeys = false,
  mintedDraftEvent = true,
): ProcessResult {
  // Sin ningún provisional (lo común) no hay nada que reemplazar: se evita copiar todo el resultado.
  // Los objetos ya revisados y limpios se recuerdan: un componente grande que crece por copia
  // (p. ej. los pasos de un plan de caminata larga) comparte casi todas sus partes con el anterior y
  // revisarlo entero en cada paso era cuadrático. Los valores de la verdad no se mutan en el lugar.
  const clean = remapKeys ? CLEAN_REMAP : CLEAN;
  const hasDraft = (v: unknown): boolean => {
    if (typeof v === "string") return v.includes(":~");
    if (v === null || typeof v !== "object") return false;
    if (clean.has(v)) return false;
    if (Array.isArray(v)) {
      for (const x of v) if (hasDraft(x)) return true;
    } else {
      for (const k of Object.keys(v)) {
        if (remapKeys && k.includes(":~")) return true;
        if (hasDraft((v as Record<string, unknown>)[k])) return true;
      }
    }
    clean.add(v);
    return false;
  };
  // Una corrida que no pidió ids ni emitió eventos no tiene a qué referirse: casi todas (294 mil de
  // 303 mil en el perfil de 60 días) y revisar sus resultados enormes era el 20 % del CPU. Un
  // provisional suelto sí se detecta (falla con "que no pidió") si hubo algún `draftEvent` desde el
  // paso anterior; los ids de `newId` ya cuentan en `real`.
  if ((real.size === 0 && !mintedDraftEvent) || !hasDraft(result)) return result;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (!parseDraftRef(v)) return v;
      const id = real.get(v);
      if (id === undefined) throw new SchedulerError(`${by} usa ${v}, que no pidió ni emitió`);
      return id;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[remapKeys ? (walk(k) as string) : k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(result) as ProcessResult;
}
