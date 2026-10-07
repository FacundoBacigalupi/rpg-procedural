// El libro de presiones: corre las fuentes (una función pura por sistema) sobre el estado y
// devuelve las lecturas con su tendencia y, por tipo, el hazard de cada descarga. No guarda nada:
// borrar el resultado y volver a leer da lo mismo (causality §9, test "recalcular = caché").

import { compareIds, compareStrings, type PressureId, type Tick } from "../../core/index.ts";
import type { ReadonlyLedger } from "../scheduler/index.ts";
import { PRESSURE, type ReadonlyWorldTruth } from "../world/index.ts";
import { sparkOf } from "./cite.ts";
import { hazardOf, type PressureCurve } from "./curves.ts";
import { type Pressure, type PressureKind, type PressureReading, pressureKey } from "./types.ts";

export interface PressureInput {
  readonly truth: ReadonlyWorldTruth;
  readonly ledger: ReadonlyLedger;
  readonly now: Tick;
}

/** Lo que un sistema aporta: todas las presiones de su tipo que hoy existen. */
export interface PressureSource {
  readonly kind: PressureKind;
  read(input: PressureInput): readonly PressureReading[];
}

/** Una lectura anterior, para la tendencia: valor y tick. */
export interface PreviousReading {
  readonly value: number;
  readonly at: Tick;
}

export function readPressures(
  sources: readonly PressureSource[],
  input: PressureInput,
  opts: {
    readonly previous?: ReadonlyMap<string, PreviousReading>;
    /** Ticks que dura un día de mundo, para expresar la tendencia por día. */
    readonly day?: number;
  } = {},
): Pressure[] {
  const out: Pressure[] = [];
  // Las que algún evento ya citó tienen id estable; las demás todavía son solo una lectura.
  const registered = new Map<string, PressureId>();
  for (const id of input.truth.ids(PRESSURE)) {
    const r = input.truth.get(PRESSURE, id);
    if (r) registered.set(`${r.kind}@${r.scope}`, id as PressureId);
  }
  for (const source of sources) {
    for (const r of source.read(input)) {
      if (!Number.isFinite(r.value) || r.value < 0 || r.value > 1) {
        throw new RangeError(`presión fuera de 0..1: ${r.kind}@${r.scope.ref} = ${r.value}`);
      }
      const before = opts.previous?.get(pressureKey(r.kind, r.scope));
      const days = before && opts.day ? (input.now - before.at) / opts.day : 0;
      const id = registered.get(pressureKey(r.kind, r.scope));
      out.push({
        ...r,
        ...(id ? { id } : {}),
        trend: before && days > 0 ? (r.value - before.value) / days : 0,
      });
    }
  }
  return out.sort((a, b) => compareStrings(a.kind, b.kind) || compareIds(a.scope.ref, b.scope.ref));
}

/**
 * Con el hazard que le da a cada descarga la curva de su tipo. Si se pasa la verdad y el tick,
 * las chispas vivas del alcance bajan el umbral.
 */
export function withHazards(
  pressures: readonly Pressure[],
  curves: readonly PressureCurve[],
  sparks?: { readonly truth: ReadonlyWorldTruth; readonly now: Tick },
): Pressure[] {
  return pressures.map((p) => {
    const curve = curves.find((c) => c.id === p.kind);
    if (!curve) return p;
    const spark = sparks ? sparkOf(sparks.truth, p.kind, p.scope.ref, sparks.now) : 0;
    return {
      ...p,
      discharges: p.discharges.map((d) => ({ ...d, hazard: hazardOf(curve, p.value, { spark }) })),
    };
  });
}
