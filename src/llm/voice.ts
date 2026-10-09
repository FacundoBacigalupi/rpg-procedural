// Léxico y voz del personaje (narration §4). El mundo trae su vocabulario (qi o maná, reino o
// rango); el personaje sabe solo el subconjunto que cree, y lo técnico que no sabe se dice con
// otras palabras ("uno de esos inmortales"). La voz (cultura, estrato, oficio, ánimo) tiñe el
// registro y el tono, nunca los hechos. Todo es dato plano que arma quien conoce al personaje
// (creencias y habilidades); acá solo se convierte en lo que ve el narrador y en lo que el
// validador hace cumplir. Sin LLM, sin RNG.

/** Un término del vocabulario del mundo y cómo lo diría quien no lo conoce. */
export interface WorldTerm {
  /** Concepto estable (el que el personaje cree o no): `realm.foundation`. */
  readonly concept: string;
  /** La palabra técnica, en el idioma de la narración. */
  readonly term: string;
  /** Cómo lo dice quien no la sabe: una descripción de lo que ve. */
  readonly plain: string;
  /** Lo técnico se aprende; lo común lo sabe cualquiera de la cultura. */
  readonly technical: boolean;
}

export const MOODS = [
  "calm",
  "fear",
  "grief",
  "anger",
  "joy",
  "shame",
  "longing",
  "guilt",
] as const;
export type VoiceMood = (typeof MOODS)[number];

export const STRATA = ["poor", "common", "learned", "noble"] as const;
export type Stratum = (typeof STRATA)[number];

/** Lo que el motor sabe de cómo habla y mira el personaje. */
export interface VoiceInput {
  /** Nombre de la cultura en el idioma de la narración ("de montaña", "del delta"). */
  readonly culture: string;
  readonly stratum: Stratum;
  /** 0..1: cuánto leyó y estudió. */
  readonly education: number;
  /** Su oficio y lo que nota por él (el temple de una hoja, la tela de una túnica). */
  readonly trade?: { readonly name: string; readonly notices: readonly string[] };
  readonly mood?: VoiceMood;
}

export type Register = "rough" | "plain" | "refined";

/** La voz que ve el narrador: sin números, solo consignas. */
export interface VoiceView {
  readonly culture: string;
  readonly register: Register;
  readonly trade?: { readonly name: string; readonly notices: readonly string[] };
  /** Tiñe el tono; no agrega hechos. */
  readonly mood?: VoiceMood;
}

/** El léxico que ve el narrador: qué términos puede usar y qué decir en lugar de los otros. */
export interface LexiconView {
  readonly use: readonly string[];
  readonly avoid: readonly { readonly term: string; readonly say: string }[];
}

export function registerOf(stratum: Stratum, education: number): Register {
  const bonus = stratum === "noble" ? 0.35 : stratum === "learned" ? 0.25 : 0;
  const score = education + bonus - (stratum === "poor" ? 0.2 : 0);
  if (score >= 0.6) return "refined";
  if (score < 0.25) return "rough";
  return "plain";
}

export function voiceOf(input: VoiceInput): VoiceView {
  return {
    culture: input.culture,
    register: registerOf(input.stratum, input.education),
    ...(input.trade !== undefined ? { trade: input.trade } : {}),
    ...(input.mood !== undefined ? { mood: input.mood } : {}),
  };
}

/**
 * El subconjunto del vocabulario que el personaje conoce: lo común siempre, lo técnico solo si
 * cree el concepto. Orden fijo (por concepto) para que el pedido sea determinista.
 */
export function characterLexicon(
  world: readonly WorldTerm[],
  believed: ReadonlySet<string>,
): LexiconView {
  const sorted = [...world].sort((a, b) =>
    a.concept < b.concept ? -1 : a.concept > b.concept ? 1 : 0,
  );
  const use: string[] = [];
  const avoid: { term: string; say: string }[] = [];
  for (const t of sorted) {
    if (!t.technical || believed.has(t.concept)) use.push(t.term);
    else avoid.push({ term: t.term, say: t.plain });
  }
  return { use, avoid };
}

/** Lo que el prompt le dice al narrador del ánimo: tono, no hechos. */
export const MOOD_TONE: Readonly<Record<VoiceMood, string>> = {
  calm: "even and unhurried",
  fear: "tense and clipped, attention snagging on small things",
  grief: "heavy and slow, with little color",
  anger: "sharp and short, noticing what irritates",
  joy: "light and quick, open to small pleasures",
  shame: "evasive, avoiding looking at things for long",
  longing: "wistful, drawn to what is absent",
  guilt: "self-watchful, circling back to what was done",
};

export const REGISTER_TONE: Readonly<Record<Register, string>> = {
  rough: "plain, short words, everyday comparisons, no learned vocabulary",
  plain: "ordinary speech, no flourishes",
  refined: "educated, precise, allowed some elaborate phrasing",
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Los términos técnicos que el texto usa y el personaje no conoce (fuera de lo citado). */
export function unknownTermsIn(
  text: string,
  lexicon: LexiconView,
  quoted = "",
): { term: string; say: string }[] {
  const out: { term: string; say: string }[] = [];
  for (const a of lexicon.avoid) {
    const re = new RegExp(`(?<![\\p{L}])${escapeRe(a.term)}(?![\\p{L}])`, "iu");
    if (re.test(text) && !re.test(quoted)) out.push(a);
  }
  return out;
}
