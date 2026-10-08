// Identidad religiosa por persona (religion §1, §7, Fase 2). La religión de la aldea es un parecido
// entre muchos: cada uno cree, cumple, se siente parte y muestra en grados distintos, y las cuatro
// cosas se pueden separar (se cumple sin creer, se cree sin cumplir, se finge). La sanción creída
// de un tabú entra en la utilidad de quien lo rompe pesada por su fe, nunca por la verdad: que el
// castigo exista de verdad lo decide el Cielo (heaven-karma), no esta tabla. Romper lo que se cree
// prohibido deja culpa (npc-psychology §11) y cumplir ritos consuela, sin tocar `WorldTruth`.
// Todo es puro; el cableado a la utilidad y al cuerpo va aparte.

import type { AgentId, EventId, Random, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { PracticeDef } from "./religion.ts";
import type { CommunityReligion } from "./seed.ts";
import { tabooOnGood } from "./seed.ts";

export interface Affiliation {
  readonly religion: string;
  /** 0-1: cuánto cree sus afirmaciones centrales. */
  readonly belief: number;
  /** 0-1: cuánto cumple. */
  readonly practice: number;
  /** 0-1: cuánto se siente parte (npc-psychology §13). */
  readonly belonging: number;
  /** 0-1: cuánto muestra (puede fingir; por fuera y por dentro). */
  readonly outward: number;
  readonly learnedFrom: readonly AgentId[];
  readonly since: Tick;
  readonly originEventId: EventId;
}

export interface ReligiousIdentity {
  readonly affiliations: readonly Affiliation[];
  /** Lo que vio y no cuadra (ids de observación, discovery §6). */
  readonly doubts: readonly string[];
}

export const RELIGIOUS_IDENTITY = table<ReligiousIdentity>("religion.identity");

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Desvío de la creencia y de la pertenencia de cada uno alrededor de la media de la comunidad. */
export const BELIEF_SPREAD = 0.2;
export const BELONGING_SPREAD = 0.1;
/** Cuánto se parece lo que cumple a lo que cree y a lo que pertenece (el resto es costumbre y azar). */
export const PRACTICE_FROM_BELIEF = 0.4;
export const PRACTICE_FROM_BELONGING = 0.4;
export const PRACTICE_SPREAD = 0.1;
/** Lo que muestra: lo que cumple, más la presión de pertenecer; fingir es mostrar más que creer. */
export const OUTWARD_PRESSURE = 0.5;

export interface SeedAffiliationInput {
  readonly religion: CommunityReligion;
  /** Quienes lo criaron en la fe (la transmisión; la creencia sigue a la de ellos). */
  readonly parents: readonly Affiliation[];
  readonly learnedFrom: readonly AgentId[];
  readonly since: Tick;
  readonly originEventId: EventId;
}

/**
 * La afiliación de alguien a la religión de su comunidad. La creencia parte de la media de la
 * comunidad (o del promedio de sus padres si los hay, que pesan lo mismo) con un desvío; cumplir
 * sigue a creer y a pertenecer; mostrar sigue a cumplir y a la presión de pertenecer, así que
 * quien pertenece sin creer finge. Consume siempre tres sorteos de `rng`.
 */
export function seedAffiliation(input: SeedAffiliationInput, rng: Random): Affiliation {
  const a = input.religion.adherence;
  const n1 = rng.normal();
  const n2 = rng.normal();
  const n3 = rng.normal();
  const mean = (f: (x: Affiliation) => number, base: number) =>
    input.parents.length === 0
      ? base
      : (base + input.parents.reduce((s, p) => s + f(p), 0) / input.parents.length) / 2;
  const belief = clamp01(mean((p) => p.belief, a.belief) + BELIEF_SPREAD * n1);
  const belonging = clamp01(mean((p) => p.belonging, a.belonging) + BELONGING_SPREAD * n2);
  const base = 1 - PRACTICE_FROM_BELIEF - PRACTICE_FROM_BELONGING;
  const practice = clamp01(
    PRACTICE_FROM_BELIEF * belief +
      PRACTICE_FROM_BELONGING * belonging +
      base * 0.5 +
      PRACTICE_SPREAD * n3,
  );
  const outward = clamp01(practice + OUTWARD_PRESSURE * Math.max(0, belonging - belief) * 0.5);
  return {
    religion: input.religion.religion,
    belief: round(belief),
    practice: round(practice),
    belonging: round(belonging),
    outward: round(outward),
    learnedFrom: input.learnedFrom,
    since: input.since,
    originEventId: input.originEventId,
  };
}

/** La afiliación de una persona a una religión, si la tiene. */
export function affiliationOf(
  identity: ReligiousIdentity | undefined,
  religion: string,
): Affiliation | undefined {
  return identity?.affiliations.find((a) => a.religion === religion);
}

/** Lo que pesa romper un bien tabú en la utilidad de quien lo piensa (todo en 0-1). */
export interface SanctionWeight {
  /** El tabú que alcanza al bien, si lo hay. */
  readonly taboo?: PracticeDef;
  /** Miedo al castigo creído: gravedad de la sanción por cuánto la cree. */
  readonly fear: number;
  /** Vergüenza ante los demás: gravedad por cuánto pertenece, si lo vieran. */
  readonly shame: number;
  /** El peso total que resta a la utilidad de la acción. */
  readonly penalty: number;
}

export const NO_SANCTION: SanctionWeight = { fear: 0, shame: 0, penalty: 0 };
/** El miedo al castigo y la vergüenza ante la comunidad suman con estos pesos. */
export const FEAR_WEIGHT = 0.6;
export const SHAME_WEIGHT = 0.4;

/**
 * La sanción creída de tomar `good` para quien tiene `identity` (religion §7). Solo cuenta lo que
 * cree y a qué comunidad siente que pertenece: un escéptico sin pertenencia no pesa nada, un
 * creyente pesa la gravedad entera. Sin identidad o sin tabú sobre el bien, nada.
 */
export function sanctionWeight(
  identity: ReligiousIdentity | undefined,
  community: CommunityReligion | undefined,
  good: string,
): SanctionWeight {
  if (!community) return NO_SANCTION;
  const taboo = tabooOnGood(community, good);
  const aff = affiliationOf(identity, community.religion);
  if (!taboo || !aff || taboo.sanction <= 0) return NO_SANCTION;
  const fear = clamp01(taboo.sanction * aff.belief);
  const shame = clamp01(taboo.sanction * aff.belonging);
  return {
    taboo,
    fear: round(fear),
    shame: round(shame),
    penalty: round(FEAR_WEIGHT * fear + SHAME_WEIGHT * shame),
  };
}

/** Intensidad (0-1) de la culpa tras romper un tabú: lo que pesaba, más si fue visto y lo lamenta. */
export const GUILT_SEEN = 0.25;

/**
 * La culpa de quien rompió el tabú (npc-psychology §11): el peso que le daba, un poco más si
 * lo vieron (la vergüenza se confirma). Es la intensidad de un estímulo formativo `guilt`.
 */
export function guiltAfter(weight: SanctionWeight, seen: boolean): number {
  if (weight.penalty <= 0) return 0;
  return round(clamp01(weight.penalty * (1 + (seen ? GUILT_SEEN : 0))));
}

/** Cuánto consuela un rito, una ofrenda o una fiesta a quien lo cumple (0-1). */
export const COMFORT_BY_KIND: Readonly<Record<PracticeDef["kind"], number>> = {
  offering: 0.3,
  festival: 0.5,
  taboo: 0.1,
  rite: 0.7,
  divination: 0.2,
};
/** Parte del consuelo que llega por la compañía aunque no se crea (la «social»), contra la de la fe. */
export const COMFORT_SOCIAL_SHARE = 0.4;

/**
 * El consuelo de cumplir una práctica: la parte social (acompañar y ser acompañado) llega a todo el
 * que pertenece, crea o no; la parte de la fe, solo al que cree (religion §3, §14). Es el alivio
 * del dolor (duelo, miedo) que el cuerpo y la mente reciben; no premia la fe por sí misma.
 */
export function comfortOf(practice: PracticeDef, aff: Affiliation | undefined): number {
  if (!aff) return 0;
  const base = COMFORT_BY_KIND[practice.kind];
  const social = COMFORT_SOCIAL_SHARE * aff.belonging;
  const faith = (1 - COMFORT_SOCIAL_SHARE) * aff.belief;
  return round(clamp01(base * (social + faith)));
}
