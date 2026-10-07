// Procesos: la unidad de simulación (simulation §2). Leen el estado, deciden o tiran, y devuelven
// diffs, eventos y revisiones futuras. No escriben nada: el scheduler aplica al cerrar la fase.

import {
  type CauseRef,
  compareIds,
  compareStrings,
  type Duration,
  type EntityRef,
  type Event,
  type PlaceRef,
  type Rng,
  type Tick,
  type TimeScale,
  type ZoneResolution,
} from "../../core/index.ts";
import type { ReadonlyWorldTruth, Table } from "../world/index.ts";

/** "economy.market.clear", "body.wound.heal": empieza con el id del sistema. */
export type ProcessId = string;
export type SystemId = string;

export type Phase =
  | "perceive" // los eventos del paso anterior llegan a quienes los perciben (perception)
  | "decide" // los agentes eligen acciones con sus creencias (utilidad, órdenes, intrigas)
  | "act" // las acciones se resuelven: tiradas, conflictos, eventos
  | "physics" // el mundo responde: esencia, clima, cuerpo, ecología, fuego, elementos
  | "settle"; // contabilidad: ledgers, presiones, compromisos que vencen, compactación

/** Orden fijo de las fases dentro de un paso. */
export const PHASES: readonly Phase[] = ["perceive", "decide", "act", "physics", "settle"];

export function phaseIndex(phase: Phase): number {
  const i = PHASES.indexOf(phase);
  if (i < 0) throw new TypeError(`fase desconocida: ${phase}`);
  return i;
}

export type ScopeKind =
  | "agent"
  | "household"
  | "settlement"
  | "org"
  | "cell"
  | "region"
  | "world"
  | "realm";

/** Sobre qué corre una instancia de un proceso: una entidad, o el mundo entero. */
export type ScopeRef = EntityRef | "world";

/** Orden canónico de los alcances: el mundo primero, después por id. */
export function compareScopes(a: ScopeRef, b: ScopeRef): number {
  if (a === b) return 0;
  if (a === "world") return -1;
  if (b === "world") return 1;
  return compareIds(a, b);
}

// ---------------------------------------------------------------------------------------------
// Diffs

/**
 * Un cambio en un componente. `set` y `delete` son exclusivos: si dos corridas los hacen sobre el
 * mismo componente, hay conflicto. `add` suma a un campo numérico y conmuta con otros `add`
 * (se aplican en orden canónico, así que hasta el redondeo de los floats es determinista).
 */
export type StateChange =
  | { readonly op: "set"; readonly table: string; readonly id: EntityRef; readonly value: unknown }
  | { readonly op: "delete"; readonly table: string; readonly id: EntityRef }
  | {
      readonly op: "add";
      readonly table: string;
      readonly id: EntityRef;
      readonly field: string;
      readonly amount: number;
    };

export function setComponent<T>(table: Table<T>, id: EntityRef, value: T): StateChange {
  return { op: "set", table: table.name, id, value };
}

export function deleteComponent(table: Table<unknown>, id: EntityRef): StateChange {
  return { op: "delete", table: table.name, id };
}

/** Suma `amount` al campo numérico `field` del componente. */
export function addToField<T>(
  table: Table<T>,
  id: EntityRef,
  field: keyof T & string,
  amount: number,
): StateChange {
  return { op: "add", table: table.name, id, field, amount };
}

/** Clave de conflicto: un componente de una entidad. */
export function changeKey(change: StateChange): string {
  return `${change.table}/${change.id}`;
}

// ---------------------------------------------------------------------------------------------
// Eventos, revisiones agendadas, contiendas

/**
 * Un evento como lo devuelve un proceso: el scheduler le pone id (en orden canónico), la
 * resolución y, si no lo trae, el tick del paso. Un tick propio tiene que caer en la ventana.
 */
export type EventDraft = Omit<Event, "id" | "tick" | "resolution"> & { readonly tick?: Tick };

export interface ScheduledItem {
  readonly at: Tick;
  readonly phase: Phase;
  readonly process: ProcessId;
  readonly scope: ScopeRef;
  readonly reason: CauseRef; // por qué está agendado (la caravana salió, el embarazo empezó)
  readonly seq: number; // desempate estable: orden de creación, que es determinista
}

export type ScheduleRequest = Omit<ScheduledItem, "seq">;

/**
 * Lo que una corrida pone en juego si choca con otra en la fase `act` (simulation §3): su
 * iniciativa, que sale del estado (velocidad, distancia, atención, sorpresa), en desvíos estándar
 * de la tirada; dónde pasa; y quién actúa (si no es el alcance).
 */
export interface ContestClaim {
  readonly initiative: number;
  readonly place: PlaceRef;
  readonly actor?: EntityRef;
}

export interface ProcessResult {
  readonly changes?: readonly StateChange[];
  readonly events?: readonly EventDraft[];
  readonly schedule?: readonly ScheduleRequest[];
  readonly contest?: ContestClaim;
}

export interface ProcessContext {
  readonly now: Tick;
  /** Cuánto tiempo cubre esta corrida: la ventana que terminó en `now` (0 para lo agendado). */
  readonly window: Duration;
  /** Índice de la ventana de la cadencia, o undefined si la corrida es un ítem agendado. */
  readonly windowIndex: number | undefined;
  readonly scope: ScopeRef;
  readonly resolution: ZoneResolution;
  readonly phase: Phase;
  readonly truth: ReadonlyWorldTruth;
  /** Ya forkeado por clave: (sistema, proceso, alcance, ventana) o (…, "at", tick, n). */
  readonly rng: Rng;
  /** El ítem que disparó la corrida, si fue agendada. */
  readonly item: ScheduledItem | undefined;
}

export interface ProcessDef {
  readonly id: ProcessId;
  readonly system: SystemId;
  readonly scope: ScopeKind;
  /** Cada cuánto corre según la resolución; sin entrada, no corre a esa resolución. */
  readonly cadence: Partial<Record<ZoneResolution, TimeScale | "onEvent">>;
  readonly representation: "individual" | "aggregate" | "both";
  readonly phase: Phase;
  /** Tablas que lee y que escribe. Escribir fuera de `writes` es un error. */
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  run(ctx: ProcessContext): ProcessResult;
}

/** Orden canónico de los ítems agendados: tick, fase, proceso, alcance, creación. */
export function compareItems(a: ScheduledItem, b: ScheduledItem): number {
  return (
    a.at - b.at ||
    phaseIndex(a.phase) - phaseIndex(b.phase) ||
    compareStrings(a.process, b.process) ||
    compareScopes(a.scope, b.scope) ||
    a.seq - b.seq
  );
}
