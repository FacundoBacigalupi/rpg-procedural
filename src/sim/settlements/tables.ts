// Las tablas de settlements en la verdad (ARCHITECTURE §4.4: `sim/settlements` es dueño de
// `Settlement` y `Building`).

import type { EventId, HolderRef, HouseholdId, SettlementId, SpaceKey } from "../../core/index.ts";
import { type Barrier, type SpaceEdge, type SpaceNode, table } from "../world/index.ts";

export const DEFECT_KINDS = ["rot", "crack", "warp", "weak_join"] as const;
export type DefectKind = (typeof DEFECT_KINDS)[number];

/** Un defecto oculto de un componente: el dueño no lo ve hasta que falla (settlements §5). */
export interface Defect {
  readonly kind: DefectKind;
  readonly severity: number;
}

/** Cuánto de un material entró a un componente y de qué evento salió. */
export interface MaterialLine {
  readonly material: string;
  readonly grams: number;
  readonly origin: EventId;
}

export interface BuildingComponent {
  readonly part: "foundation" | "walls" | "roof" | "door";
  readonly area: number;
  readonly materials: readonly MaterialLine[];
  /** 0-1: el desgaste desde la última reparación (exponencial en los años). */
  readonly condition: number;
  /** 0-1: el oficio de quien lo hizo. */
  readonly quality: number;
  readonly defects: readonly Defect[];
}

/** Los espacios del edificio y cómo se entra desde la plaza. */
export interface BuildingGraph {
  readonly spaces: readonly SpaceNode[];
  readonly edges: readonly SpaceEdge[];
  readonly entrance: SpaceKey;
  readonly door: Barrier;
}

/** Un edificio que arde: cuánto, por qué, y de dónde sale la causa del próximo evento. */
export interface BuildingFire {
  readonly intensity: number;
  readonly cause: "hearth" | "lamp" | "lightning" | "arson" | "war" | "technique" | "spread";
  /** Gramos de materia que tenía al prenderse (para saber cuánto queda en pie). */
  readonly grams0: number;
  readonly since: number;
  /** El último evento del incendio en este edificio (ignición o último día). */
  readonly last: EventId;
}

export interface BuildingRecord {
  readonly type: string;
  readonly settlement: SettlementId;
  readonly hex: number;
  /** Metros respecto de la plaza (x al este, y al norte). */
  readonly at: { readonly x: number; readonly y: number };
  readonly owner: HolderRef;
  readonly maintainer: HolderRef;
  /** El hogar que vive ahí, si es una vivienda. Los ocupantes salen de `PERSON.household`. */
  readonly household?: HouseholdId;
  readonly graph: BuildingGraph;
  readonly components: readonly BuildingComponent[];
  readonly builtBy: EventId;
  /** El estado de la puerta (sin él, el de reposo del tipo: guardados de antes del mantenimiento). */
  readonly doorState?: "open" | "closed" | "jammed";
  /** El último arreglo: de dónde sale el origen que cita el próximo evento de reparación. */
  readonly lastRepair?: EventId;
  /** El incendio en curso (settlements §9); sin él, no arde. */
  readonly fire?: BuildingFire;
}

export interface WorkRecord {
  readonly type: string;
  readonly kind: "well" | "road";
  readonly settlement: SettlementId;
  /** Los hexes que cubre: el del pozo, o el trazado del camino. */
  readonly hexes: readonly number[];
  /** Litros por día (pozo); sin capacidad, 0. */
  readonly capacity: number;
  readonly source?: string;
  readonly condition: number;
  readonly owner: HolderRef;
  readonly maintainer: HolderRef;
  readonly materials: readonly MaterialLine[];
  readonly builtBy: EventId;
}

export interface SettlementAnchorRecord {
  readonly kind: "water" | "farmland" | "wood" | "harbor";
  readonly hexes: readonly number[];
  readonly detail?: string;
  /** El evento que lo causó (settlements §2.1: ninguna ancla existe sin causa). */
  readonly cause: EventId;
}

export interface SettlementRecord {
  readonly layout: "organic";
  readonly anchors: readonly SettlementAnchorRecord[];
  readonly foundedBy: EventId;
}

export const BUILDING = table<BuildingRecord>("settlement.building");
export const WORK = table<WorkRecord>("settlement.work");
export const SETTLEMENT = table<SettlementRecord>("settlement.state");
