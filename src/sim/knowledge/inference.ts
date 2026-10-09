// Pensar con inferencia (player-loop "Pensar", information §4): el personaje junta la evidencia
// dispersa que ya tiene en la cabeza (percepts, memorias, oídas) y la combina con reglas de un
// catálogo cerrado para llegar a conclusiones que quizá no vio, con confianza propia y a veces
// equivocadas. No inventa hechos: toda conclusión cita la evidencia de la que salió y las reglas
// que encadenó (procedencia "razonamiento").
//
// Es puro y determinista: mismas premisas, mismo razonador y mismas reglas dan lo mismo, sin
// importar el orden en que llegaron. No lee la verdad: los errores salen solo de lo que hay en la
// cabeza (una premisa falsa, una regla abductiva que admite otras causas, la sospecha que sube el
// peso de la malicia, el miedo que infla la seguridad, el cansancio que corta la cadena).
// Comparar con la verdad es cosa del inspector (`inferenceAccuracy`).
//
// Alcance de este paso: motor y reglas como contenido (`content/inference/`, con quién las conoce).
// Cablearlo a `BELIEFS` (hoy solo `at` y `alive`),
// a las memorias y al comando "pensar" queda en sub-ítems del ROADMAP.

import { compareStrings, contentId, defineContent, z } from "../../core/index.ts";

/** Un hecho de un catálogo de predicados con argumentos (ids, lugares, cosas) como texto. */
export interface Fact {
  readonly pred: string;
  readonly args: readonly string[];
}

export const factKey = (f: Fact): string => `${f.pred}(${f.args.join(",")})`;

/** De dónde sale una premisa: lo que vio, recordó, le contaron o ya había deducido. */
export type EvidenceKind = "percept" | "memory" | "told" | "inference";

export interface Premise {
  readonly fact: Fact;
  /** 0-1: cuánto se fía de este hecho (ya envejecido, ya filtrado por la fuente). */
  readonly confidence: number;
  readonly kind: EvidenceKind;
  /** Identificador de la fuente (percept, memoria, rumor) para citarla. */
  readonly ref: string;
}

/** Patrón de hecho: los argumentos que empiezan con `?` son variables. */
export interface Pattern {
  readonly pred: string;
  readonly args: readonly string[];
}

export type RuleTone = "neutral" | "malice" | "danger";

export interface InferenceRule {
  readonly id: string;
  readonly premises: readonly Pattern[];
  readonly conclusion: Pattern;
  /** 0-1: cuánto sostienen las premisas a la conclusión (aun siendo ciertas). */
  readonly reliability: number;
  /** Abductiva: va del efecto a una causa posible; admite otras explicaciones. */
  readonly abductive: boolean;
  /** `malice` y `danger` son las que la sospecha y el miedo empujan. */
  readonly tone: RuleTone;
  /** El último argumento de la conclusión es un valor único: dos valores distintos compiten. */
  readonly exclusive: boolean;
}

/** Quien razona: lo que importa de su cabeza y su estado en este momento. */
export interface Reasoner {
  /** 0-1: inteligencia (alcance de la cadena y calidad del juicio). */
  readonly intellect: number;
  /** Ids de las reglas que conoce (un investigador conoce más que un campesino). */
  readonly rules: readonly string[];
  /** 0-1 */
  readonly fatigue: number;
  /** 0-1 */
  readonly fear: number;
  /** 0-1: esquema de desconfianza; da más peso a las reglas de malicia. */
  readonly suspicion: number;
}

export interface Inference {
  readonly fact: Fact;
  /** Cuánto cree que es así (lo sentido, incluidos el sesgo y el miedo), 0-INFERENCE_CAP. */
  readonly confidence: number;
  /** Cuántas reglas encadenó para llegar (1 = directa de la evidencia). */
  readonly depth: number;
  /** Reglas aplicadas, en el orden en que se encadenaron. */
  readonly chain: readonly string[];
  /** Evidencia original citada (`ref`), sin repetir y en orden. */
  readonly support: readonly string[];
  /** Otra conclusión exclusiva que perdió contra esta, si la hubo. */
  readonly rival?: { readonly fact: Fact; readonly confidence: number };
}

/** Nadie llega a certeza por deducir. */
export const INFERENCE_CAP = 0.9;
/** Por debajo de esto una conclusión ni se formula. */
export const INFERENCE_FLOOR = 0.15;
export const MAX_CHAIN = 4;
export const MAX_SUPPORT = 8;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Cuántas reglas puede encadenar: la inteligencia lo alarga y el cansancio fuerte lo corta. */
export function chainLimit(r: Reasoner): number {
  const base = 1 + Math.floor(clamp01(r.intellect) * 3);
  return Math.min(MAX_CHAIN, Math.max(1, base - (r.fatigue > 0.6 ? 1 : 0)));
}

/** Confiabilidad efectiva de una regla para este razonador. */
export function effectiveReliability(rule: InferenceRule, r: Reasoner): number {
  let x = rule.reliability * (0.6 + 0.4 * clamp01(r.intellect));
  if (rule.tone === "malice") x *= 0.7 + 0.8 * clamp01(r.suspicion);
  if (rule.abductive) x *= 1 - 0.3 * clamp01(r.fatigue);
  return clamp01(x);
}

/** El miedo infla lo que asusta: suma una parte de lo que falta para estar seguro. */
export function fearInflation(conf: number, tone: RuleTone, fear: number): number {
  if (tone === "neutral") return conf;
  return conf + 0.25 * clamp01(fear) * (1 - conf);
}

type Bindings = Readonly<Record<string, string>>;

function matchPattern(p: Pattern, f: Fact, b: Bindings): Bindings | undefined {
  if (p.pred !== f.pred || p.args.length !== f.args.length) return undefined;
  let out: Record<string, string> | undefined;
  for (let i = 0; i < p.args.length; i++) {
    const a = p.args[i] as string;
    const val = f.args[i] as string;
    if (a.startsWith("?")) {
      const bound = (out ?? b)[a];
      if (bound === undefined) {
        out ??= { ...b };
        out[a] = val;
      } else if (bound !== val) return undefined;
    } else if (a !== val) return undefined;
  }
  return out ?? b;
}

function instantiate(p: Pattern, b: Bindings): Fact | undefined {
  const args: string[] = [];
  for (const a of p.args) {
    if (a.startsWith("?")) {
      const val = b[a];
      if (val === undefined) return undefined;
      args.push(val);
    } else args.push(a);
  }
  return { pred: p.pred, args };
}

interface Known {
  fact: Fact;
  confidence: number;
  depth: number;
  chain: readonly string[];
  support: readonly string[];
  rival?: { fact: Fact; confidence: number };
}

function* bindings(
  premises: readonly Pattern[],
  at: number,
  facts: readonly Known[],
  b: Bindings,
  used: readonly Known[],
): Generator<{ b: Bindings; used: readonly Known[] }> {
  if (at === premises.length) {
    yield { b, used };
    return;
  }
  const p = premises[at] as Pattern;
  for (const k of facts) {
    const nb = matchPattern(p, k.fact, b);
    if (nb !== undefined) yield* bindings(premises, at + 1, facts, nb, [...used, k]);
  }
}

const groupKey = (f: Fact): string => `${f.pred}(${f.args.slice(0, -1).join(",")})`;

/**
 * Deduce todo lo que `who` puede de `evidence` con `rules`. Devuelve solo conclusiones nuevas
 * (no repite una premisa), ordenadas por confianza y luego por clave. Si el mismo hecho llega por
 * dos caminos, queda el de más confianza; si dos valores exclusivos compiten, queda el más fuerte
 * (lo que el razonador sienta, no lo cierto) y el otro se anota como `rival`.
 */
export function infer(
  evidence: readonly Premise[],
  rules: readonly InferenceRule[],
  who: Reasoner,
): Inference[] {
  const byKey = new Map<string, Known>();
  const evidenceKeys = new Set<string>();
  for (const e of evidence) {
    const key = factKey(e.fact);
    evidenceKeys.add(key);
    const cur = byKey.get(key);
    const c = clamp01(e.confidence);
    if (cur === undefined) {
      byKey.set(key, { fact: e.fact, confidence: c, depth: 0, chain: [], support: [e.ref] });
    } else {
      // Dos fuentes del mismo hecho se refuerzan (sin pasar del tope de la evidencia).
      const merged = Math.min(0.99, 1 - (1 - cur.confidence) * (1 - c));
      byKey.set(key, {
        ...cur,
        confidence: round(merged),
        support: [...new Set([...cur.support, e.ref])].sort(compareStrings),
      });
    }
  }
  const known = new Set(who.rules);
  const usable = rules.filter((r) => known.has(r.id)).sort((a, b) => compareStrings(a.id, b.id));
  const limit = chainLimit(who);
  const exclusiveBest = new Map<string, Known>();

  for (let depth = 1; depth <= limit; depth++) {
    const snapshot = [...byKey.values()].sort((a, b) =>
      compareStrings(factKey(a.fact), factKey(b.fact)),
    );
    let changed = false;
    for (const rule of usable) {
      const rel = effectiveReliability(rule, who);
      for (const { b, used } of bindings(rule.premises, 0, snapshot, {}, [])) {
        const fact = instantiate(rule.conclusion, b);
        if (fact === undefined) continue;
        const key = factKey(fact);
        if (evidenceKeys.has(key)) continue;
        let conf = rel;
        for (const u of used) conf *= u.confidence;
        conf = Math.min(INFERENCE_CAP, fearInflation(conf, rule.tone, who.fear));
        if (conf < INFERENCE_FLOOR) continue;
        const support = [...new Set(used.flatMap((u) => u.support))]
          .sort(compareStrings)
          .slice(0, MAX_SUPPORT);
        const chain = [...new Set([...used.flatMap((u) => u.chain), rule.id])];
        const cand: Known = {
          fact,
          confidence: round(conf),
          depth: 1 + Math.max(...used.map((u) => u.depth)),
          chain,
          support,
        };
        if (rule.exclusive) {
          const g = groupKey(fact);
          const best = exclusiveBest.get(g);
          if (best !== undefined && factKey(best.fact) !== key) {
            if (best.confidence >= cand.confidence) {
              best.rival ??= { fact: cand.fact, confidence: cand.confidence };
              continue;
            }
            byKey.delete(factKey(best.fact));
            cand.rival = { fact: best.fact, confidence: best.confidence };
          }
          if (best === undefined || factKey(best.fact) !== key) exclusiveBest.set(g, cand);
        }
        const cur = byKey.get(key);
        if (cur === undefined || cand.confidence > cur.confidence) {
          byKey.set(key, cand);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  return [...byKey.values()]
    .filter((k) => k.depth > 0)
    .map(
      (k): Inference => ({
        fact: k.fact,
        confidence: k.confidence,
        depth: k.depth,
        chain: k.chain,
        support: k.support,
        ...(k.rival === undefined ? {} : { rival: k.rival }),
      }),
    )
    .sort(
      (a, b) => b.confidence - a.confidence || compareStrings(factKey(a.fact), factKey(b.fact)),
    );
}

/** Cómo lo dice el personaje: cuatro bandas de seguridad. */
export type ConfidenceBand = "convinced" | "likely" | "maybe" | "hunch";

export function confidenceBand(c: number): ConfidenceBand {
  if (c >= 0.7) return "convinced";
  if (c >= 0.45) return "likely";
  if (c >= 0.25) return "maybe";
  return "hunch";
}

export interface Thought {
  readonly fact: Fact;
  readonly band: ConfidenceBand;
  readonly confidence: number;
  readonly support: readonly string[];
  readonly rival?: Fact;
}

/**
 * Lo que sale del comando "pensar sobre X": las conclusiones que tocan al tema (`topic` aparece en
 * sus argumentos), las más seguras primero. Es estructura, no texto: la voz es del narrador.
 */
export function thinkAbout(inferences: readonly Inference[], topic: string, max = 5): Thought[] {
  return inferences
    .filter((i) => i.fact.args.includes(topic))
    .slice(0, max)
    .map((i) => ({
      fact: i.fact,
      band: confidenceBand(i.confidence),
      confidence: i.confidence,
      support: i.support,
      ...(i.rival === undefined ? {} : { rival: i.rival.fact }),
    }));
}

export interface InferenceAccuracy {
  readonly total: number;
  readonly checked: number;
  readonly wrong: number;
  /** Falsas con la confianza de 0.5 o más: el error del que no duda. */
  readonly confidentlyWrong: number;
}

/** Solo para inspector y pruebas: `isTrue` devuelve `undefined` si la verdad no lo decide. */
export function inferenceAccuracy(
  inferences: readonly Inference[],
  isTrue: (f: Fact) => boolean | undefined,
): InferenceAccuracy {
  let checked = 0;
  let wrong = 0;
  let confidentlyWrong = 0;
  for (const i of inferences) {
    const t = isTrue(i.fact);
    if (t === undefined) continue;
    checked++;
    if (!t) {
      wrong++;
      if (i.confidence >= 0.5) confidentlyWrong++;
    }
  }
  return { total: inferences.length, checked, wrong, confidentlyWrong };
}

/** Una cantidad de habilidad o de esquema que hace falta para conocer una regla. */
const unit = z.number().min(0).max(1);

const PatternDef = z.strictObject({
  pred: z.string().regex(/^[a-z][a-z0-9_]*$/),
  args: z.array(z.string().regex(/^(\?[a-z][a-z0-9_]*|[a-z][a-z0-9_.-]*)$/)).min(1),
});

/**
 * Quién conoce la regla: `common` es sentido común de cualquiera; el resto es saber de oficio
 * (nivel mínimo de una habilidad) o de mentalidad (fuerza mínima de un esquema). Basta con una.
 */
const KnownByDef = z.strictObject({
  common: z.boolean().default(false),
  skills: z.array(z.strictObject({ skill: contentId, min: unit })).default([]),
  schemas: z.array(z.strictObject({ schema: contentId, min: unit })).default([]),
});

const variables = (ps: readonly { args: readonly string[] }[]) =>
  new Set(ps.flatMap((p) => p.args.filter((a) => a.startsWith("?"))));

export const InferenceRuleDef = z
  .strictObject({
    id: contentId,
    premises: z.array(PatternDef).min(1),
    conclusion: PatternDef,
    reliability: unit,
    abductive: z.boolean(),
    tone: z.enum(["neutral", "malice", "danger"]),
    exclusive: z.boolean().default(false),
    knownBy: KnownByDef,
  })
  .superRefine((r, ctx) => {
    const bound = variables(r.premises);
    for (const v of variables([r.conclusion])) {
      if (!bound.has(v)) {
        ctx.addIssue({
          code: "custom",
          path: ["conclusion"],
          message: `la variable ${v} no está en ninguna premisa`,
        });
      }
    }
    const k = r.knownBy;
    if (!k.common && k.skills.length === 0 && k.schemas.length === 0) {
      ctx.addIssue({ code: "custom", path: ["knownBy"], message: "nadie la conoce" });
    }
  });
export type InferenceRuleDef = z.infer<typeof InferenceRuleDef>;

export const INFERENCE_RULES = defineContent("inference", InferenceRuleDef, (r) => [
  ...r.knownBy.skills.map((s, i) => ({
    kind: "skills",
    id: s.skill,
    at: `knownBy.skills.${i}.skill`,
  })),
  ...r.knownBy.schemas.map((s, i) => ({
    kind: "schemas",
    id: s.schema,
    at: `knownBy.schemas.${i}.schema`,
  })),
]);

/** La regla sin sus datos de saber, lista para `infer`. */
export const toRule = (d: InferenceRuleDef): InferenceRule => ({
  id: d.id,
  premises: d.premises,
  conclusion: d.conclusion,
  reliability: d.reliability,
  abductive: d.abductive,
  tone: d.tone,
  exclusive: d.exclusive,
});

/** Lo que de alguien decide qué reglas conoce: habilidades 0-1 y fuerza de sus esquemas 0-1. */
export interface RuleKnowers {
  readonly skills: Readonly<Record<string, number>>;
  readonly schemas: Readonly<Record<string, number>>;
}

/** Ids de las reglas que conoce quien tiene este saber y esta mentalidad, ordenados. */
export function knownRules(defs: readonly InferenceRuleDef[], who: RuleKnowers): string[] {
  return defs
    .filter(
      (d) =>
        d.knownBy.common ||
        d.knownBy.skills.some((s) => (who.skills[s.skill] ?? 0) >= s.min) ||
        d.knownBy.schemas.some((s) => (who.schemas[s.schema] ?? 0) >= s.min),
    )
    .map((d) => d.id)
    .sort(compareStrings);
}
