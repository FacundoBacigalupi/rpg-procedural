// Testigos que se equivocan y mienten, acusaciones y culpa (law §5, npc-psychology §5, dialogue §6).
// Todo es puro y trabaja sobre lo que cada uno SABE (`Deed`), nunca sobre la verdad: el testigo
// recuerda un hecho que el tiempo, lo que siente por los involucrados y lo que ya sospechaba
// deforman; después decide si cuenta lo que recuerda o miente (miedo, lealtad, soborno, odio contra
// su conciencia); quien oye una acusación la pesa según quién habla y a quién acusa; y quien hizo
// algo malo lo carga como culpa que lo empuja a confesar, evitar a la víctima o reparar.
// Cada función consume siempre la misma cantidad de sorteos, así cambiar una entrada no corre las
// tiradas siguientes.

import { type AgentId, type EventId, exp, LN2, type Random, type Tick } from "../../core/index.ts";
import type { Deed, DeedKind, DeedVia } from "./deeds.ts";

const DAY = 86_400;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const clamp11 = (x: number): number => Math.min(1, Math.max(-1, x));

// ---------------------------------------------------------------------------------------------
// Recordar lo que se vio

export interface DeedRecallContext {
  /** Ahora. */
  readonly now: Tick;
  /** 0-1: qué tan bien lo vio (luz, distancia, atención) al formar el recuerdo. */
  readonly clarity: number;
  /** -1..1: cuánto le cae bien quien cree que lo hizo (o quien le caería mal sospechado). */
  readonly affinityToDoer: number;
  /** -1..1: cuánto le importa la víctima. */
  readonly affinityToVictim: number;
  /** A quién ya sospechaba (rumor, antecedente): se le cuelga el hecho cuando no vio quién fue. */
  readonly suspect: AgentId | null;
  /** 0-1: cuánto se deja llevar por lo que ya creía (esquemas, prejuicio) en vez de lo visto. */
  readonly bias: number;
}

/** Lo que el testigo recuerda hoy de un hecho: puede diferir de `original`. */
export interface DeedRecollection {
  readonly deed: Deed;
  /** 0-1: cuánto cree él que fue así (baja con el tiempo y la mala vista). */
  readonly confidence: number;
  /** 0-1: cuánto se alejó de lo que realmente vio. */
  readonly distortion: number;
}

/** Vida media de la confianza en un recuerdo de un hecho (días). */
export const RECALL_HALF_LIFE_DAYS = 20;

const ESCALATE: Readonly<Record<DeedKind, DeedKind>> = {
  fraud: "theft",
  default: "theft",
  theft: "assault",
  assault: "assault",
};
const SOFTEN: Readonly<Record<DeedKind, DeedKind>> = {
  fraud: "default",
  default: "default",
  theft: "default",
  assault: "theft",
};

/**
 * Cómo recuerda hoy `witness` el hecho que guardó. Tres deformaciones, con sorteos fijos:
 * - sin saber quién fue, el sesgo le pone la cara del sospechoso (no el nombre de un inocente al azar);
 * - el hecho crece con el rencor hacia quien lo hizo y se achica con el cariño;
 * - la confianza baja con el tiempo y con la mala vista; cuanto menos confía, más se deja llevar.
 */
export function recallDeed(deed: Deed, ctx: DeedRecallContext, rng: Random): DeedRecollection {
  const blameRoll = rng.float();
  const kindRoll = rng.float();
  const driftRoll = rng.float();
  const days = Math.max(0, ctx.now - deed.at) / DAY;
  const fade = exp((-LN2 * days) / RECALL_HALF_LIFE_DAYS);
  // Lo oído de segunda mano nace menos firme que lo visto.
  const origin = deed.via === "saw" ? 1 : deed.via === "heard" ? 0.8 : 0.6;
  const confidence = clamp01(origin * (0.3 + 0.7 * clamp01(ctx.clarity)) * (0.35 + 0.65 * fade));
  const loose = (1 - confidence) * clamp01(ctx.bias);

  let by = deed.by;
  let moved = 0;
  if (by === null && ctx.suspect !== null && blameRoll < loose * 1.5) {
    by = ctx.suspect;
    moved += 0.5;
  }

  let kind = deed.kind;
  const hostility = clamp11(-ctx.affinityToDoer);
  if (kindRoll < loose * Math.max(0, hostility)) {
    kind = ESCALATE[kind];
  } else if (kindRoll > 1 - loose * Math.max(0, -hostility)) {
    kind = SOFTEN[kind];
  }
  if (kind !== deed.kind) moved += 0.3;

  // La hora también se corre: el hecho se recuerda más cerca de hoy de lo que fue.
  const shift = Math.floor(driftRoll * loose * 0.5 * Math.max(0, ctx.now - deed.at));
  const at = (deed.at + shift) as Tick;
  if (shift > 0) moved += 0.1;

  return {
    deed: { ...deed, by, kind, at },
    confidence,
    distortion: clamp01(moved * (0.5 + loose)),
  };
}

// ---------------------------------------------------------------------------------------------
// Mentir

export type LieKind =
  /** Cuenta lo que recuerda. */
  | "none"
  /** Dice que no vio nada o que no sabe. */
  | "deny"
  /** Nombra a otro distinto de quien recuerda (inculpar). */
  | "frame"
  /** Dice que fue el acusado aunque no lo recuerda o recuerda otra cosa (falso testimonio). */
  | "invent";

export type LieMotive = "fear" | "loyalty" | "bribe" | "hatred" | "none";

export interface WitnessMotives {
  /** 0-1: miedo a las consecuencias de hablar (venganza del culpable, de su gente). */
  readonly fear: number;
  /** 0-1: lealtad a quien hizo el hecho (parentesco, deuda, facción). */
  readonly loyaltyToDoer: number;
  /** 0-1: valor de lo que le ofrecen por callar o por decir otra cosa, ya en términos de utilidad. */
  readonly bribe: number;
  /** 0-1: odio a alguien a quien podría colgarle el hecho. */
  readonly hatredOfOther: number;
  /** 0-1: cuánto pesa en él la honestidad / el temor a ser descubierto en la mentira. */
  readonly honesty: number;
  /** 0-1: facilidad para mentir bien (también cuán probable es que lo descubran: 1 - skill). */
  readonly skill: number;
}

export interface Lie {
  readonly kind: LieKind;
  readonly motive: LieMotive;
  /** 0-1: qué tan convincente suena (el juez/oyente la compara con su propia lectura). */
  readonly polish: number;
}

/** Cuánto tiene que superar el motivo a la honestidad para mentir. */
export const LIE_MARGIN = 0.05;

/**
 * Si `m` miente al contar el hecho y cómo. El motivo más fuerte decide la forma: miedo y soborno
 * callan o niegan, lealtad niega o desvía, odio inventa o inculpa. Mentir exige que el motivo gane
 * a la honestidad con un margen; las tiradas deciden el desempate fino y la forma.
 */
export function decideLie(m: WitnessMotives, rng: Random): Lie {
  const gate = rng.float();
  const shape = rng.float();
  const polishRoll = rng.float();
  const entries: readonly (readonly [LieMotive, number])[] = [
    ["fear", m.fear],
    ["loyalty", m.loyaltyToDoer],
    ["bribe", m.bribe],
    ["hatred", m.hatredOfOther],
  ];
  let top: LieMotive = "none";
  let force = 0;
  for (const [motive, v] of entries) {
    if (v > force) {
      top = motive;
      force = v;
    }
  }
  const resolve = clamp01(m.honesty) + LIE_MARGIN - 0.25 * (gate - 0.5);
  if (top === "none" || force <= resolve) return { kind: "none", motive: "none", polish: 0 };
  const polish = clamp01(0.3 * polishRoll + 0.7 * clamp01(m.skill));
  const kind: LieKind =
    top === "fear" || top === "bribe"
      ? "deny"
      : top === "loyalty"
        ? shape < 0.5
          ? "deny"
          : "frame"
        : shape < 0.5
          ? "invent"
          : "frame";
  return { kind, motive: top, polish };
}

/** Lo que el testigo termina diciendo. */
export interface Testimony {
  readonly kind: DeedKind | null;
  readonly accused: AgentId | null;
  readonly victim: AgentId;
  readonly event: EventId;
  readonly at: Tick;
  /** 0-1: con qué firmeza lo dice. */
  readonly certainty: number;
  /** Para el inspector y los tests: lo que dijo no es lo que recuerda. Nadie del mundo lo ve. */
  readonly lie: Lie;
  readonly distortion: number;
}

/**
 * Declaración de un testigo: recordar, y después decidir si decirlo como lo recuerda. `other` es a
 * quién podría colgarle el hecho (`frame`/`invent`); sin `other`, la mentira se reduce a negar.
 */
export function testify(
  deed: Deed,
  recallCtx: DeedRecallContext,
  motives: WitnessMotives,
  other: AgentId | null,
  rng: Random,
): Testimony {
  const memory = recallDeed(deed, recallCtx, rng);
  const lie = decideLie(motives, rng);
  const base = {
    victim: deed.victim,
    event: deed.event,
    at: memory.deed.at,
    distortion: memory.distortion,
  };
  if (lie.kind === "none") {
    return {
      ...base,
      kind: memory.deed.kind,
      accused: memory.deed.by,
      certainty: memory.confidence,
      lie,
    };
  }
  if (lie.kind === "deny" || other === null) {
    return { ...base, kind: null, accused: null, certainty: lie.polish, lie };
  }
  // Inculpar a otro: el que miente suele sonar más seguro que el que de verdad recuerda poco.
  return {
    ...base,
    kind: memory.deed.kind,
    accused: other,
    certainty: clamp01(0.5 * memory.confidence + 0.5 * lie.polish),
    lie,
  };
}

// ---------------------------------------------------------------------------------------------
// Acusaciones en el diálogo

/** Lo que alguien le dice a otro de que `accused` hizo `kind` (el contenido de un acto de habla). */
export interface Accusation {
  readonly accuser: AgentId;
  readonly accused: AgentId;
  readonly kind: DeedKind;
  readonly victim: AgentId | null;
  /** El evento citado, si el que acusa lo conoce de verdad (null: acusa sin hecho que mostrar). */
  readonly event: EventId | null;
  /** 0-1: con qué firmeza acusa. */
  readonly certainty: number;
}

export interface HearerView {
  /** 0-1: cuánto le cree en general a quien acusa (relación, estatus, antecedentes de mentir). */
  readonly trustInAccuser: number;
  /** -1..1: cuánto aprecia al acusado. */
  readonly affinityToAccused: number;
  /** Lo que él mismo ya sabía del acusado: peor hecho conocido, si lo hay. */
  readonly ownKnowledge: Deed | null;
  /** 0-1: cuánto se deja llevar por lo que le dicen (credulidad). */
  readonly gullibility: number;
  /** 0-1: cuánto gana el oyente si el acusado cae (interés propio que lo vuelve crédulo). */
  readonly stake: number;
}

/**
 * Cuánto cree el oyente que el acusado lo hizo (0-1), antes y después de oír. Una acusación
 * firme de alguien confiable mueve mucho; el cariño al acusado la frena; si él mismo sabía de ese
 * hecho (o de uno peor) la confirma; sin hecho que mostrar y con interés en el resultado, pesa
 * menos (suena a calumnia). Es la creencia, no la verdad.
 */
export function weighAccusation(
  a: Accusation,
  h: HearerView,
  prior: number,
): { readonly belief: number; readonly suspectsLiar: boolean } {
  const evidence = a.event === null ? 0.55 : 1;
  const pull =
    clamp01(h.trustInAccuser) *
    clamp01(a.certainty) *
    evidence *
    (0.4 + 0.6 * clamp01(h.gullibility)) *
    (1 - 0.5 * Math.max(0, clamp11(h.affinityToAccused)));
  const confirms = h.ownKnowledge === null ? 0 : h.ownKnowledge.kind === a.kind ? 0.5 : 0.2;
  const spite = 0.15 * Math.max(0, clamp11(-h.affinityToAccused));
  const target = clamp01(pull + confirms + spite);
  const p = clamp01(prior);
  // Se mueve hacia el objetivo: lo nuevo pesa lo que confía en quien habla.
  const weight = 0.25 + 0.5 * clamp01(h.trustInAccuser);
  const belief = clamp01(p + (target - p) * weight);
  // Sospecha de calumnia cuando acusan sin hecho, con interés, y no se confirma con lo que sabe.
  const suspectsLiar =
    a.event === null && h.ownKnowledge === null && clamp01(h.stake) > 0.5 && h.trustInAccuser < 0.6;
  return { belief, suspectsLiar };
}

/** Para qué le sirve al juez/aldea la acusación: umbral de creencia para actuar contra alguien. */
export const ACCUSATION_ACTS_AT = 0.6;

// ---------------------------------------------------------------------------------------------
// Culpa por el delito propio

export interface OwnDeed {
  readonly kind: DeedKind;
  readonly victim: AgentId;
  readonly at: Tick;
  readonly event: EventId;
  /** 0-1: cuánto sufrió la víctima por esto (valor robado, herida). */
  readonly harm: number;
  /** El bien tomado, si fue un robo: la religión puede tener un tabú sobre él. */
  readonly good?: string;
}

export interface Conscience {
  /** 0-1: empatía por la víctima (relación, afecto). */
  readonly bondToVictim: number;
  /** 0-1: cuánto lo condena su propia cultura y valores. */
  readonly moralWeight: number;
  /** 0-1: lo que cree que lo justifica (hambre, venganza, orden recibida). */
  readonly justification: number;
  /** 0-1: miedo a ser descubierto. */
  readonly fearOfExposure: number;
}

/** Vida media de la culpa si nada la reaviva (días): la culpa sorda es lenta. */
export const GUILT_HALF_LIFE_DAYS = 60;

const SEVERITY: Readonly<Record<DeedKind, number>> = {
  assault: 1,
  theft: 0.6,
  fraud: 0.4,
  default: 0.3,
};

/** Culpa que carga hoy quien hizo `d` (0-1): sube con el daño, la empatía y los valores. */
export function guiltOf(d: OwnDeed, c: Conscience, now: Tick): number {
  const raw =
    SEVERITY[d.kind] *
    (0.3 + 0.7 * clamp01(d.harm)) *
    (0.25 + 0.75 * clamp01(c.moralWeight)) *
    (0.4 + 0.6 * clamp01(c.bondToVictim)) *
    (1 - 0.7 * clamp01(c.justification));
  const days = Math.max(0, now - d.at) / DAY;
  return clamp01(raw * exp((-LN2 * days) / GUILT_HALF_LIFE_DAYS));
}

export type GuiltResponse = "none" | "avoid" | "repair" | "confess" | "deflect";

/**
 * Qué hace la culpa. Poca: nada. Media: evitar a la víctima o reparar. Mucha: confesar si el
 * miedo a la exposición no es mayor, y si lo es, desviar (culpar a otro, negar). Con 3 sorteos.
 */
export function respondToGuilt(
  guilt: number,
  c: Conscience,
  canRepair: boolean,
  rng: Random,
): GuiltResponse {
  const roll = rng.float();
  rng.float();
  rng.float();
  if (guilt < 0.1) return "none";
  const fear = clamp01(c.fearOfExposure);
  if (guilt >= 0.6) return fear > guilt ? "deflect" : roll < 0.7 ? "confess" : "repair";
  if (guilt >= 0.3) {
    if (canRepair && roll < 0.55 && fear < 0.7) return "repair";
    return fear > 0.6 ? "deflect" : "avoid";
  }
  return roll < guilt * 3 ? "avoid" : "none";
}

/** El hecho que `testimony` deja como creencia de quien la oye (`via: "told"`). */
export function testimonyAsDeed(t: Testimony, via: DeedVia = "told"): Deed | null {
  if (t.kind === null) return null;
  return { kind: t.kind, by: t.accused, victim: t.victim, event: t.event, at: t.at, via };
}
