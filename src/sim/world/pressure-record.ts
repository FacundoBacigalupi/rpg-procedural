// El registro de presiones citadas (causality §9). Una presión es derivada y no se guarda, pero
// cuando un evento la cita como causa necesita un id estable para que `why` y el inspector puedan
// volver a ella: esa entidad nace del primer evento que la cita y acá lleva a qué presión
// corresponde (tipo y alcance) y cuántas veces se descargó. El valor del momento no se guarda
// acá: va en el `weight` de la causa de cada descarga.

import type { EntityRef, EventId } from "../../core/index.ts";
import { table } from "./truth.ts";

export interface PressureRecord {
  /** Un `PressureKind` (sim/causality); acá es texto para no depender de ese módulo. */
  readonly kind: string;
  readonly scopeKind: string;
  readonly scope: EntityRef;
  /** Cuántos eventos la citaron como causa. */
  readonly discharges: number;
  readonly lastDischarge?: EventId;
}

export const PRESSURE = table<PressureRecord>("pressure.record");
