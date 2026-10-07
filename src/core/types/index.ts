// Tipos centrales canónicos (ARCHITECTURE §4): referencias a lugares y titulares, causas,
// eventos y la entidad base. Todos los sistemas los usan con estos nombres.

import type {
  AgentId,
  BeliefId,
  BuildingId,
  CellId,
  EntityRef,
  EventId,
  HouseholdId,
  JourneyId,
  OrgId,
  PlaceId,
  PlaneId,
  PressureId,
  RealmId,
  SettlementId,
} from "../ids/index.ts";
import type { Tick } from "../time/index.ts";

/** Clave de un espacio dentro del grafo de espacios de un edificio (perception §3). */
export type SpaceKey = string;

/** Quien puede tener, deber y prometer. */
export type Party = AgentId | OrgId | HouseholdId;

export type PlaceRef =
  | { readonly kind: "cell"; readonly cell: CellId }
  | { readonly kind: "place"; readonly place: PlaceId }
  | { readonly kind: "building"; readonly building: BuildingId; readonly space?: SpaceKey }
  | { readonly kind: "settlement"; readonly settlement: SettlementId }
  | { readonly kind: "realm"; readonly realm: RealmId; readonly at?: PlaceId }
  | { readonly kind: "plane"; readonly plane: PlaneId }
  | { readonly kind: "carried"; readonly by: AgentId | JourneyId }; // en la mano, en la carga de un viaje

/** Lo que tiene un lote: una parte, o un lugar (un granero, una ruina). */
export type HolderRef = Party | PlaceRef;

/**
 * Clave canónica de un lugar: el id de lo más específico, con el espacio o el punto de llegada
 * si los hay. Sirve de clave en mapas, en el ledger y en la base.
 */
export function placeKey(ref: PlaceRef): string {
  switch (ref.kind) {
    case "cell":
      return ref.cell;
    case "place":
      return ref.place;
    case "building":
      return ref.space === undefined ? ref.building : `${ref.building}/${ref.space}`;
    case "settlement":
      return ref.settlement;
    case "realm":
      return ref.at === undefined ? ref.realm : `${ref.realm}@${ref.at}`;
    case "plane":
      return ref.plane;
    case "carried":
      return `carried:${ref.by}`;
  }
}

/** Clave canónica de un titular: el id de la parte o la clave del lugar. */
export function holderKey(holder: HolderRef): string {
  return typeof holder === "string" ? holder : placeKey(holder);
}

/** Resolución a la que pasó algo (simulation §4.1). */
export type ZoneResolution = "scene" | "local" | "regional" | "world" | "history";

/** Por qué pasó algo: aristas del grafo causal (causality §2). */
export type CauseRef =
  | { readonly kind: "event"; readonly event: EventId; readonly weight?: number }
  | { readonly kind: "pressure"; readonly pressure: PressureId; readonly weight?: number }
  | {
      readonly kind: "belief";
      readonly belief: BeliefId;
      readonly holder: AgentId | OrgId;
      readonly weight?: number;
    }
  | {
      readonly kind: "state"; // "porque el granero estaba vacío"
      readonly entity: EntityRef;
      readonly key: string;
      readonly weight?: number;
    }
  | { readonly kind: "seed" }; // condiciones iniciales del mundo

/** Tipo de evento: clave del catálogo de content/events, con un esquema de `data` por tipo. */
export type EventKind = string;

/**
 * Un hecho que pasó. Inmutable: corregir algo es un evento nuevo con causa.
 * `Outcome` (sim/actions) y `EmissionProfile` (sim/perception) son de sus sistemas; core no los
 * conoce, así que `Event` es genérico y sim fija el tipo concreto.
 */
export interface Event<TOutcome = unknown, TEmissions = unknown> {
  readonly id: EventId;
  readonly tick: Tick;
  readonly kind: EventKind;
  readonly actors: readonly EntityRef[];
  readonly place: PlaceRef;
  readonly outcome?: TOutcome;
  readonly data: unknown;
  readonly emissions: TEmissions;
  readonly causes: readonly CauseRef[];
  readonly resolution: ZoneResolution;
}

/** Lo que tiene toda entidad: de dónde salió y, si terminó, cuándo y por qué. */
export interface EntityBase {
  readonly id: EntityRef;
  readonly originEventId: EventId;
  readonly createdAt: Tick;
  readonly endedAt?: Tick; // muerte, destrucción, disolución: la entidad queda para la historia
  readonly endEventId?: EventId;
}
