// Persuadir (dialogue §6): un argumento no ordena nada, cambia insumos de la utilidad del oyente.
// Cuánto pega sale de cuatro cosas: la relevancia (a qué apunta contra lo que el oyente de verdad
// quiere, que puede no ser lo que el hablante cree), la credibilidad (del claim, con evidencia, y
// del hablante), la entrega (la habilidad social con su ruido) y la apertura del oyente. Si la
// utilidad cambia lo bastante para dar vuelta la decisión, cambia de opinión, y hacerlo delante de
// otros cuesta cara. Insistir de más o apelar a lo que el otro rechaza endurece su posición. La
// función es pura: devuelve el resultado y los efectos; aplicarlos es de quien la cablea.

import type { AgentId, Random } from "../../core/index.ts";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** A qué apunta el argumento (dialogue §6). Los ids son claves de contenido o de la sim. */
export type Appeal =
  | { readonly kind: "goal"; readonly goal: string }
  | { readonly kind: "value"; readonly value: string }
  | { readonly kind: "relation"; readonly with: AgentId }
  | { readonly kind: "norm"; readonly norm: string }
  | { readonly kind: "fear"; readonly danger: string }
  | { readonly kind: "face"; readonly whose: AgentId }
  | { readonly kind: "authority"; readonly source: string }
  | { readonly kind: "reciprocity"; readonly favor: string };

/** Algo que se muestra, se cita o se puede comprobar: sube la credibilidad del claim. */
export interface ArgumentEvidence {
  /** 0-1: qué tanto sostiene el claim para quien lo mira. */
  readonly strength: number;
}

export interface Argument {
  /** La proposición que se afirma (clave de la proposición; el oyente la revisa aparte). */
  readonly claim: string;
  readonly appealsTo: Appeal;
  readonly evidence?: readonly ArgumentEvidence[];
}

/**
 * Lo que de verdad pesa para el oyente, 0-1 cada cosa (negativo: lo rechaza activamente). Es la
 * verdad de su cabeza: el hablante solo tiene una creencia ruidosa de esto.
 */
export interface Stakes {
  readonly goals: Readonly<Record<string, number>>;
  readonly values: Readonly<Record<string, number>>;
  readonly relations: Readonly<Record<string, number>>;
  readonly norms: Readonly<Record<string, number>>;
  /** Cuánto teme cada peligro. */
  readonly dangers: Readonly<Record<string, number>>;
  /** Cuánto le importa la cara de cada uno (la propia incluida). */
  readonly face: Readonly<Record<string, number>>;
  /** Deferencia hacia cada fuente de autoridad. */
  readonly authority: Readonly<Record<string, number>>;
  /** Cuánto se siente en deuda por cada favor. */
  readonly debts: Readonly<Record<string, number>>;
}

export const NO_STAKES: Stakes = {
  goals: {},
  values: {},
  relations: {},
  norms: {},
  dangers: {},
  face: {},
  authority: {},
  debts: {},
};

/** Clave estable de un apelativo (para anotar qué peso subió y por cuánto). */
export function appealKey(a: Appeal): string {
  switch (a.kind) {
    case "goal":
      return `goal:${a.goal}`;
    case "value":
      return `value:${a.value}`;
    case "relation":
      return `relation:${a.with}`;
    case "norm":
      return `norm:${a.norm}`;
    case "fear":
      return `fear:${a.danger}`;
    case "face":
      return `face:${a.whose}`;
    case "authority":
      return `authority:${a.source}`;
    case "reciprocity":
      return `reciprocity:${a.favor}`;
  }
}

/** El peso (-1..1) que `stakes` le da a lo que apunta `a`; 0 si no le importa. */
export function stakeOf(a: Appeal, stakes: Stakes): number {
  const w = (t: Readonly<Record<string, number>>, k: string) => t[k] ?? 0;
  switch (a.kind) {
    case "goal":
      return w(stakes.goals, a.goal);
    case "value":
      return w(stakes.values, a.value);
    case "relation":
      return w(stakes.relations, a.with);
    case "norm":
      return w(stakes.norms, a.norm);
    case "fear":
      return w(stakes.dangers, a.danger);
    case "face":
      return w(stakes.face, a.whose);
    case "authority":
      return w(stakes.authority, a.source);
    case "reciprocity":
      return w(stakes.debts, a.favor);
  }
}

/** Relevancia (0-1) del apelativo: apelar a lo que al otro no le importa no pega. */
export function relevance(a: Appeal, stakes: Stakes): number {
  return round(clamp01(stakeOf(a, stakes)));
}

// --- Elegir el argumento ---------------------------------------------------------------------

/** Ruido con el que el hablante cree saber lo que le importa al otro (a `judgment` 0). */
export const BELIEF_NOISE = 0.25;

/**
 * El hablante elige entre apelativos posibles el que cree más relevante, con una idea ruidosa de lo
 * que le importa al oyente (`believed`): su juicio (`judgment`, 0-1) achica el ruido. Devuelve el
 * índice elegido, o -1 si no hay candidatos.
 */
export function chooseAppeal(
  candidates: readonly Appeal[],
  believed: Stakes,
  judgment: number,
  rng: Random,
): number {
  let best = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  const sd = Math.max(0.01, BELIEF_NOISE * (1 - clamp01(judgment)));
  candidates.forEach((c, i) => {
    const score = stakeOf(c, believed) + rng.normal(0, sd);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

// --- Persuadir -------------------------------------------------------------------------------

export interface PersuasionInput {
  readonly argument: Argument;
  /** Lo que de verdad importa al oyente. */
  readonly stakes: Stakes;
  /** 0-1: qué tan verosímil le suena el claim por sí solo (contra lo que ya cree). */
  readonly plausibility: number;
  readonly speaker: {
    /** Confianza del oyente en el hablante, -1..1. */
    readonly trust: number;
    /** Rango creído del hablante sobre el del oyente, -1..1. */
    readonly standing: number;
    /** 0-1: reputación de honesto o de sabio entre los que lo conocen. */
    readonly reputation: number;
    /** Habilidad social (skills): decirlo bien, elegir el argumento y notar cómo cae. */
    readonly execution: number;
    readonly judgment: number;
    readonly reading: number;
  };
  readonly listener: {
    /** 0-1: intelecto y apertura al argumento. */
    readonly intellect: number;
    /** 0-1: terquedad del temperamento. */
    readonly stubbornness: number;
    /** 0-1: enojo de ahora (el enojado no escucha). */
    readonly anger: number;
    /** 0-1: orgullo/sensibilidad a la cara. */
    readonly pride: number;
  };
  /** 0-1: cuánto lo compromete su posición dicha en público (0: no la dijo). */
  readonly stance: number;
  /** Cuántos oyen la charla además de los dos (0: privado). */
  readonly witnesses: number;
  /** 0-1: cuánto favorece hoy su utilidad la posición actual (qué hay que mover para darla vuelta). */
  readonly gap: number;
  /** Cuántas veces ya le insistió en esta charla con lo mismo. */
  readonly attempts: number;
}

export type PersuasionOutcome = "moved" | "swayed" | "unmoved" | "offended";

/** Un cambio que el argumento deja en el oyente, aunque no dé vuelta la decisión. */
export type PersuasionEffect =
  /** La confianza con la que toma el claim sube (la revisión de creencias la aplica). */
  | { readonly kind: "belief"; readonly confidence: number }
  /** El peso de lo apelado sube un rato (valor, relación, norma, deuda…). */
  | {
      readonly kind: "weight";
      readonly key: string;
      readonly boost: number;
      readonly ticks: number;
    }
  | {
      readonly kind: "emotion";
      readonly emotion: "fear" | "anger" | "shame";
      readonly delta: number;
    };

export interface Persuasion {
  readonly outcome: PersuasionOutcome;
  readonly relevance: number;
  readonly credibility: number;
  readonly delivery: number;
  readonly openness: number;
  /** Cuánto movió la utilidad a favor (0-1), antes de la cara. */
  readonly shift: number;
  /** Lo que le cuesta cambiar de opinión delante de otros (restado de `shift`). */
  readonly faceCost: number;
  /** Reacción adversa por insistir o apelar a lo que rechaza (0-1). */
  readonly backlash: number;
  /** Cambio en la confianza del oyente en el hablante. */
  readonly trustDelta: number;
  /** Cuánto se afirma su posición (suma a su `stance`; negativa si cedió). */
  readonly stanceDelta: number;
  readonly effects: readonly PersuasionEffect[];
}

/** Cuánto de la utilidad puede mover un argumento perfecto. */
export const MAX_SHIFT = 0.8;
/** Peso de la cara en lo que cuesta ceder. */
export const FACE_WEIGHT = 0.5;
/** Testigos desde los que la cara está toda en juego. */
export const FACE_WITNESSES = 3;
/** Cuánto alivia el costo de la cara que el argumento ofrezca la salida (`face`). */
export const FACE_RELIEF = 0.7;
/** Movimiento mínimo para que el argumento deje algo (swayed). */
export const SWAY_MIN = 0.05;
/** Backlash desde el que se ofende. */
export const OFFEND_AT = 0.3;
/** Cuánto suma cada insistencia después de la primera. */
export const INSISTENCE_BACKLASH = 0.12;
/** Cuánto suma apelar a algo que el oyente rechaza (por unidad de rechazo). */
export const REJECTED_BACKLASH = 0.5;
export const TRUST_PER_BACKLASH = -0.3;
export const WEIGHT_BOOST = 0.5;
export const WEIGHT_TICKS = 600;
/** Ruido de la entrega a ejecución 0. */
export const DELIVERY_NOISE = 0.12;

/** Credibilidad (0-1) del hablante a los ojos del oyente: confianza, rango y reputación. */
export function speakerCredit(s: PersuasionInput["speaker"]): number {
  return round(clamp01(0.4 + 0.3 * s.trust + 0.1 * s.standing + 0.2 * s.reputation));
}

/** Credibilidad del claim: verosimilitud, subida por cada evidencia, por la del hablante. */
export function claimCredibility(
  plausibility: number,
  evidence: readonly ArgumentEvidence[],
  credit: number,
): number {
  const doubt = evidence.reduce(
    (d, e) => d * (1 - 0.6 * clamp01(e.strength)),
    1 - clamp01(plausibility),
  );
  return round(clamp01((1 - doubt) * (0.4 + 0.6 * credit)));
}

/** Apertura (0-1) del oyente: intelecto, menos terquedad, enojo y posición pública. */
export function openness(l: PersuasionInput["listener"], stance: number): number {
  return round(
    clamp01(0.65 + 0.3 * (l.intellect - 0.5) - 0.4 * l.stubbornness - 0.5 * l.anger - 0.2 * stance),
  );
}

/** El costo de cara (0-1) de ceder: posición pública, testigos y orgullo; la salida lo alivia. */
export function faceCostOf(
  stance: number,
  witnesses: number,
  pride: number,
  relief: number,
): number {
  const seen = Math.min(1, Math.max(0, witnesses) / FACE_WITNESSES);
  return round(clamp01(stance * seen * (0.4 + 0.6 * pride) * (1 - clamp01(relief))));
}

/** Qué hace el oyente con el argumento (dialogue §6); toda la aleatoriedad es el ruido de la entrega. */
export function persuade(i: PersuasionInput, rng: Random): Persuasion {
  const a = i.argument;
  const stake = stakeOf(a.appealsTo, i.stakes);
  const rel = clamp01(stake);
  const credit = speakerCredit(i.speaker);
  const cred = claimCredibility(i.plausibility, a.evidence ?? [], credit);
  const delivery = round(
    clamp01(
      0.3 +
        0.5 * i.speaker.execution +
        0.2 * i.speaker.judgment +
        rng.normal(0, Math.max(0.01, DELIVERY_NOISE * (1 - i.speaker.execution))),
    ),
  );
  const open = openness(i.listener, i.stance);
  const impact = rel * cred * delivery * open;
  const shift = round(clamp01(MAX_SHIFT * impact));

  // Cara: ceder delante de otros cuesta; ofrecer la salida o hablar a solas lo alivia.
  const relief =
    a.appealsTo.kind === "face"
      ? FACE_RELIEF * rel * delivery * (0.5 + 0.5 * i.speaker.reading)
      : 0;
  const faceCost = faceCostOf(i.stance, i.witnesses, i.listener.pride, relief);

  // Reacción adversa: insistir, y apelar a lo que el otro rechaza o no siente suyo.
  const rejected = Math.max(0, -stake);
  const insistence = INSISTENCE_BACKLASH * Math.max(0, i.attempts) * (0.5 + 0.5 * i.listener.pride);
  const distrust = Math.max(0, -i.speaker.trust) * 0.1;
  const readingSaves = 1 - 0.4 * i.speaker.reading;
  const backlash = round(
    clamp01((REJECTED_BACKLASH * rejected + insistence + distrust) * readingSaves),
  );

  const net = shift - FACE_WEIGHT * faceCost;
  const outcome: PersuasionOutcome =
    backlash >= OFFEND_AT && backlash > net
      ? "offended"
      : net >= i.gap && shift > 0
        ? "moved"
        : shift >= SWAY_MIN
          ? "swayed"
          : "unmoved";

  const effects: PersuasionEffect[] = [];
  const conf = round(clamp01(cred * delivery * open));
  if (conf > 0) effects.push({ kind: "belief", confidence: conf });
  if (rel > 0 && outcome !== "offended") {
    effects.push({
      kind: "weight",
      key: appealKey(a.appealsTo),
      boost: round(WEIGHT_BOOST * rel * delivery),
      ticks: WEIGHT_TICKS,
    });
  }
  if (a.appealsTo.kind === "fear" && rel > 0 && outcome !== "offended") {
    effects.push({ kind: "emotion", emotion: "fear", delta: round(rel * cred * delivery) });
  }
  if (outcome === "offended") {
    effects.push({ kind: "emotion", emotion: "anger", delta: backlash });
  } else if (outcome === "moved" && faceCost > 0.2) {
    effects.push({ kind: "emotion", emotion: "shame", delta: faceCost });
  }

  return {
    outcome,
    relevance: round(rel),
    credibility: cred,
    delivery,
    openness: open,
    shift,
    faceCost,
    backlash,
    trustDelta: round(TRUST_PER_BACKLASH * backlash),
    stanceDelta: outcome === "moved" ? -i.stance : round(backlash),
    effects,
  };
}

/** La posición pública del oyente después del intercambio (0-1). */
export function nextStance(stance: number, p: Persuasion): number {
  return round(clamp01(stance + p.stanceDelta));
}
