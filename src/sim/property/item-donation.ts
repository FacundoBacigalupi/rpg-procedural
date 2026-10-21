// Armado de la donación normativa de un ítem (property §12). Función pura fuera del núcleo de
// transferencia: lee solo datos del propio haz (norma, incidentes, forma de constancia) y decide
// si las formalidades se cumplen. No hay catálogo de normas: sin haces del que da, no hay donación.
import type { AgentId, EventId, HolderRef } from "../../core/index.ts";
import type { ItemDonation, ItemRight } from "./item-transfer.ts";

export interface ItemDonationInput {
  readonly rights: readonly ItemRight[];
  readonly giver: AgentId;
  readonly recipient: HolderRef | null;
  /** Evento causal del traspaso: el registro nuevo lo cita. */
  readonly cause: EventId;
}

/**
 * Los haces del que da, de una sola norma (la del haz de menor clave; los de otras normas quedan
 * donde estaban). Las formalidades salen de la constancia del haz: una costumbre se cumple con el
 * acto mismo; una constancia con testigos exige que haya quien presencie, y el receptor lo hace.
 * Devuelve `undefined` si no hay nada que donar o el receptor no puede ser titular.
 */
export function itemDonationFor(input: ItemDonationInput): ItemDonation | undefined {
  const { giver, recipient, cause } = input;
  if (typeof recipient !== "string" || !recipient.startsWith("agent:") || recipient === giver)
    return undefined;
  const held = input.rights
    .filter((r) => r.holder === giver)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const first = held[0];
  if (!first) return undefined;
  const bundles = held.filter((r) => r.norm === first.norm);
  const witnessed = bundles.some((r) => r.record.kind === "witnesses");
  const witnesses = witnessed ? [giver, recipient as AgentId] : [];
  return {
    norm: first.norm,
    rightKeys: bundles.map((r) => r.key),
    formalitiesSatisfied: !witnessed || witnesses.some((w) => w !== giver),
    record: { kind: witnessed ? "witnesses" : "custom", witnesses, event: cause },
  };
}
