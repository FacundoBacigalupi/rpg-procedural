// Lo que le contaron al personaje de si alguien vive («dicen que…», heard-4): sale de sus creencias
// `alive` con fuente `told` (`BELIEFS`), nunca de la verdad, y entra a la vista con los nombres con
// que él conoce a los dos (de quién habla y quién se lo dijo). Solo lo que llegó desde `since`; si
// no conoce a la persona de la que hablan, no entra (el narrador no puede nombrar a un desconocido).

import type { AgentId, Tick } from "../../core/index.ts";
import { BELIEFS, type Beliefs } from "../../sim/index.ts";
import type { HeardClaimView } from "../view/index.ts";
import { acquaintances } from "./witness.ts";
import type { LifeWorld } from "./world.ts";

/** Desde qué confianza cuenta lo oído como seguro (sin calibrar). */
export const HEARD_CLAIM_SURE = 0.5;

/** Puro: las afirmaciones `told` de `beliefs` llegadas después de `since`, con los nombres de `nameOf`. */
export function heardClaimsOf(
  beliefs: Beliefs | undefined,
  since: Tick,
  me: AgentId,
  nameOf: (id: AgentId) => string | undefined,
): HeardClaimView[] {
  const out: HeardClaimView[] = [];
  for (const b of beliefs?.items ?? []) {
    if (b.prop.kind !== "attr" || b.prop.attr !== "alive" || typeof b.value !== "boolean") continue;
    const told = [...b.sources].reverse().find((s) => s.kind === "told");
    if (told?.kind !== "told" || told.tick <= since) continue;
    const about = b.prop.subject as AgentId;
    if (about === me) continue;
    const aboutName = nameOf(about);
    if (aboutName === undefined) continue;
    const from = nameOf(told.from);
    out.push({
      about: aboutName,
      claim: b.value ? "alive" : "dead",
      ...(from !== undefined ? { from } : {}),
      sure: b.confidence >= HEARD_CLAIM_SURE,
    });
  }
  return out;
}

export function heardClaimsForView(w: LifeWorld, since: Tick): readonly HeardClaimView[] {
  const acq = acquaintances(w);
  return heardClaimsOf(w.truth.get(BELIEFS, w.player), since, w.player, (id) => {
    const a = acq.get(id);
    return a?.name ?? a?.relation;
  });
}
