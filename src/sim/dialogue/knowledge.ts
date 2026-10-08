// Lo que cada uno oyó contar (dialogue §6, information): hasta que exista el almacén de creencias,
// el oyente sabe de primera mano a su casa y a quien tiene al lado, y de lo demás solo lo que le
// dijeron. Lo dicho queda como dicho (con quién y cuándo), no como verdad: se puede dudar o
// revisar cuando llega algo mejor.

import type { AgentId, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";

export interface HeardClaim {
  readonly about: AgentId;
  readonly claim: "dead" | "alive";
  readonly from: AgentId;
  readonly at: Tick;
}

export interface Heard {
  readonly claims: readonly HeardClaim[];
}

/** Lo que alguien oyó contar, en su entidad. */
export const HEARD = table<Heard>("dialogue.heard");

/** Cuántas cosas oídas se guardan (las más viejas se olvidan). */
export const KEPT_CLAIMS = 24;

/** Suma `claim`: una nueva sobre lo mismo reemplaza a la anterior. */
export function hear(before: Heard | undefined, claim: HeardClaim): Heard {
  const kept = (before?.claims ?? []).filter((c) => c.about !== claim.about);
  return { claims: [...kept, claim].slice(-KEPT_CLAIMS) };
}
