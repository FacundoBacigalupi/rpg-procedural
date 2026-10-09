// Quién cree el personaje que es cada uno (culture §8): de lo que ve (marcas mostradas de quien
// actúa a su vista) arma una `IdentityBelief` por persona con `ascribeGroup`. Lo que se lee es lo
// mostrado, no la variante interna: una marca imitada engaña. Solo cuentan los rasgos que se ven
// o se oyen; la creencia se guarda en la entidad del personaje y se refina con cada marca nueva.

import type { AgentId, Event, EventId } from "../../core/index.ts";
import {
  ascribeGroup,
  COMMUNITY_CULTURE,
  type CommunityCulture,
  groupBias,
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

/**
 * El grupo al que se siente de pertenecer `who`: su identidad propia si la tiene guardada y, si
 * no, la comunidad cuya prevalencia mejor cuadra con lo que sostiene (donde se crió). Sin
 * comunidades ni rasgos, ninguno.
 */
export function ownGroup(truth: ReadonlyWorldTruth, who: AgentId): string | undefined {
  const culture = truth.get(PERSON_CULTURE, who);
  const own = culture?.identity
    .filter((b) => b.about === who)
    .sort((a, b) => b.confidence - a.confidence)[0];
  if (own) return own.group;
  const held = Object.entries(culture?.holdings ?? {});
  if (held.length === 0) return undefined;
  let best: { group: string; score: number } | undefined;
  for (const g of communities(truth)) {
    let score = 0;
    for (const [trait, h] of held) score += g.prevalence[trait]?.variants[h.variant] ?? 0;
    if (!best || score > best.score || (score === best.score && g.culture < best.group)) {
      best = { group: g.culture, score };
    }
  }
  return best?.group;
}

/**
 * El sesgo (-1..1) de `holder` hacia `about` por el grupo que cree que es (culture §8): lo que
 * pesa en su confianza y en su utilidad. Solo cuenta lo adscripto (lo que vio), nunca el grupo
 * verdadero del otro; sin creencia o sin grupo propio no hay sesgo. `stereotype` es lo que cree
 * del grupo ajeno.
 */
export function groupBiasToward(
  truth: ReadonlyWorldTruth,
  holder: AgentId,
  about: AgentId,
  stereotype = 0,
): number {
  const belief = truth.get(ASCRIBED_GROUPS, holder)?.about[about];
  const mine = ownGroup(truth, holder);
  if (!belief || mine === undefined) return 0;
  return groupBias(mine, belief, stereotype);
}
