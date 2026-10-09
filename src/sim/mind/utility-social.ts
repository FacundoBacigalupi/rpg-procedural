// Candidatas sociales de la utilidad (npc-psychology §6, §7): ayudar, dar, evitar y vengarse de
// alguien, con los insumos que le tocan a cada una. Las dimensiones de la relación (afecto,
// miedo, resentimiento, gratitud, familiaridad), los vínculos (parentesco) y lo que el NPC CREE
// del otro (su necesidad, qué tan peligroso es y cuánta fe le tiene a esa creencia) deciden qué
// contribuye cada acción a los valores (`family`, `justice`, `safety`, `status`, `wealth`) y las
// necesidades (`safety`, `social`). Puro: no mira la verdad, solo lo que recibe.

import { clampDim, type Vector } from "../relations/index.ts";
import type { Candidate } from "./utility.ts";

/**
 * Los verbos del catálogo (`content/actions`) que cumple cada candidata social: ayudar es curar,
 * vengarse es golpear, evitar es irse (`move`, el plan elige adónde) y dar es dar.
 */
export const SOCIAL_VERBS = {
  help: "tend",
  give: "give",
  avoid: "move",
  avenge: "strike",
} as const;

/** Vínculos de sangre o casa que pesan en la familia como valor. */
const KIN_WEIGHT: Readonly<Record<string, number>> = {
  parent: 1,
  child: 1,
  spouse: 0.9,
  sibling: 0.8,
  grandparent: 0.6,
  grandchild: 0.6,
  housemate: 0.3,
};

/** Lo que el NPC cree del otro (no la verdad). */
export interface OtherBelief {
  /** 0-1: cuánta ayuda cree que necesita. */
  readonly need: number;
  /** 0-1: qué tan peligroso cree que es (fuerza, armas, fama). */
  readonly threat: number;
  /** 0-1: cuánta fe le tiene a estas creencias (poca confianza = más incertidumbre en la chance). */
  readonly confidence: number;
}

/** Lo que el NPC está en condiciones de dar. */
export interface Means {
  /** 0-1: cuánto le sobra para dar (comida, tiempo, monedas). */
  readonly surplus: number;
}

export interface SocialInput {
  readonly target: string;
  readonly dims: Vector;
  readonly bonds: readonly string[];
  readonly belief: OtherBelief;
  readonly means: Means;
}

/** Qué tan pariente es: el vínculo más fuerte que tengan. */
export function kinWeight(bonds: readonly string[]): number {
  let w = 0;
  for (const b of bonds) w = Math.max(w, KIN_WEIGHT[b] ?? 0);
  return w;
}

const pos = (x: number) => (x > 0 ? x : 0);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const r = (x: number) => Math.round(x * 1e6) / 1e6;

/** Cuánto lo quiere de cerca: afecto, gratitud y parentesco. */
export function closeness(dims: Vector, bonds: readonly string[]): number {
  const affection = pos(clampDim("affection", dims.affection));
  return clamp01(0.5 * kinWeight(bonds) + 0.35 * affection + 0.15 * dims.gratitude);
}

/** Ayudar: el parentesco y el cariño empujan la familia; la necesidad creída, la justicia. */
export function helpCandidate(i: SocialInput): Candidate | undefined {
  const { dims, belief } = i;
  if (belief.need < 0.1) return undefined;
  const near = closeness(dims, i.bonds);
  const grudge = dims.resentment;
  return {
    id: `help:${i.target}`,
    verb: SOCIAL_VERBS.help,
    target: i.target,
    contributes: {
      family: r(near * belief.need),
      justice: r(0.4 * belief.need),
      social: r(0.2 + 0.3 * pos(dims.affection)),
    },
    chance: r(0.5 + 0.4 * belief.confidence),
    loss: 0.05,
    mood: r(-0.25 * grudge * (1 - near)),
  };
}

/** Dar: como ayudar, pero cuesta riqueza y compra estatus, gratitud y paz. */
export function giveCandidate(i: SocialInput): Candidate | undefined {
  const { dims, belief, means } = i;
  if (belief.need < 0.1 || means.surplus <= 0) return undefined;
  const near = closeness(dims, i.bonds);
  return {
    id: `give:${i.target}`,
    verb: SOCIAL_VERBS.give,
    target: i.target,
    contributes: {
      family: r(near * belief.need),
      justice: r(0.3 * belief.need),
      status: r(0.15 + 0.1 * means.surplus),
      wealth: r(-0.6 * (1 - means.surplus)),
      social: r(0.15 + 0.3 * pos(dims.affection)),
    },
    chance: 0.95,
    loss: r(0.1 * (1 - means.surplus)),
    mood: r(-0.2 * dims.resentment * (1 - near)),
  };
}

/** Evitar: miedo, rencor y celos alejan; el cariño y la familiaridad lo hacen costoso. */
export function avoidCandidate(i: SocialInput): Candidate | undefined {
  const { dims, belief } = i;
  const dread = clamp01(0.8 * dims.fear + 0.3 * dims.resentment + 0.2 * dims.jealousy);
  if (dread < 0.1) return undefined;
  return {
    id: `avoid:${i.target}`,
    verb: SOCIAL_VERBS.avoid,
    target: i.target,
    contributes: {
      safety: r(dread * (0.5 + 0.5 * belief.threat)),
      social: r(-(0.3 * dims.familiarity + 0.5 * pos(dims.affection))),
      family: r(-0.5 * kinWeight(i.bonds)),
    },
    chance: 0.9,
    mood: r(-0.1 * pos(dims.affection)),
  };
}

/**
 * Vengarse: el resentimiento alimenta la justicia; lo que se cree del otro (lo peligroso que es)
 * baja la chance y sube el riesgo; el cariño y la sangre lo frenan.
 */
export function avengeCandidate(i: SocialInput): Candidate | undefined {
  const { dims, belief } = i;
  if (dims.resentment < 0.25) return undefined;
  const near = closeness(dims, i.bonds);
  const doubt = 1 - belief.confidence;
  return {
    id: `avenge:${i.target}`,
    verb: SOCIAL_VERBS.avenge,
    target: i.target,
    contributes: {
      justice: r(0.9 * dims.resentment),
      power: r(0.2 * dims.resentment),
      safety: r(-0.2 * belief.threat),
    },
    chance: r(clamp01(1 - 0.7 * belief.threat - 0.15 * doubt)),
    loss: r(0.4 + 0.4 * belief.threat),
    risk: r(clamp01(belief.threat + 0.3 * doubt)),
    mood: r(-0.6 * near),
  };
}

/** Todas las candidatas sociales que tienen sentido hacia alguien, en un orden fijo. */
export function socialCandidates(i: SocialInput): Candidate[] {
  return [helpCandidate(i), giveCandidate(i), avoidCandidate(i), avengeCandidate(i)].filter(
    (c): c is Candidate => c !== undefined,
  );
}
