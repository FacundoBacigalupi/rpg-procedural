// La intención declarada del plan se percibe y se malinterpreta (actions, ampliación 2026-10-08).
// El «por qué» y el «para quién» de un plan (`Purpose`) son verdad del actor: los demás nunca lo
// leen directo. Lo que ven es el verbo, el contexto (de quién es la cosa, si se hizo a escondidas)
// y, si el actor lo dijo en voz alta y se lo oyó, lo que declaró. Con eso arman una lectura
// (`ReadPurpose`) con confianza, y la lectura puede errar: el desconfiado ve robo donde hay
// regalo, quien quiere al actor ve favor donde hay cálculo, y una mentira dicha con aplomo pasa
// si el oyente no sospecha. Una misma acción con otra intención se juzga distinto
// (`purposeWeight`), que es lo que leen law y social-structure.
//
// Puro y determinista: la lectura tira con `fork("purpose", actor, tick, lector)`. Qué verbos
// admiten qué motivos es contenido de este módulo hasta que el catálogo lo declare por verbo.

import { type AgentId, type EntityRef, type Rng, sqrt, type Tick } from "../../core/index.ts";

/** Los porqués del catálogo cerrado: sin texto libre, así se pueden comparar y juzgar. */
export const PURPOSES = [
  "sustenance",
  "gift",
  "payment",
  "gain",
  "theft",
  "harm",
  "defense",
  "revenge",
  "help",
  "curiosity",
  "concealment",
  "devotion",
  "duty",
] as const;
export type PurposeId = (typeof PURPOSES)[number];

/** La intención declarada de un plan, en la verdad del actor. */
export interface Purpose {
  readonly motive: PurposeId;
  /** Para quién (el beneficiario o el blanco del motivo), si hay alguien. */
  readonly forWhom?: EntityRef | undefined;
}

/**
 * Cuánto pesa moralmente cada motivo para quien juzga, de -1 (hostil, dañino) a 1 (benigno):
 * `purposeWeight` lo cruza con el verbo. La cultura y la ley lo reescalan; acá es el piso común.
 */
export const PURPOSE_VALENCE: Readonly<Record<PurposeId, number>> = {
  sustenance: 0.2,
  gift: 0.8,
  payment: 0.5,
  gain: 0,
  theft: -0.8,
  harm: -1,
  defense: 0.3,
  revenge: -0.5,
  help: 0.9,
  curiosity: 0.1,
  concealment: -0.4,
  devotion: 0.5,
  duty: 0.4,
};

/** Los motivos hostiles (los que el desconfiado sobreestima). */
const HOSTILE: ReadonlySet<PurposeId> = new Set(["theft", "harm", "revenge", "concealment"]);
/** Los benignos (los que quien quiere al actor sobreestima). */
const BENIGN: ReadonlySet<PurposeId> = new Set(["gift", "help", "payment", "devotion", "duty"]);

/** Quién es dueño de la cosa sobre la que recae el verbo, desde el punto de vista del lector. */
export type PurposeTenure = "own" | "other" | "unowned" | "none";

/** Lo que el lector tiene a la vista de la acción de otro. */
export interface PurposeContext {
  readonly verb: string;
  /** De quién es lo que se toca o se da, o `none` si el verbo no recae en una cosa. */
  readonly tenure: PurposeTenure;
  /** El actor se ocultó o actuó cuando creía que nadie miraba. */
  readonly covert: boolean;
  /** La acción recae en una persona (golpear, hablar, dar), no en una cosa. */
  readonly onPerson: boolean;
  /** El lector es esa persona. */
  readonly readerIsTarget: boolean;
}

/** Lo que dijo el actor, si lo dijo y el lector lo oyó entendiendo (dialogue). */
export interface PurposeDeclaration {
  readonly motive: PurposeId;
  /** 0-1: cuán entendible y creíble sonó (la entrega, la cara; lo decide el diálogo). */
  readonly aplomb: number;
}

/** El lector: qué piensa del actor y cuán desconfiado es. */
export interface PurposeReader {
  readonly id: AgentId;
  /** -1 (lo odia) a 1 (lo quiere). */
  readonly regard: number;
  /** 0-1: tendencia a suponer lo peor (temperamento, esquemas, experiencias). */
  readonly suspicion: number;
}

/** Lo que el verbo permite como motivo, con el peso previo sin contexto. */
const VERB_MOTIVES: Readonly<Record<string, Readonly<Partial<Record<PurposeId, number>>>>> = {
  gather: { sustenance: 3, gain: 2, payment: 1, devotion: 0.5, duty: 1 },
  work: { sustenance: 2, gain: 2, payment: 1, duty: 2, help: 1 },
  look: { curiosity: 3, duty: 1, concealment: 1, theft: 0.5, harm: 0.5 },
  search: { curiosity: 2, sustenance: 1, gain: 1.5, theft: 1, duty: 1 },
  speak: {
    help: 1.5,
    gain: 1,
    curiosity: 1.5,
    devotion: 0.5,
    duty: 1,
    concealment: 0.5,
    harm: 0.5,
  },
  strike: { harm: 2, defense: 2, revenge: 1.5, duty: 1 },
  spare: { help: 2, gift: 1, defense: 0.5 },
  trade: { gain: 3, payment: 1.5, sustenance: 1 },
  give: { gift: 3, payment: 2, help: 2, devotion: 1, duty: 1 },
  take: { sustenance: 1.5, gain: 1.5, theft: 1, payment: 1, duty: 0.5 },
  store: { sustenance: 2, gain: 1, concealment: 1 },
  cook: { sustenance: 3, gift: 1, help: 1 },
  eat: { sustenance: 3 },
  drink: { sustenance: 3 },
  tend: { help: 3, duty: 2, sustenance: 1, devotion: 0.5 },
  move: { duty: 1, curiosity: 1, gain: 1, concealment: 0.5, theft: 0.2, harm: 0.2 },
  rest: { sustenance: 1 },
  wait: { concealment: 1, curiosity: 1, harm: 0.3, theft: 0.3 },
};

/** Un motivo que no está en la tabla del verbo es imposible de suponer por un sesgo. */
const FALLBACK: Readonly<Partial<Record<PurposeId, number>>> = { gain: 1, curiosity: 1, duty: 1 };

/**
 * El peso de cada motivo posible para un lector que ve esto: el previo del verbo, ajustado por el
 * contexto (tomar lo ajeno a escondidas empuja a robo; dar a quien lo recibe, a regalo) y por el
 * lector (el desconfiado infla lo hostil, quien aprecia al actor lo benigno). Cero excluye.
 */
export function purposeWeights(
  ctx: PurposeContext,
  reader: Pick<PurposeReader, "regard" | "suspicion">,
): Readonly<Partial<Record<PurposeId, number>>> {
  const base = VERB_MOTIVES[ctx.verb] ?? FALLBACK;
  const out: Partial<Record<PurposeId, number>> = {};
  for (const m of PURPOSES) {
    let w = base[m] ?? 0;
    if (w <= 0) continue;
    if (ctx.tenure === "other") {
      if (m === "theft") w *= 1 + (ctx.covert ? 4 : 1);
      if (m === "gain" || m === "sustenance") w *= 0.7;
      if (m === "gift" || m === "payment") w *= ctx.readerIsTarget ? 2 : 1;
    } else if (ctx.tenure === "own" || ctx.tenure === "unowned") {
      if (m === "theft") w *= 0.1;
    }
    if (ctx.covert && m === "concealment") w *= 3;
    if (ctx.onPerson && ctx.readerIsTarget && HOSTILE.has(m) && ctx.covert) w *= 1.5;
    if (HOSTILE.has(m)) w *= 1 + 3 * reader.suspicion - 0.5 * Math.max(0, reader.regard);
    if (BENIGN.has(m)) w *= 1 + 1.5 * Math.max(0, reader.regard) - 0.8 * reader.suspicion;
    if (reader.regard < 0 && HOSTILE.has(m)) w *= 1 - 0.8 * reader.regard;
    out[m] = Math.max(w, 0.01);
  }
  return out;
}

/** Una lectura: lo que el lector cree que el actor se propone. */
export interface ReadPurpose {
  readonly reader: AgentId;
  readonly actor: AgentId;
  readonly tick: Tick;
  readonly guessed: PurposeId;
  /** 0-1: cuán seguro está. */
  readonly confidence: number;
  /** De dónde salió: del dicho del actor o de suponerlo por la acción. */
  readonly basis: "declared" | "inferred";
  /** Verdad: no coincide con el motivo real. Solo para el inspector y la crónica. */
  readonly mistaken: boolean;
}

/** Cuánto más cree un lector sin sospecha a una declaración que a su propia suposición previa. */
const DECLARATION_TRUST = 0.9;

/**
 * Lee lo que se propone `actor` al hacer `ctx`. Si lo declaró y lo oyó, le cree según el aplomo y
 * su propia sospecha (una declaración que el contexto vuelve inverosímil, como «es un regalo»
 * mientras se lleva lo ajeno de noche, solo pasa si el aplomo le gana a la sospecha); si no, elige
 * entre los motivos del verbo ponderados por contexto y sesgo, con confianza igual a la parte que
 * el elegido se lleva (varios motivos parejos: poca seguridad).
 */
export function readPurpose(
  rng: Rng,
  actor: AgentId,
  truth: Purpose,
  ctx: PurposeContext,
  reader: PurposeReader,
  tick: Tick,
  declared?: PurposeDeclaration,
): ReadPurpose {
  const r = rng.fork("purpose", actor, tick, reader.id);
  const weights = purposeWeights(ctx, reader);
  const ids = PURPOSES.filter((m) => (weights[m] ?? 0) > 0);
  const total = ids.reduce((s, m) => s + (weights[m] ?? 0), 0);

  if (declared !== undefined) {
    const plausible = total > 0 ? (weights[declared.motive] ?? 0) / total : 0;
    // La probabilidad de creer: aplomo y verosimilitud empujan, la sospecha frena.
    const believe = clamp01(
      DECLARATION_TRUST * (0.5 * declared.aplomb + 0.5 * sqrt(plausible * ids.length)) -
        0.6 * reader.suspicion * (1 - declared.aplomb) +
        0.15 * Math.max(0, reader.regard),
    );
    if (r.chance(believe)) {
      return {
        reader: reader.id,
        actor,
        tick,
        guessed: declared.motive,
        confidence: clamp01(0.4 + 0.5 * believe),
        basis: "declared",
        mistaken: declared.motive !== truth.motive,
      };
    }
  }

  if (ids.length === 0) {
    // Sin motivo posible no hay lectura: se cae a la verdad, con poca confianza.
    return {
      reader: reader.id,
      actor,
      tick,
      guessed: truth.motive,
      confidence: 0.1,
      basis: "inferred",
      mistaken: false,
    };
  }
  const i = r.weighted(ids.map((m) => weights[m] ?? 0));
  const guessed = ids[i] as PurposeId;
  return {
    reader: reader.id,
    actor,
    tick,
    guessed,
    confidence: clamp01((weights[guessed] ?? 0) / total),
    basis: "inferred",
    mistaken: guessed !== truth.motive,
  };
}

/**
 * Cuánto pesa la acción para quien juzga, de -1 a 1, según el motivo que cree: el mismo `take`
 * es robo o recolección. Lo usan law (qué denunciar) y social-structure (cara, trato) sobre la
 * lectura del juez, no sobre la verdad; con baja confianza el peso se acerca a 0 (duda).
 */
export function purposeWeight(read: Pick<ReadPurpose, "guessed" | "confidence">): number {
  return PURPOSE_VALENCE[read.guessed] * (0.4 + 0.6 * read.confidence);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
