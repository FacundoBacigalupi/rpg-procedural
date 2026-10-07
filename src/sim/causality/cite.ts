// Citar una presión (causality §9): el proceso que la descarga la nombra en `causes` del evento
// con el valor que tenía en ese momento. La primera vez crea la entidad de la presión, que nace
// de ese mismo evento; las siguientes solo cuentan la descarga. Las chispas son eventos puntuales
// que bajan el umbral por un rato y vencen: se guardan en el alcance de la presión.

import type { CauseRef, EntityRef, EventId, PressureId, Tick } from "../../core/index.ts";
import {
  createEntity,
  type ProcessContext,
  type StateChange,
  setComponent,
} from "../scheduler/index.ts";
import { PRESSURE, type ReadonlyWorldTruth, table } from "../world/index.ts";
import type { PressureKind, PressureScope } from "./types.ts";

/** El id de la presión ya citada alguna vez para ese tipo y alcance, si la hay. */
export function findPressure(
  truth: ReadonlyWorldTruth,
  kind: PressureKind,
  scope: PressureScope,
): PressureId | undefined {
  for (const id of truth.ids(PRESSURE)) {
    const r = truth.get(PRESSURE, id);
    if (r?.kind === kind && r.scope === scope.ref) return id as PressureId;
  }
  return undefined;
}

export interface Citation {
  readonly id: PressureId;
  /** La causa para el evento de la descarga, con el valor del momento como peso. */
  readonly cause: CauseRef;
  /** Registro nuevo o actualizado: va en `changes` del mismo resultado que el evento. */
  readonly changes: readonly StateChange[];
}

/**
 * La causa de una descarga. `event` es el evento (normalmente un `draftEvent`) que descarga la
 * presión: si la presión no estaba registrada nace de él, y si estaba, queda como su última
 * descarga. `reading` es la lectura del momento, la que decidió el proceso.
 */
export function citePressure(
  ctx: Pick<ProcessContext, "truth" | "now" | "newId">,
  reading: { readonly kind: PressureKind; readonly scope: PressureScope; readonly value: number },
  event: EventId,
): Citation {
  if (!(reading.value >= 0 && reading.value <= 1)) {
    throw new RangeError(`presión fuera de 0..1: ${reading.kind}@${reading.scope.ref}`);
  }
  const known = findPressure(ctx.truth, reading.kind, reading.scope);
  const id = known ?? ctx.newId("pressure");
  const before = known ? ctx.truth.get(PRESSURE, known) : undefined;
  return {
    id,
    cause: { kind: "pressure", pressure: id, weight: reading.value },
    changes: [
      ...(known ? [] : [createEntity(id, event, ctx.now)]),
      setComponent(PRESSURE, id, {
        kind: reading.kind,
        scopeKind: reading.scope.kind,
        scope: reading.scope.ref,
        discharges: (before?.discharges ?? 0) + 1,
        lastDischarge: event,
      }),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Chispas

/** Un evento que baja el umbral de un tipo de presión en un alcance, con vencimiento. */
export interface Spark {
  readonly kind: PressureKind;
  readonly event: EventId;
  /** Cuánto baja el umbral al principio (0..1); decae linealmente hasta `expiresAt`. */
  readonly strength: number;
  readonly at: Tick;
  readonly expiresAt: Tick;
}

/** Las chispas de un alcance (el hogar, la comunidad…): viven en su entidad. */
export const SPARKS = table<{ readonly sparks: readonly Spark[] }>("pressure.sparks");

/** Lo que baja el umbral una chispa en `now`: todo al nacer, nada al vencer. */
export function sparkStrength(s: Spark, now: Tick): number {
  if (now >= s.expiresAt || now < s.at) return 0;
  return s.strength * (1 - (now - s.at) / (s.expiresAt - s.at));
}

/** Lo que bajan juntas las chispas vivas de un tipo: se combinan sin pasar de 1. */
export function sparkOf(
  truth: ReadonlyWorldTruth,
  kind: PressureKind,
  scope: EntityRef,
  now: Tick,
): number {
  let rest = 1;
  for (const s of truth.get(SPARKS, scope)?.sparks ?? []) {
    if (s.kind === kind) rest *= 1 - sparkStrength(s, now);
  }
  return 1 - rest;
}

/** Agrega una chispa al alcance y deja de guardar las vencidas. */
export function addSpark(
  truth: ReadonlyWorldTruth,
  scope: EntityRef,
  spark: Spark,
  now: Tick,
): StateChange {
  if (!(spark.strength > 0 && spark.strength <= 1) || spark.expiresAt <= spark.at) {
    throw new RangeError(`chispa inválida: ${spark.kind}@${scope}`);
  }
  const alive = (truth.get(SPARKS, scope)?.sparks ?? []).filter((s) => s.expiresAt > now);
  return setComponent(SPARKS, scope, { sparks: [...alive, spark] });
}
