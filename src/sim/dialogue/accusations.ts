// Acusar y defenderse en el diálogo (dialogue §6, law §5): lo que el oyente hace cuando le dicen que
// alguien hizo algo malo. Si el acusado es un tercero, lo pesa con `weighAccusation` sobre lo que
// él ya sabía (`KNOWN_DEEDS`): cree, sopesa, duda o huele a calumnia. Si el acusado es el propio
// oyente, se defiende: confiesa, se justifica, devuelve la acusación, niega o protesta. Todo es
// puro y trabaja sobre lo que cada uno sabe, nunca sobre la verdad; el cableado lee la verdad solo
// para saber si el oyente es culpable de lo que le achacan (su propia conciencia).

import type { AgentId, Random } from "../../core/index.ts";
import {
  ACCUSATION_ACTS_AT,
  type Accusation,
  type Deed,
  type DeedKind,
  type HearerView,
  weighAccusation,
} from "../law/index.ts";

/** Creencia desde la que el oyente sopesa en serio la acusación (sin llegar a actuar). */
export const ACCUSATION_WEIGHS_AT = 0.35;
/** Creencia previa de quien no sabía nada del acusado, y de quien ya sabía de un hecho de ese tipo. */
export const ACCUSED_PRIOR_UNKNOWN = 0.1;
export const ACCUSED_PRIOR_KNOWN = 0.6;
/** Honestidad desde la que el culpable confiesa si nada lo justifica. */
export const CONFESS_HONESTY = 0.6;
/** Justificación desde la que el culpable se justifica en vez de negar. */
export const JUSTIFY_AT = 0.5;
/** Orgullo desde el que devuelve la acusación quien tiene con qué. */
export const COUNTER_PRIDE = 0.55;

/** Cómo recibe el oyente una acusación contra un tercero. */
export type HearVerdict = "believe" | "weigh" | "doubt" | "slander";

export interface HeardAccusation {
  readonly verdict: HearVerdict;
  /** 0-1: cuánto cree el oyente que el acusado lo hizo después de oír. */
  readonly belief: number;
  readonly suspectsLiar: boolean;
  /** Con hecho citado y creencia suficiente, el hecho queda como contado (`told`) en el oyente. */
  readonly learned: Deed | null;
}

/** Pesa una acusación contra un tercero: `cited` es el hecho que quien acusa conoce de verdad. */
export function hearAccusation(a: Accusation, h: HearerView, cited: Deed | null): HeardAccusation {
  const prior = h.ownKnowledge?.kind === a.kind ? ACCUSED_PRIOR_KNOWN : ACCUSED_PRIOR_UNKNOWN;
  const { belief, suspectsLiar } = weighAccusation(a, h, prior);
  const verdict: HearVerdict =
    belief >= ACCUSATION_ACTS_AT
      ? "believe"
      : belief >= ACCUSATION_WEIGHS_AT
        ? "weigh"
        : suspectsLiar
          ? "slander"
          : "doubt";
  const learned =
    cited !== null && belief >= ACCUSATION_WEIGHS_AT
      ? { ...cited, by: a.accused, via: "told" as const }
      : null;
  return { verdict, belief, suspectsLiar, learned };
}

/** Qué hace el acusado ante lo que le dicen. */
export type Defense = "confess" | "justify" | "counter" | "deny" | "protest";

export interface DefenseInput {
  /** El oyente sabe que lo hizo (su propia conciencia, no la creencia de nadie). */
  readonly guilty: boolean;
  /** 0-1: honestidad del acusado (voluntad). */
  readonly honesty: number;
  /** 0-1: cuánto cree que lo justifica (hambre, agravio, orden). */
  readonly justification: number;
  /** 0-1: orgullo (reactividad, cara). */
  readonly pride: number;
  /** El acusado sabe de algo malo de quien acusa con qué devolverle. */
  readonly counterable: boolean;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Cómo se defiende el acusado. El culpable honesto y sin excusa confiesa; con excusa se justifica;
 * el orgulloso con munición devuelve la acusación; si no, niega. El inocente protesta (o devuelve
 * el golpe si es orgulloso y tiene con qué). Con 2 sorteos fijos.
 */
export function decideDefense(i: DefenseInput, rng: Random): Defense {
  const roll = rng.float();
  const spite = rng.float();
  const pride = clamp01(i.pride);
  const hits = i.counterable && pride >= COUNTER_PRIDE && spite < pride;
  if (!i.guilty) return hits ? "counter" : "protest";
  if (clamp01(i.justification) >= JUSTIFY_AT) return "justify";
  if (clamp01(i.honesty) >= CONFESS_HONESTY && roll < clamp01(i.honesty)) return "confess";
  return hits ? "counter" : "deny";
}

/** Lo que el oyente pone para contestar a una acusación: como oyente de un tercero o como acusado. */
export type AccuseInput =
  | {
      readonly as: "hearer";
      readonly view: HearerView;
      /** El hecho que quien acusa conoce del acusado, si lo conoce (el que cita). */
      readonly cited: Deed | null;
      /** Quién es el acusado (un tercero que el oyente conoce). */
      readonly accused: AgentId;
    }
  | { readonly as: "accused"; readonly defense: DefenseInput };

/** Lo que dejó la acusación, para el evento y la relación. */
export interface AccuseOutcome {
  readonly accused: AgentId | "listener";
  readonly kind: DeedKind;
  /** Quien acusa no conoce ningún hecho así (huella de acusar sin respaldo). */
  readonly unbacked: boolean;
  readonly heard?: HeardAccusation;
  readonly defense?: Defense;
}

/** Cuánto sube o baja la confianza en quien acusó, según cómo cayó la acusación (sin calibrar). */
export const ACCUSE_TRUST_BELIEVED = 0.05;
export const ACCUSE_TRUST_SLANDER = -0.1;
export const ACCUSE_TRUST_UNBACKED = -0.05;
/** Lo que dejan en quien acusa las defensas del acusado (rencor y confianza, sin calibrar). */
export const DEFENSE_DELTAS: Readonly<
  Record<Defense, { readonly resentment: number; readonly trust: number }>
> = {
  confess: { resentment: 0, trust: 0.05 },
  justify: { resentment: 0.05, trust: -0.02 },
  counter: { resentment: 0.15, trust: -0.1 },
  deny: { resentment: 0.08, trust: -0.05 },
  protest: { resentment: 0.15, trust: -0.1 },
};
