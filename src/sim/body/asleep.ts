// Tier 1: el dormido (simulation §4.2, §7-§8). Un registro por persona dormida: desde cuándo y
// hasta cuándo se la avanzó. Lo leen los procesos que dejan de correr para ella (el cuerpo, la
// rutina, la decisión) y lo mantiene `game/life/sleepers.ts`, que la pone al día por tramos.
// Los hechos que un agregado le asigna mientras duerme (§7) esperan en `PENDING_FACTS` y la puesta
// al día los aplica primero, en su momento y con su causa (off-4).

import type { AgentId, EventId, Tick } from "../../core/index.ts";
import { type StateChange, setComponent } from "../scheduler/index.ts";
import { type ReadonlyWorldTruth, table } from "../world/index.ts";
import type { WoundKind } from "./state.ts";

export interface Asleep {
  readonly since: Tick;
  readonly lastAdvanced: Tick;
  /** Pedido de despertar: `life.catch_up` lo pone al día y borra el registro (off-3). */
  readonly wake?: boolean;
}

export const ASLEEP = table<Asleep>("sim.asleep");

/** Un hecho que un proceso agregado le asignó a alguien dormido (por ahora, un golpe). */
export interface PendingFact {
  readonly kind: "blow";
  /** Cuándo le pasó (el hecho se aplica a su cuerpo en ese momento, no al despertar). */
  readonly at: Tick;
  /** El evento del agregado que lo causó: la herida lo cita. */
  readonly cause: EventId;
  readonly blow: {
    readonly kind: WoundKind;
    readonly force: number;
    readonly zone?: string;
    readonly dirt?: number;
  };
}

export const PENDING_FACTS = table<readonly PendingFact[]>("sim.pending_facts");

/**
 * Anota un hecho para la puesta al día de `who` si está dormido; `undefined` si no lo está (quien
 * lo asigna lo aplica entonces por el camino de siempre). Puro: devuelve el cambio.
 */
export function assignPendingFact(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  fact: PendingFact,
): StateChange | undefined {
  if (!truth.get(ASLEEP, who)) return undefined;
  return setComponent(PENDING_FACTS, who, [...(truth.get(PENDING_FACTS, who) ?? []), fact]);
}
