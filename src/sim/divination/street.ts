// Adivinos de calle (divination §1, §8, Fase 2): ritual y lectura en frío. Ninguno lee la verdad
// del mundo. El ritual saca símbolos del azar del instrumento, torcido por lo que el adivino
// quiere (o cree que el cliente quiere) oír; la lectura en frío deduce la preocupación del cliente
// de lo que se le ve (duelo, bolsa flaca, cojera, nervios) y de lo que el cliente pregunta. Lo que
// sale se interpreta en una profecía (`ProphecyClaim`) con los sesgos de quien interpreta. Las
// funciones no reciben `WorldTruth`: lo que acierta, acierta porque la gente es legible.
//
// La reputación recuerda los aciertos y olvida a medias los fallos (information §9), así que un
// adivino famoso no es necesariamente bueno.

import type { AgentId } from "../../core/index.ts";
import { contentId, defineContent, type Rng, z } from "../../core/index.ts";
import type { ProphecyClaim, ProphecyKind } from "./prophecy.ts";

export const CONCERNS = ["love", "money", "health", "family", "fear", "ambition"] as const;
/** Lo que trae a alguien al adivino. */
export type Concern = (typeof CONCERNS)[number];

export const SymbolDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  /** Cómo se lee a grandes rasgos: bueno, malo o ambiguo. */
  tone: z.enum(["auspicious", "ominous", "ambiguous"]),
  /** Chance relativa de salir. */
  weight: z.number().gt(0).default(1),
});
export type SymbolDef = z.infer<typeof SymbolDef>;

export const DivinationMethodDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  culture: contentId,
  /** Qué lee de verdad: los métodos de calle son rituales (no leen nada). */
  source: z.enum(["knowledge", "metaphysical", "ritual"]),
  instrument: z.string().min(1),
  /** Cuántos símbolos salen en una tirada. */
  casts: z.number().int().min(1).max(9),
  symbols: z.array(SymbolDef).min(2),
});
export type DivinationMethodDef = z.infer<typeof DivinationMethodDef>;

export const DIVINATION_METHODS = defineContent("divination", DivinationMethodDef, (m) => [
  { kind: "cultures", id: m.culture, at: "culture" },
]);

/** Con qué palabras de la lengua se nombra cada preocupación (raíces: «amor» cubre «amores»). */
export const ConcernWords = z.strictObject({
  id: z.enum(CONCERNS),
  words: z.array(z.string().trim().min(1)).min(1),
});
export type ConcernWords = z.infer<typeof ConcernWords>;
export const DIVINATION_CONCERNS = defineContent("divination/concerns", ConcernWords);

const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * La preocupación que nombra lo que el cliente pregunta: la que más palabras suyas aparecen en
 * el texto (empate: la primera en orden de `CONCERNS`). Sin ninguna, nada: pregunta sin tema.
 */
export function concernIn(text: string | null, defs: readonly ConcernWords[]): Concern | undefined {
  if (text === null) return undefined;
  const tokens = plain(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
  let best: Concern | undefined;
  let top = 0;
  for (const c of CONCERNS) {
    const def = defs.find((d) => d.id === c);
    if (!def) continue;
    const roots = def.words.map(plain);
    const hits = tokens.filter((t) => roots.some((r) => t.startsWith(r))).length;
    if (hits > top) {
      top = hits;
      best = c;
    }
  }
  return best;
}

/** Lo que salió: el método y los símbolos concretos (de su vocabulario). */
export interface Omen {
  readonly method: string;
  readonly signs: readonly string[];
}

/** Cuánto tuerce el deseo de oír algo bueno o malo el reparto de símbolos, a deseo 1. */
export const TONE_PULL = 1.5;
/** Cuánto pesa lo que el cliente pregunta frente a lo que se le ve, al deducir qué lo trae. */
export const ASKED_WEIGHT = 3;
/** Ruido de la lectura en frío a perspicacia 0 (se suma a cada señal). */
export const COLD_NOISE = 1.2;
/** Lo que pesa un fallo en la memoria del barrio frente a un acierto. */
export const MISS_RECALL = 0.35;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;
const toneSign = (t: SymbolDef["tone"]) => (t === "auspicious" ? 1 : t === "ominous" ? -1 : 0);

/**
 * La tirada del instrumento: sin acceso a la verdad. `want` (-1..1) es lo que el adivino quiere
 * o cree que el cliente quiere oír (+ lo bueno). Consume siempre `casts` sorteos.
 */
export function castOmen(method: DivinationMethodDef, want: number, rng: Rng): Omen {
  const r = rng.fork("cast");
  const pull = Math.max(-1, Math.min(1, want)) * TONE_PULL;
  const weights = method.symbols.map((s) =>
    Math.max(0.05, s.weight * (1 + pull * toneSign(s.tone))),
  );
  const signs: string[] = [];
  for (let i = 0; i < method.casts; i++) {
    const k = r.weighted(weights);
    signs.push((method.symbols[k] as SymbolDef).id);
  }
  return { method: method.id, signs };
}

/** El tono neto de lo que salió: -1 todo malo, +1 todo bueno. */
export function omenTone(method: DivinationMethodDef, omen: Omen): number {
  if (omen.signs.length === 0) return 0;
  const sum = omen.signs.reduce((s, id) => {
    const sym = method.symbols.find((x) => x.id === id);
    return s + (sym ? toneSign(sym.tone) : 0);
  }, 0);
  return round(sum / omen.signs.length);
}

/** Lo que se le ve al cliente (señales 0-1 por preocupación) y lo que pregunta, si pregunta. */
export interface ClientCues {
  readonly signals: Readonly<Partial<Record<Concern, number>>>;
  readonly asked?: Concern;
}

export interface ColdReading {
  readonly concern: Concern;
  /** 0-1: cuán claro vio lo que lo trae (alimenta lo específico que suena). */
  readonly grasp: number;
}

/**
 * Lectura en frío: deduce qué trae al cliente de lo que se le ve y de lo que pregunta, con ruido
 * que baja con la perspicacia (0-1). Siempre consume `CONCERNS.length + 1` sorteos.
 */
export function coldRead(cues: ClientCues, insight: number, rng: Rng): ColdReading {
  const r = rng.fork("cold");
  const noise = COLD_NOISE * (1 - clamp01(insight));
  const weights = CONCERNS.map((c) => {
    const seen = clamp01(cues.signals[c] ?? 0);
    const jitter = noise * r.float();
    return 0.05 + seen + jitter + (cues.asked === c ? ASKED_WEIGHT : 0);
  });
  const pick = r.weighted(weights.map((w) => w * w));
  const total = weights.reduce((s, w) => s + w, 0);
  return {
    concern: CONCERNS[pick] as Concern,
    grasp: round(clamp01((weights[pick] as number) / total + clamp01(insight) * 0.3)),
  };
}

export interface Diviner {
  readonly id: AgentId;
  /** 0-1: cuánto halaga (inclina a decir lo que el cliente quiere oír). */
  readonly flattery: number;
  /** 0-1: perspicacia para leer a la gente. */
  readonly insight: number;
  /** -1..1: su escuela inclina a ver lo bueno (+) o lo malo (-), sin importar el cliente. */
  readonly school: number;
}

const CLAIM_BY_CONCERN: Readonly<
  Record<Concern, { readonly good: ProphecyKind; readonly bad: ProphecyKind }>
> = {
  love: { good: "fortune", bad: "ruin" },
  money: { good: "fortune", bad: "ruin" },
  health: { good: "fortune", bad: "death" },
  family: { good: "fortune", bad: "ruin" },
  fear: { good: "fortune", bad: "ruin" },
  ambition: { good: "greatness", bad: "ruin" },
};

export interface StreetUtterance {
  readonly claim: ProphecyClaim;
  /** Cuánto de lo dicho es relleno que le serviría a cualquiera (efecto Barnum), 0-1. */
  readonly vagueness: number;
}

/**
 * Interpreta lo que salió en una profecía sobre el cliente (§4): el tono de los símbolos, la
 * escuela del adivino y lo que el cliente quiere oír (`clientWant`, -1..1) se suman con la
 * adulación; el signo decide si es buena o mala y la intensidad crece con la claridad con que
 * leyó al cliente. Un adivino que no vio nada claro habla en general. Consume dos sorteos.
 */
export function interpret(
  method: DivinationMethodDef,
  omen: Omen,
  reading: ColdReading,
  diviner: Diviner,
  client: AgentId,
  clientWant: number,
  rng: Rng,
): StreetUtterance {
  const r = rng.fork("interpret");
  const lean =
    omenTone(method, omen) + 0.5 * diviner.school + clamp01(diviner.flattery) * clientWant;
  const tie = r.float() - 0.5;
  const good = lean + 0.1 * tie >= 0;
  const spread = CLAIM_BY_CONCERN[reading.concern];
  const kind = good ? spread.good : spread.bad;
  const vagueness = round(1 - reading.grasp);
  const jitter = r.float() * 0.1;
  const intensity = round(
    clamp01(0.25 + 0.3 * Math.min(1, Math.abs(lean)) + 0.3 * reading.grasp + jitter),
  );
  return { claim: { kind, subject: client, intensity }, vagueness };
}

export interface Consultation {
  readonly omen: Omen;
  readonly reading: ColdReading;
  readonly utterance: StreetUtterance;
}

/**
 * Una consulta de calle completa. `rng` ya viene forkeado por (adivino, consulta, tick)
 * (divination Principio 8): no toca el rng del mundo. El deseo del cliente tuerce la tirada
 * en la medida en que el adivino halaga.
 */
export function streetConsult(
  method: DivinationMethodDef,
  diviner: Diviner,
  client: AgentId,
  cues: ClientCues,
  clientWant: number,
  rng: Rng,
): Consultation {
  const reading = coldRead(cues, diviner.insight, rng);
  const omen = castOmen(method, clamp01(diviner.flattery) * clientWant + 0.5 * diviner.school, rng);
  const utterance = interpret(method, omen, reading, diviner, client, clientWant, rng);
  return { omen, reading, utterance };
}

/** Los aciertos y fallos que el barrio vio (no los que hubo). */
export interface DivinerRecord {
  readonly hits: number;
  readonly misses: number;
}

/** Fama 0-1: suave con pocos casos, y los fallos se recuerdan a medias (information §9). */
export function renown(rec: DivinerRecord): number {
  return round((rec.hits + 1) / (rec.hits + MISS_RECALL * rec.misses + 2));
}

/** Sube la cuenta de aciertos o de fallos. */
export function record(rec: DivinerRecord, hit: boolean): DivinerRecord {
  return hit ? { ...rec, hits: rec.hits + 1 } : { ...rec, misses: rec.misses + 1 };
}
