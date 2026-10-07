// Parcelas con dueño (property §1, §3, §9, Fase 1). Las tres capas viven separadas:
// - la posesión es verdad física (`Parcel.possession`: quién la ocupa y trabaja);
// - los derechos son verdad normativa (`Parcel.rights`: un haz por titular, bajo una forma de
//   tenencia de la cultura, con su constancia: testigos o costumbre);
// - la creencia es de cada uno (`PARCEL_BELIEFS`: a quién cree que pertenece, de qué fuente).
// Las capas pueden no coincidir: el que no presenció el trato supone que la tierra es de quien la
// trabaja. Todavía no hay escrituras ni catastros (Fase 5), ni venta o herencia (Fase 3).

import type {
  AgentId,
  EventId,
  HouseholdId,
  OrgId,
  ParcelId,
  SettlementId,
  Tick,
} from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { Incident, RecordKind } from "./tenure.ts";

export const LAND_USES = ["field", "house_plot", "pasture", "woodland"] as const;
export type LandUse = (typeof LAND_USES)[number];

/** Constancia de un derecho: quién estuvo cuando se acordó (o la costumbre, sin nadie). */
export interface RecordRef {
  readonly kind: RecordKind;
  readonly witnesses: readonly AgentId[];
  readonly event: EventId;
}

/** Quien puede tener derechos sobre tierra: una persona, una casa, una organización o la aldea entera. */
export type Holder = AgentId | HouseholdId | OrgId | SettlementId;

export type Basis = "clearing" | "custom";

export interface Right {
  readonly holder: Holder;
  readonly incidents: readonly Incident[];
  readonly tenure: string;
  readonly basis: Basis;
  readonly record: RecordRef;
}

export interface Boundary {
  readonly with: ParcelId | "road" | "commons" | "waste";
  /** Qué lo marca: un mojón, un cerco, un arroyo, nada (solo memoria). */
  readonly marker: "stone" | "hedge" | "ditch" | "memory";
}

export interface Parcel {
  readonly settlement: SettlementId;
  readonly hex: number;
  /** Metros respecto de la plaza; los campos y el monte no tienen un punto (están en su hex). */
  readonly at: { readonly x: number; readonly y: number } | null;
  /** En metros cuadrados. */
  readonly area: number;
  readonly landUse: LandUse;
  readonly boundaries: readonly Boundary[];
  readonly rights: readonly Right[];
  /** Quién la ocupa de hecho (puede no ser el dueño), o nadie. */
  readonly possession: Holder | null;
  readonly createdAt: Tick;
}

export const PARCEL = table<Parcel>("property.parcel");

export type BeliefVia = "own" | "witnessed" | "inferred";

export interface OwnerBelief {
  readonly parcel: ParcelId;
  /** A quién cree que pertenece. */
  readonly holder: Holder;
  readonly via: BeliefVia;
}

export interface ParcelBeliefs {
  readonly beliefs: readonly OwnerBelief[];
}

/** Lo que cada uno cree de a quién pertenece cada parcela, en su entidad. */
export const PARCEL_BELIEFS = table<ParcelBeliefs>("property.beliefs");

/** El dueño de verdad: quien tiene el derecho de enajenar, o el comunal si nadie. */
export function ownerOf(p: Parcel): Holder | null {
  const full = p.rights.find((r) => r.incidents.includes("alienate"));
  if (full) return full.holder;
  return p.rights.find((r) => r.tenure === "commons")?.holder ?? null;
}

export function believedOwner(b: ParcelBeliefs | undefined, parcel: ParcelId): OwnerBelief | null {
  return b?.beliefs.find((x) => x.parcel === parcel) ?? null;
}

/** Los que se equivocan sobre una parcela: creen un dueño distinto del verdadero. */
export function mistaken(
  parcel: Parcel,
  id: ParcelId,
  beliefs: ReadonlyMap<AgentId, ParcelBeliefs>,
): AgentId[] {
  const owner = ownerOf(parcel);
  const out: AgentId[] = [];
  for (const [agent, b] of beliefs) {
    const believed = believedOwner(b, id);
    if (believed && believed.holder !== owner) out.push(agent);
  }
  return out;
}

/** Los derechos que `holder` tiene sobre la parcela (puede ser un haz repartido con otros). */
export function rightsOf(p: Parcel, holder: Holder): readonly Right[] {
  return p.rights.filter((r) => r.holder === holder);
}

export function canDo(p: Parcel, holder: Holder, incident: Incident): boolean {
  return rightsOf(p, holder).some((r) => r.incidents.includes(incident));
}
