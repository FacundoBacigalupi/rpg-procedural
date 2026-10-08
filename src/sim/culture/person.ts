// La cultura en cada persona (culture §1, §4, §8, Fase 2). La comunidad solo tiene prevalencias;
// cada uno sigue una variante por rasgo, con qué firmeza, qué muestra por fuera, de quién la
// aprendió y por qué vía. Se transmite sobre todo en los períodos sensibles (vertical), se copia
// con sesgos (conformidad, prestigio, resultado, contenido) y se impone por fuera sin cambiar lo de
// adentro. La identidad de grupo es una creencia (propia o ajena) con base en marcas; el sesgo de
// grupo y las sanciones informales salen de lo que el observador cree, nunca de la verdad.
// Todo es puro; el cableado a `create`/pre-corrida y a la utilidad va aparte.

import type { AgentId, EventId, Random, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { CommunityCulture } from "./seed.ts";
import type { TraitDef, TraitDomain } from "./trait.ts";

export const TRANSMISSION_MODES = ["born", "vertical", "oblique", "horizontal", "imposed"] as const;
export type TransmissionMode = (typeof TRANSMISSION_MODES)[number];

export interface TraitHolding {
  /** La respuesta que la persona sostiene por dentro. */
  readonly variant: string;
  /** Lo que muestra (igual a `variant` salvo imposición o disimulo). */
  readonly shown: string;
  /** 0-1: qué tan firme es. */
  readonly strength: number;
  readonly learnedFrom: readonly AgentId[];
  readonly mode: TransmissionMode;
  readonly since: Tick;
}

export type IdentityBasis =
  | "birth"
  | "upbringing"
  | "markers"
  | "speech"
  | "genealogy"
  | "claim"
  | "rumor";

/** Una creencia más (information §1): quién cree que `about` es de `group`. */
export interface IdentityBelief {
  readonly holder: AgentId;
  readonly about: AgentId;
  readonly group: string;
  readonly confidence: number;
  readonly basis: readonly IdentityBasis[];
}

export interface PersonCulture {
  readonly holdings: Readonly<Record<string, TraitHolding>>;
  /** Lo que cree de sí y de otros (la identidad propia y la adscripta pueden no coincidir). */
  readonly identity: readonly IdentityBelief[];
  readonly originEventId: EventId;
}

export const PERSON_CULTURE = table<PersonCulture>("culture.person");

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

// ---- Períodos sensibles ----------------------------------------------------------------------

/** Ventana de edad (años) en que cada dominio se fija más; fuera de ella se aprende con menos peso. */
export const SENSITIVE_WINDOW: Readonly<Record<TraitDomain, readonly [number, number]>> = {
  food: [0, 6],
  dress: [4, 16],
  housing: [4, 16],
  kinship: [2, 12],
  rites_of_passage: [8, 18],
  funeral: [6, 16],
  festival: [2, 14],
  norms: [4, 16],
  values: [4, 18],
  etiquette: [3, 14],
  humor: [8, 20],
  aesthetics: [10, 22],
  practical: [8, 30],
  gender_age: [4, 16],
  property: [6, 18],
  cosmology: [4, 16],
  calendar: [6, 20],
};
/** Peso de aprender fuera de la ventana sensible (en ella pesa 1). */
export const OFF_WINDOW_WEIGHT = 0.3;

export function sensitivity(domain: TraitDomain, ageYears: number): number {
  const [from, to] = SENSITIVE_WINDOW[domain];
  return ageYears >= from && ageYears <= to ? 1 : OFF_WINDOW_WEIGHT;
}

// ---- Nacer en una cultura ----------------------------------------------------------------------

/** Probabilidad base de que un hijo siga a sus padres en un rasgo (sube con la tenacidad). */
export const VERTICAL_BASE = 0.7;
export const VERTICAL_STICKINESS = 0.25;

export interface SeedPersonInput {
  readonly community: CommunityCulture;
  readonly traits: readonly TraitDef[];
  /** Quienes lo criaron (su cultura se transmite en vertical). */
  readonly parents: readonly { readonly id: AgentId; readonly culture: PersonCulture }[];
  readonly since: Tick;
  readonly originEventId: EventId;
}

function sampleCommunity(prevalence: Readonly<Record<string, number>>, u: number): string {
  const entries = Object.entries(prevalence).sort(([a], [b]) => (a < b ? -1 : 1));
  let acc = 0;
  for (const [v, f] of entries) {
    acc += f;
    if (u < acc) return v;
  }
  return (entries[entries.length - 1] as [string, number])[0];
}

/**
 * La cultura de alguien que nace en la comunidad. Por cada rasgo (en orden de id) consume tres
 * sorteos siempre: si copia a los padres (según la tenacidad del rasgo), a cuál de ellos, y la
 * firmeza. Sin padres, o si no los copia, sale de la prevalencia de la comunidad.
 */
export function seedPersonCulture(input: SeedPersonInput, rng: Random): PersonCulture {
  const holdings: Record<string, TraitHolding> = {};
  const ids = Object.keys(input.community.prevalence).sort();
  for (const trait of ids) {
    const prev = input.community.prevalence[trait];
    if (!prev) continue;
    const def = input.traits.find((t) => t.id === trait);
    const stickiness = def?.stickiness ?? 0.5;
    const uCopy = rng.float();
    const uWho = rng.float();
    const uStr = rng.float();
    const modelled = input.parents.filter((p) => p.culture.holdings[trait] !== undefined);
    let variant: string;
    let mode: TransmissionMode = "born";
    let learnedFrom: AgentId[] = [];
    const fidelity = clamp01(VERTICAL_BASE + VERTICAL_STICKINESS * (stickiness - 0.5) * 2);
    if (modelled.length > 0 && uCopy < fidelity) {
      const p = modelled[Math.min(modelled.length - 1, Math.floor(uWho * modelled.length))];
      variant = p?.culture.holdings[trait]?.variant ?? sampleCommunity(prev.variants, uWho);
      mode = "vertical";
      learnedFrom = p ? [p.id] : [];
    } else {
      variant = sampleCommunity(prev.variants, uWho);
    }
    holdings[trait] = {
      variant,
      shown: variant,
      strength: round(clamp01(0.55 + 0.25 * stickiness + 0.3 * (uStr - 0.5))),
      learnedFrom,
      mode,
      since: input.since,
    };
  }
  return { holdings, identity: [], originEventId: input.originEventId };
}

// ---- Copiar con sesgos ---------------------------------------------------------------------------

/** Lo que empuja a copiar una variante a alguien (§4: sesgos de copia). Todo 0-1. */
export interface CopyBias {
  /** Qué fracción de la comunidad ya la sigue. */
  readonly conformity: number;
  /** Qué tan admirado es el modelo. */
  readonly prestige: number;
  /** Cuánto se vio que da resultado. */
  readonly success: number;
  /** Qué tan fácil de recordar o emocionante es. */
  readonly content: number;
}

export const COPY_WEIGHTS = { conformity: 0.4, prestige: 0.3, success: 0.2, content: 0.1 } as const;

export function copyPull(bias: CopyBias): number {
  return round(
    clamp01(
      COPY_WEIGHTS.conformity * bias.conformity +
        COPY_WEIGHTS.prestige * bias.prestige +
        COPY_WEIGHTS.success * bias.success +
        COPY_WEIGHTS.content * bias.content,
    ),
  );
}

export interface AcquireInput {
  readonly trait: TraitDef;
  readonly candidate: string;
  readonly mode: Exclude<TransmissionMode, "born">;
  readonly source: AgentId;
  readonly bias: CopyBias;
  /** 0-1: plasticidad de la etapa de vida (npc-psychology §10). */
  readonly plasticity: number;
  readonly ageYears: number;
  readonly now: Tick;
}

/** Probabilidad de que un modelo cambie lo que alguien sostiene (o muestra). */
export function acquireChance(current: TraitHolding | undefined, input: AcquireInput): number {
  if (current?.variant === input.candidate && input.mode !== "imposed") return 0;
  const hold = current ? 1 - 0.7 * current.strength : 1;
  const stick = 1 - 0.8 * input.trait.stickiness;
  const modeWeight = input.mode === "vertical" ? 1 : input.mode === "oblique" ? 0.7 : 0.5;
  return round(
    clamp01(
      copyPull(input.bias) *
        input.plasticity *
        sensitivity(input.trait.domain, input.ageYears) *
        hold *
        stick *
        modeWeight,
    ),
  );
}

/**
 * Una oportunidad de aprender o copiar. Si prende, sin holding se adopta de golpe; con holding
 * previo, la variante cambia y la firmeza empieza baja. La imposición cambia solo lo que se
 * muestra: por dentro sigue lo de antes (obediencia por fuera, resistencia por dentro).
 * Consume un sorteo siempre.
 */
export function acquire(
  current: TraitHolding | undefined,
  input: AcquireInput,
  rng: Random,
): TraitHolding | undefined {
  const hit = rng.float() < acquireChance(current, input);
  if (!hit) return current;
  if (input.mode === "imposed" && current) {
    return {
      ...current,
      shown: input.candidate,
      learnedFrom: [...current.learnedFrom, input.source].slice(-4),
    };
  }
  return {
    variant: input.candidate,
    shown: input.candidate,
    strength: round(0.3 + 0.2 * input.plasticity),
    learnedFrom: [input.source],
    mode: input.mode,
    since: input.now,
  };
}

// ---- Identidad como creencia -------------------------------------------------------------------

/** Lo que alguien cree ser: criado en la comunidad, con firmeza alta. */
export function ownIdentity(self: AgentId, group: string, bornIn: boolean): IdentityBelief {
  return {
    holder: self,
    about: self,
    group,
    confidence: bornIn ? 0.95 : 0.7,
    basis: bornIn ? ["birth", "upbringing"] : ["upbringing", "claim"],
  };
}

/**
 * Qué grupo cree un observador que es alguien, mirando solo las marcas que vio (rasgos mostrados,
 * ponderados por saliencia). Compara con cada comunidad que el observador conoce y devuelve la que
 * mejor cuadra; la confianza baja si vio pocas marcas. Una marca imitada (`shown` distinto de la
 * variante interna) engaña por diseño: se lee lo mostrado.
 */
export function ascribeGroup(
  observer: AgentId,
  about: AgentId,
  seenShown: Readonly<Record<string, string>>,
  groups: readonly CommunityCulture[],
  traits: readonly TraitDef[],
): IdentityBelief | undefined {
  const seenIds = Object.keys(seenShown).sort();
  let best: { group: string; score: number } | undefined;
  let seenSalience = 0;
  for (const t of seenIds) {
    seenSalience += traits.find((d) => d.id === t)?.salience ?? 0;
  }
  for (const g of groups) {
    let match = 0;
    let weight = 0;
    for (const t of seenIds) {
      const prev = g.prevalence[t];
      const def = traits.find((d) => d.id === t);
      if (!prev || !def) continue;
      weight += def.salience;
      match += def.salience * (prev.variants[seenShown[t] as string] ?? 0);
    }
    if (weight === 0) continue;
    const score = match / weight;
    if (!best || score > best.score || (score === best.score && g.culture < best.group)) {
      best = { group: g.culture, score };
    }
  }
  if (!best) return undefined;
  const coverage = clamp01(seenSalience / 1.5);
  return {
    holder: observer,
    about,
    group: best.group,
    confidence: round(clamp01(best.score * (0.4 + 0.6 * coverage))),
    basis: ["markers"],
  };
}

/** Distancia entre lo que alguien cree ser y lo que los demás creen que es (0 = coinciden). */
export function identityGap(own: IdentityBelief, ascribed: IdentityBelief): number {
  if (own.group === ascribed.group) return round(Math.abs(own.confidence - ascribed.confidence));
  return round(Math.min(own.confidence, ascribed.confidence));
}

// ---- Sesgo de grupo ----------------------------------------------------------------------------

export const IN_GROUP_BONUS = 0.2;
export const OUT_GROUP_PENALTY = 0.25;
export const STEREOTYPE_WEIGHT = 0.5;

/**
 * Sesgo (-1..1) que entra en la confianza o la utilidad de `holderGroup` hacia alguien, según lo
 * que cree de a qué grupo pertenece. Sin creencia no hay sesgo. `stereotype` (-1..1) es lo que el
 * observador cree del grupo ajeno: se transmite y se deforma como un rumor (information).
 */
export function groupBias(
  holderGroup: string,
  belief: IdentityBelief | undefined,
  stereotype = 0,
): number {
  if (!belief) return 0;
  const base =
    belief.group === holderGroup
      ? IN_GROUP_BONUS
      : -OUT_GROUP_PENALTY + STEREOTYPE_WEIGHT * stereotype;
  return round(Math.min(1, Math.max(-1, base * belief.confidence)));
}

// ---- Sanciones informales ----------------------------------------------------------------------

export const INFORMAL_KINDS = ["gossip", "mockery", "shame", "exclusion"] as const;
export type InformalKind = (typeof INFORMAL_KINDS)[number];

export interface InformalSanction {
  readonly kind?: InformalKind;
  /** 0-1: cuánto castiga este observador. */
  readonly weight: number;
  /** Cambio de reputación (menor o igual a 0) que deja en lo que los demás creen del actor. */
  readonly reputation: number;
}

export const NO_INFORMAL: InformalSanction = { weight: 0, reputation: 0 };
/** Peso mínimo para que haya una reacción. */
export const SANCTION_FLOOR = 0.05;

export interface InformalInput {
  /** 0-1: gravedad de la falta para la norma de la comunidad. */
  readonly severity: number;
  /** 0-1: cuánto cree el observador que el actor la cometió (no la verdad). */
  readonly believed: number;
  /** El observador sostiene la norma de verdad (si no, no castiga). */
  readonly observerHolds: boolean;
  readonly observerStrength: number;
  /** 0-1: cuánto se siente parte de la comunidad que vigila. */
  readonly belonging: number;
  /** Si el observador cree que el actor es de afuera, perdona más (no conoce la costumbre). */
  readonly actorIsOutsider: boolean;
}

/**
 * Lo que hace la comunidad ante una falta que cree vista (§4): el chisme para lo leve, la burla,
 * la vergüenza y, para lo grave, la exclusión del mercado o del matrimonio. Pesa lo que el
 * observador cree, lo firme que sostiene la norma y cuánto pertenece; al de afuera se le perdona.
 */
export function informalSanction(input: InformalInput): InformalSanction {
  if (!input.observerHolds) return NO_INFORMAL;
  const outsider = input.actorIsOutsider ? 0.5 : 1;
  const weight = round(
    clamp01(
      input.severity *
        input.believed *
        (0.5 + 0.5 * input.observerStrength) *
        (0.6 + 0.4 * input.belonging) *
        outsider,
    ),
  );
  if (weight < SANCTION_FLOOR) return NO_INFORMAL;
  const kind: InformalKind =
    weight < 0.15 ? "gossip" : weight < 0.3 ? "mockery" : weight < 0.55 ? "shame" : "exclusion";
  return { kind, weight, reputation: round(-weight * 0.5) };
}
