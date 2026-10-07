// Presiones como objeto (causality §9): derivadas del estado por una función pura de cada sistema,
// nunca verdad aparte. Se cachean para el inspector y los procesos; borrarlas y recalcularlas da
// lo mismo. Nadie dentro del mundo ve una presión: los agentes forman creencias de señales.

import type { CauseRef, EntityRef, PressureId } from "../../core/index.ts";
import type { ProcessId, SystemId } from "../scheduler/index.ts";

export const PRESSURE_KINDS = [
  "hunger",
  "debt",
  "resentment",
  "grievance",
  "ambition",
  "fear",
  "overcrowding",
  "qiDepletion",
  "qiSurplus",
  "succession",
  "legitimacy",
  "heavenDeficit",
  "pathogenLoad",
  "priceStress",
  "beastHunger",
  "fuel",
  "faith",
  "custom",
] as const;

export type PressureKind = (typeof PRESSURE_KINDS)[number];

export type PressureScopeKind = "agent" | "household" | "community" | "org" | "cell" | "region";

export interface PressureScope {
  readonly kind: PressureScopeKind;
  readonly ref: EntityRef;
}

/** Un proceso que puede descargar la presión, con lo que lo frena. */
export interface DischargeRef {
  readonly process: ProcessId;
  /** Dónde empieza a ser probable. */
  readonly threshold: number;
  /** Probabilidad por tick que el proceso le asigna con el estado actual. */
  readonly hazard: number;
  readonly blockers: readonly CauseRef[];
}

/** Lo que calcula un sistema: la presión sin identidad. */
export interface PressureReading {
  readonly kind: PressureKind;
  readonly scope: PressureScope;
  /** 0..1, normalizada por tipo. */
  readonly value: number;
  readonly sources: readonly CauseRef[];
  readonly discharges: readonly DischargeRef[];
  readonly system: SystemId;
}

/** Una lectura con su derivada y, si ya fue citada por un evento, su id estable. */
export interface Pressure extends PressureReading {
  readonly id?: PressureId;
  /** Cambio por día respecto de la lectura anterior; 0 si no hay anterior. */
  readonly trend: number;
}

export function pressureKey(kind: PressureKind, scope: PressureScope): string {
  return `${kind}@${scope.ref}`;
}
