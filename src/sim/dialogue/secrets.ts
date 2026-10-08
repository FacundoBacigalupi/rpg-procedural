// Secretos que se escapan y sonsacar (dialogue §7, §11). Guardar un secreto es una decisión que se
// toma de nuevo cada vez que el tema aparece: la chance de soltarlo sube con la emoción, el alcohol,
// el cansancio y el dolor (menos control), con la confianza y el afecto hacia quien pregunta, con la
// sensación de que ya lo sabe, y con la técnica del que sonsaca; baja con lo que cuesta soltarlo.
// Aunque no lo diga, el secreto se filtra: un respingo, un silencio, una contradicción; quien mira
// con atención lo percibe y forma una sospecha, nunca una certeza. Todo puro: devuelve el resultado
// y quien lo cablea aplica los efectos (creencias, relación).

import type { Random } from "../../core/index.ts";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

// --- Estado de quien guarda el secreto -------------------------------------------------------

export interface KeeperState {
  /** 0-1: cuánto le cuesta (daño, vergüenza, castigo, traición) que el secreto salga. */
  readonly stakes: number;
  /** 0-1: dominio de sí (temperamento, hábito de callar). */
  readonly discipline: number;
  /** 0-1: intensidad de la emoción fuerte de ahora (ira, duelo, miedo, alegría). */
  readonly arousal: number;
  /** 0-1: alcohol o sustancias que aflojan. */
  readonly intoxication: number;
  /** 0-1: cansancio. */
  readonly fatigue: number;
  /** 0-1: dolor. */
  readonly pain: number;
  /** Confianza en quien pregunta, -1..1. */
  readonly trust: number;
  /** Afecto hacia quien pregunta, -1..1. */
  readonly affection: number;
  /** 0-1: cuánto cree que el que pregunta ya lo sabe. */
  readonly believesKnown: number;
  /** 0-1: su olfato para notar que lo están sonsacando. */
  readonly insight: number;
}

/** Control de sí (0-1) en este momento: disciplina menos todo lo que lo afloja. */
export function selfControl(k: KeeperState): number {
  return round(
    clamp01(
      k.discipline -
        0.35 * clamp01(k.arousal) -
        0.5 * clamp01(k.intoxication) -
        0.25 * clamp01(k.fatigue) -
        0.15 * clamp01(k.pain),
    ),
  );
}

// --- Técnicas de sonsacar --------------------------------------------------------------------

export type ElicitTechnique =
  /** Preguntar de frente. */
  | "direct"
  /** Hacer como que ya se sabe («ya me contaron lo de tu primo…»). */
  | "feign_knowledge"
  /** Preguntar de costado, sin nombrar el tema. */
  | "sideways"
  /** Cansar: insistir hasta que baje la guardia. */
  | "wear_down"
  /** Emborrachar o dar de beber (suma `intoxication` aparte; acá es la maniobra en sí). */
  | "intoxicate"
  /** Halagar hasta aflojar. */
  | "flatter"
  /** Ofrecer un secreto propio a cambio. */
  | "trade_secret"
  /** Una técnica u objeto que lee el alma o la verdad, donde el mundo los tenga. */
  | "read_soul";

export interface ElicitMove {
  readonly technique: ElicitTechnique;
  /** 0-1: habilidad social del que sonsaca (decirlo bien, elegir el momento). */
  readonly skill: number;
  /** `trade_secret`: 0-1 cuánto vale para el otro el secreto que se ofrece. */
  readonly offered?: number;
  /** `wear_down`: cuántas veces ya preguntó en esta charla. */
  readonly attempts?: number;
  /** `read_soul`: 0-1 poder de la técnica u objeto contra el alma del otro. */
  readonly power?: number;
  /** `flatter`: 0-1 vanidad del otro que el halago encuentra. */
  readonly vanity?: number;
}

/** Constantes sin calibrar. */
export const BASE_LEAK = 0.04;
export const CONTROL_LEAK = 0.45;
export const TRUST_LEAK = 0.15;
export const AFFECTION_LEAK = 0.1;
export const KNOWN_LEAK = 0.3;
export const STAKES_GUARD = 0.5;
export const MAX_LEAK = 0.95;
export const WEAR_PER_ATTEMPT = 0.04;

/** Lo que la técnica suma a la presión de soltar (puede ser negativo si sale torpe y se nota). */
export function techniquePressure(m: ElicitMove, k: KeeperState): number {
  const s = clamp01(m.skill);
  switch (m.technique) {
    case "direct":
      return 0;
    case "feign_knowledge":
      // Se sostiene si el otro lo cree: la creencia previa más lo bien actuado, contra su olfato.
      return 0.3 * clamp01(k.believesKnown + 0.4 * s * (1 - clamp01(k.insight)));
    case "sideways":
      return 0.12 * s;
    case "wear_down":
      return WEAR_PER_ATTEMPT * Math.max(0, m.attempts ?? 0) * (0.5 + 0.5 * s);
    case "intoxicate":
      return 0.05 * s;
    case "flatter":
      return 0.18 * clamp01(m.vanity ?? 0) * s;
    case "trade_secret":
      return 0.25 * clamp01(m.offered ?? 0) * (0.5 + 0.5 * s);
    case "read_soul":
      return 0.6 * clamp01(m.power ?? 0) * (1 - 0.5 * selfControl(k));
  }
}

/** ¿El otro nota la maniobra? Más probable cuanto más olfato y más torpe el que sonsaca. */
export function noticesProbing(m: ElicitMove, k: KeeperState): number {
  if (m.technique === "direct") return 0;
  const base = m.technique === "wear_down" ? 0.3 : m.technique === "read_soul" ? 0.15 : 0.2;
  return round(clamp01(base + 0.6 * k.insight - 0.5 * clamp01(m.skill)));
}

/** Chance (0-1) de que suelte el secreto (del todo o en parte) con esta pregunta. */
export function leakChance(k: KeeperState, m: ElicitMove): number {
  const control = selfControl(k);
  const felt =
    k.stakes * (1 - (m.technique === "trade_secret" ? 0.4 * clamp01(m.offered ?? 0) : 0));
  const raw =
    BASE_LEAK +
    CONTROL_LEAK * (1 - control) * (1 - STAKES_GUARD * clamp01(felt)) +
    TRUST_LEAK * k.trust +
    AFFECTION_LEAK * k.affection +
    KNOWN_LEAK * clamp01(k.believesKnown) * (1 - control * 0.5) +
    techniquePressure(m, k) -
    STAKES_GUARD * 0.3 * clamp01(felt) * control;
  return round(Math.min(MAX_LEAK, clamp01(raw)));
}

// --- Contestar -------------------------------------------------------------------------------

export type KeepOutcome =
  /** Lo dijo entero. */
  | "revealed"
  /** Soltó una parte, o lo dijo a medias. */
  | "partial"
  /** Esquivó con aplomo (cambió de tema, devolvió la pregunta). */
  | "evaded"
  /** Se negó a hablar del tema (cierra, pero delata que hay algo). */
  | "refused";

export type TellKind = "flinch" | "silence" | "contradiction" | "deflection" | "flush";

/** Una señal involuntaria que el secreto deja, aunque no se diga. */
export interface Tell {
  readonly kind: TellKind;
  /** 0-1: qué tan visible es. */
  readonly magnitude: number;
}

export interface KeepResult {
  readonly outcome: KeepOutcome;
  readonly chance: number;
  /** Señal involuntaria (si la hay). */
  readonly tell: Tell | null;
  /** El que guarda notó que lo sonsacaban. */
  readonly noticedProbing: boolean;
  /** Cambio de confianza en el que pregunta (negativo si lo notó, o por insistir). */
  readonly trustDelta: number;
  /** 0-1 de cautela que gana ante este tema y esta persona. */
  readonly wariness: number;
}

/** Parte del `chance` que es revelar del todo; el resto es soltar a medias. */
export const FULL_SHARE = 0.6;
export const TRUST_PER_NOTICE = -0.2;

const TELL_KINDS: readonly TellKind[] = [
  "flinch",
  "silence",
  "contradiction",
  "deflection",
  "flush",
];

/** La filtración sin decirlo: más probable con poco control y con un tema que pega fuerte. */
export function leakTell(
  k: KeeperState,
  salience: number,
  outcome: KeepOutcome,
  rng: Random,
): Tell | null {
  const control = selfControl(k);
  const base = outcome === "refused" ? 0.35 : outcome === "evaded" ? 0.2 : 0.1;
  const p = clamp01((base + 0.5 * k.stakes) * clamp01(salience) * (1.1 - control));
  // Sorteos de cantidad fija, hayan salido o no.
  const hit = rng.chance(p);
  const kind = TELL_KINDS[rng.int(0, TELL_KINDS.length - 1)] as TellKind;
  const noise = rng.float();
  if (!hit) return null;
  return { kind, magnitude: round(clamp01(0.3 + 0.4 * noise + 0.3 * (1 - control))) };
}

/**
 * Una pregunta por el secreto (dialogue §7, §11). `salience` (0-1): cuánto toca el tema lo que el
 * otro guarda (un nombre propio pega más que un rodeo). Toda la aleatoriedad pasa por `rng`.
 */
export function askSecret(
  k: KeeperState,
  m: ElicitMove,
  salience: number,
  rng: Random,
): KeepResult {
  const chance = leakChance(k, m);
  const roll = rng.float();
  const guardRoll = rng.float();
  const noticeRoll = rng.float();
  let outcome: KeepOutcome;
  if (roll < chance * FULL_SHARE) outcome = "revealed";
  else if (roll < chance) outcome = "partial";
  else outcome = guardRoll < selfControl(k) ? "evaded" : "refused";

  const tell = leakTell(k, salience, outcome, rng);
  const noticed = noticeRoll < noticesProbing(m, k);
  const insistence = (m.technique === "wear_down" ? 0.02 : 0) * Math.max(0, m.attempts ?? 0);
  const trustDelta = round((noticed ? TRUST_PER_NOTICE : 0) - insistence) || 0;
  const wariness = round(clamp01((noticed ? 0.4 : 0.1) + (outcome === "revealed" ? 0 : 0.2)));
  return { outcome, chance, tell, noticedProbing: noticed, trustDelta, wariness };
}

// --- Quien mira ------------------------------------------------------------------------------

export interface ObserverState {
  /** 0-1: percepción de señales sociales. */
  readonly perception: number;
  /** 0-1: atención puesta en el otro ahora. */
  readonly attention: number;
  /** 0-1: cuánto conoce su manera de ser (para ver lo que se sale de lo normal). */
  readonly familiarity: number;
  /** 0-1: sospecha previa sobre este tema. */
  readonly priorSuspicion: number;
}

export interface TellReading {
  readonly noticed: boolean;
  /** 0-1: sospecha formada (nunca certeza: tope `SUSPICION_CAP`). */
  readonly suspicion: number;
  /** Lo que alcanzó a ver (la señal, si la notó). */
  readonly seen: TellKind | null;
}

export const SUSPICION_CAP = 0.7;
export const TELL_READ_NOISE = 0.15;

/** Cuánto nota el observador de una señal (0-1, antes del ruido). */
export function tellVisibility(t: Tell, o: ObserverState): number {
  return round(
    clamp01(
      t.magnitude *
        (0.3 + 0.7 * o.perception) *
        (0.3 + 0.7 * o.attention) *
        (0.6 + 0.4 * o.familiarity),
    ),
  );
}

/**
 * El que mira forma una sospecha o no (perception §6). Sin señal, nada que ver: solo queda la
 * sospecha que ya traía. Con señal: noticia con ruido y sospecha acotada.
 */
export function observeTell(t: Tell | null, o: ObserverState, rng: Random): TellReading {
  const noise = rng.normal(0, TELL_READ_NOISE * (1 - 0.5 * o.perception));
  if (t === null) {
    return { noticed: false, suspicion: round(clamp01(o.priorSuspicion)), seen: null };
  }
  const vis = clamp01(tellVisibility(t, o) + noise);
  const noticed = vis >= 0.25;
  if (!noticed) return { noticed, suspicion: round(clamp01(o.priorSuspicion)), seen: null };
  const suspicion = Math.min(SUSPICION_CAP, clamp01(o.priorSuspicion + 0.6 * vis));
  return { noticed, suspicion: round(suspicion), seen: t.kind };
}
