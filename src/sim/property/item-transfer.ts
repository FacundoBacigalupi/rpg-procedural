// Núcleo de objetos con identidad (property §12). Recibe una adjudicación física ya
// resuelta y propone cambios; no registra componentes ni sustituye al scheduler.
import {
  type EntityBase,
  type EventId,
  type HolderRef,
  holderKey,
  type ItemId,
  type Tick,
} from "../../core/index.ts";
import type { RecordRef, Right } from "./parcel.ts";

/** Proyección para muebles: reutiliza el haz/registro de property, sin cambiar parcelas. */
export interface ItemRight extends Pick<Right, "holder" | "incidents" | "tenure" | "record"> {
  readonly key: string;
  readonly norm: string;
  readonly originEventId: EventId;
  /** Cuota indivisa: transferir este haz no transfiere las cuotas de otros titulares. */
  readonly share: number;
  readonly encumbrances: readonly {
    readonly key: string;
    readonly originEventId: EventId;
    /** Sin regla explícita de esta norma se conserva el derecho, sin donarlo. */
    readonly preventsAlienation?: boolean;
  }[];
}

export interface ItemTransferSnapshot {
  readonly entity: EntityBase & { readonly id: ItemId };
  readonly possession: HolderRef | null;
  readonly rights: readonly ItemRight[];
}

/** Disponibilidad física aportada por world/acciones; un origen cadáver puede existir. */
export interface ItemTransferEndpoint {
  readonly holder: HolderRef | null;
  readonly exists: boolean;
  readonly reachable: boolean;
  readonly endedAt?: Tick;
}

export interface ItemDonation {
  readonly norm: string;
  readonly rightKeys: readonly string[];
  /** Las formalidades de la norma se evalúan fuera de este núcleo. */
  readonly formalitiesSatisfied: boolean;
  readonly record: RecordRef;
}

export interface ItemTransferInput {
  readonly item: ItemId;
  readonly snapshot: ItemTransferSnapshot | undefined;
  readonly from: ItemTransferEndpoint;
  readonly to: ItemTransferEndpoint;
  readonly operation: "take" | "give";
  /** Evento causal ya validado por el llamador; el núcleo no consulta el log. */
  readonly cause: EventId;
  readonly donation?: ItemDonation;
}

export type ItemTransferFailure =
  | "missing_item"
  | "ended_item"
  | "stale_possession"
  | "unavailable_source"
  | "unavailable_destination"
  | "same_holder"
  | "invalid_snapshot";

export type ItemDonationFailure =
  | "not_a_gift"
  | "formalities_missing"
  | "invalid_rights"
  | "not_alienable"
  | "encumbered";

export type ItemTransferResult =
  | { readonly accepted: false; readonly reason: ItemTransferFailure }
  | {
      readonly accepted: true;
      readonly item: ItemId;
      readonly originEventId: EventId;
      readonly cause: EventId;
      readonly previousPossession: HolderRef | null;
      readonly possession: HolderRef;
      readonly rights: readonly ItemRight[];
      readonly donation:
        | { readonly transferred: false; readonly reason?: ItemDonationFailure }
        | { readonly transferred: true; readonly rightKeys: readonly string[] };
    };

function sameHolder(a: HolderRef | null, b: HolderRef | null): boolean {
  return a === null || b === null ? a === b : holderKey(a) === holderKey(b);
}

function agentEndpoint(holder: HolderRef): boolean {
  return typeof holder === "string"
    ? holder.startsWith("agent:")
    : holder.kind === "carried" && holder.by.startsWith("agent:");
}

/** La entrega física y la adquisición normativa son resultados independientes. */
export function transferItem(input: ItemTransferInput): ItemTransferResult {
  const { snapshot, from, to, donation } = input;
  if (!snapshot || snapshot.entity.id !== input.item)
    return { accepted: false, reason: "missing_item" };
  if (snapshot.entity.endedAt !== undefined) return { accepted: false, reason: "ended_item" };
  if (
    !snapshot.entity.originEventId ||
    !input.cause ||
    new Set(snapshot.rights.map((r) => r.key)).size !== snapshot.rights.length ||
    snapshot.rights.some(
      (r) => !r.key || !r.norm || !r.originEventId || !(r.share > 0 && r.share <= 1),
    )
  )
    return { accepted: false, reason: "invalid_snapshot" };
  if (!sameHolder(snapshot.possession, from.holder))
    return { accepted: false, reason: "stale_possession" };
  if (!from.exists || !from.reachable) return { accepted: false, reason: "unavailable_source" };
  if (
    to.holder === null ||
    !to.exists ||
    !to.reachable ||
    (agentEndpoint(to.holder) && to.endedAt !== undefined)
  )
    return { accepted: false, reason: "unavailable_destination" };
  if (sameHolder(from.holder, to.holder)) return { accepted: false, reason: "same_holder" };

  let outcome: Extract<ItemTransferResult, { accepted: true }>["donation"] = {
    transferred: false,
  };
  let rights = snapshot.rights;
  if (donation) {
    const selected = new Set(donation.rightKeys);
    const bundles = snapshot.rights.filter((r) => selected.has(r.key));
    let reason: ItemDonationFailure | undefined;
    if (input.operation !== "give") reason = "not_a_gift";
    else if (!donation.formalitiesSatisfied || donation.record.event !== input.cause)
      reason = "formalities_missing";
    else if (
      selected.size === 0 ||
      selected.size !== donation.rightKeys.length ||
      bundles.length !== selected.size ||
      bundles.some((r) => r.norm !== donation.norm || !sameHolder(r.holder, from.holder)) ||
      typeof to.holder !== "string"
    )
      reason = "invalid_rights";
    else if (bundles.some((r) => !r.incidents.includes("alienate"))) reason = "not_alienable";
    else if (bundles.some((r) => r.encumbrances.some((c) => c.preventsAlienation !== false)))
      reason = "encumbered";
    if (reason) outcome = { transferred: false, reason };
    else {
      // No crear/dividir haces: cambiar titular de los existentes, conservando cuota y cargas.
      const recipient = to.holder as Right["holder"];
      rights = snapshot.rights.map((r) =>
        selected.has(r.key) ? { ...r, holder: recipient, record: donation.record } : r,
      );
      outcome = { transferred: true, rightKeys: [...selected].sort() };
    }
  }
  return {
    accepted: true,
    item: input.item,
    originEventId: snapshot.entity.originEventId,
    cause: input.cause,
    previousPossession: snapshot.possession,
    possession: to.holder,
    rights,
    donation: outcome,
  };
}
