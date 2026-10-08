// Quién cree el personaje que es cada uno (culture §8): de lo que ve (marcas mostradas de quien
// actúa a su vista) arma una `IdentityBelief` por persona con `ascribeGroup`. Lo que se lee es lo
// mostrado, no la variante interna: una marca imitada engaña. Solo cuentan los rasgos que se ven
// o se oyen; la creencia se guarda en la entidad del personaje y se refina con cada marca nueva.

import type { AgentId, Event, EventId } from "../../core/index.ts";
import {
  ascribeGroup,
  COMMUNITY_CULTURE,
  type CommunityCulture,
  type IdentityBelief,
  PERSON_CULTURE,
  type Percept,
  type ReadonlyWorldTruth,
  type TraitDef,
  type TraitDomain,
  table,
} from "../../sim/index.ts";

/** Dominios cuyas marcas se ven u oyen en quien pasa (ropa, gusto, modales, humor). */
export const VISIBLE_DOMAINS: readonly TraitDomain[] = [
  "dress",
  "aesthetics",
  "etiquette",
  "humor",
];

/** Lo que el personaje cree de a qué grupo pertenece cada persona que vio (clave: a quién). */
export interface AscribedGroups {
  readonly about: Readonly<Record<string, IdentityBelief>>;
}

export const ASCRIBED_GROUPS = table<AscribedGroups>("life.ascribed_groups");

/** Las marcas mostradas de `who` que un observador puede leer, por rasgo. */
export function visibleMarks(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  traits: readonly TraitDef[],
): Record<string, string> {
  const held = truth.get(PERSON_CULTURE, who)?.holdings ?? {};
  const out: Record<string, string> = {};
  for (const t of traits) {
    if (!VISIBLE_DOMAINS.includes(t.domain)) continue;
    const h = held[t.id];
    if (h) out[t.id] = h.shown;
  }
  return out;
}

function communities(truth: ReadonlyWorldTruth): CommunityCulture[] {
  return truth.ids(COMMUNITY_CULTURE).flatMap((id) => {
    const c = truth.get(COMMUNITY_CULTURE, id);
    return c ? [c] : [];
  });
}

/**
 * Las creencias nuevas del personaje a partir de lo que percibió (`fresh`): por cada actor
 * distinto de sí mismo que vio con detalle claro, `ascribeGroup` sobre sus marcas visibles.
 * Devuelve el registro entero (lo anterior más lo nuevo, quedándose con lo más seguro).
 */
export function ascribeFromPercepts(
  truth: ReadonlyWorldTruth,
  player: AgentId,
  fresh: readonly Percept[],
  events: readonly Event[],
  traits: readonly TraitDef[],
): AscribedGroups | undefined {
  const byId = new Map<EventId, Event>(events.map((e) => [e.id, e]));
  const groups = communities(truth);
  const before = truth.get(ASCRIBED_GROUPS, player)?.about ?? {};
  const about: Record<string, IdentityBelief> = { ...before };
  let changed = false;
  for (const p of fresh) {
    if (p.detail === "vague" || p.sourceEventId === undefined) continue;
    const who = byId.get(p.sourceEventId)?.actors[0] as AgentId | undefined;
    if (!who || who === player) continue;
    const belief = ascribeGroup(player, who, visibleMarks(truth, who, traits), groups, traits);
    if (!belief) continue;
    const prev = about[who];
    if (prev && prev.group === belief.group && prev.confidence >= belief.confidence) continue;
    about[who] = belief;
    changed = true;
  }
  return changed ? { about } : undefined;
}
