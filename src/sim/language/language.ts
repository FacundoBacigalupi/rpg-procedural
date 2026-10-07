// Una lengua generada (language §1-§3, §14): fonología sorteada de un inventario con pesos, raíces
// para cada concepto básico y compuestos que se arman cuando hacen falta. Todo sale del seed y del
// contenido, así que no se guarda: se rehace igual (language, Tests: determinismo).
//
// Las raíces se generan todas juntas en el orden de los conceptos, para evitar choques de forma
// sin que importe en qué orden se pidieron después; los compuestos son una función de sus partes.

import { compareStrings, type Random, Rng, type Seed } from "../../core/index.ts";
import type { ConceptDef, LanguageSpec } from "./defs.ts";

/** Una sílaba como ids de fonema: lo que se pronuncia, sin letras. */
export interface Syllable {
  readonly onset?: string;
  readonly nucleus: string;
  readonly coda?: string;
}

export interface Phonology {
  readonly consonants: readonly string[];
  readonly vowels: readonly string[];
  /** Con qué letras se escribe cada fonema: fija por lengua. */
  readonly romanization: Readonly<Record<string, string>>;
  readonly templates: readonly {
    readonly onset: boolean;
    readonly coda: boolean;
    readonly weight: number;
  }[];
  /** Las consonantes que pueden cerrar una sílaba. */
  readonly codas: readonly string[];
}

export type LexemeOrigin =
  | { readonly kind: "root" }
  | { readonly kind: "compound"; readonly parts: readonly string[] };

export interface Lexeme {
  /** `<lengua>:<concepto>` para una raíz y `<lengua>:<a>+<b>` para un compuesto. */
  readonly id: string;
  readonly language: string;
  readonly form: readonly Syllable[];
  /** La forma romanizada, en minúscula. */
  readonly text: string;
  /** Los conceptos que significa, en orden de lectura en castellano (modificador y cabeza). */
  readonly gloss: readonly string[];
  readonly origin: LexemeOrigin;
}

/** Con mayúscula inicial, como se escribe un nombre propio. */
export function capitalize(s: string): string {
  return s.length === 0 ? s : (s[0] as string).toUpperCase() + s.slice(1);
}

/** Sortea `count` fonemas sin repetir, con probabilidad proporcional al peso. */
function pickWeighted<T extends { readonly weight: number }>(
  rng: Random,
  items: readonly T[],
  count: number,
): T[] {
  const pool = [...items];
  const out = new Set<T>();
  while (out.size < count && pool.length > 0) {
    const i = rng.weighted(pool.map((p) => p.weight));
    out.add(pool.splice(i, 1)[0] as T);
  }
  // Orden del contenido, no del sorteo: que el inventario no dependa de cómo se tiró.
  return items.filter((i) => out.has(i));
}

export function generatePhonology(spec: LanguageSpec, rng: Rng): Phonology {
  const consonants = pickWeighted(
    rng.fork("consonants"),
    spec.consonants,
    rng.fork("consonants", "count").int(spec.consonantCount.min, spec.consonantCount.max),
  );
  const vowels = pickWeighted(
    rng.fork("vowels"),
    spec.vowels,
    rng.fork("vowels", "count").int(spec.vowelCount.min, spec.vowelCount.max),
  );
  const wantsCodas = spec.templates.some((t) => t.coda);
  if (wantsCodas && !consonants.some((c) => c.coda)) {
    // Una lengua con sílabas cerradas necesita con qué cerrarlas: la final más frecuente.
    const best = spec.consonants
      .filter((c) => c.coda)
      .reduce((a, b) => (b.weight > a.weight ? b : a));
    consonants.push(best);
  }
  const romanization: Record<string, string> = {};
  for (const p of [...consonants, ...vowels]) romanization[p.id] = p.rom;
  const codas = consonants.filter((c) => c.coda).map((c) => c.id);
  return {
    consonants: consonants.map((c) => c.id),
    vowels: vowels.map((v) => v.id),
    romanization,
    templates: spec.templates.filter((t) => !t.coda || codas.length > 0),
    codas,
  };
}

function romanize(p: Phonology, form: readonly Syllable[]): string {
  const letters = (id: string | undefined): string =>
    id === undefined ? "" : (p.romanization[id] ?? "");
  return form.map((s) => letters(s.onset) + letters(s.nucleus) + letters(s.coda)).join("");
}

function syllable(p: Phonology, spec: LanguageSpec, rng: Random): Syllable {
  const t = p.templates[
    rng.weighted(p.templates.map((x) => x.weight))
  ] as Phonology["templates"][number];
  const weightOf = (id: string): number =>
    [...spec.consonants, ...spec.vowels].find((x) => x.id === id)?.weight ?? 1;
  const choose = (ids: readonly string[]): string => ids[rng.weighted(ids.map(weightOf))] as string;
  const onset = t.onset ? choose(p.consonants) : undefined;
  const nucleus = choose(p.vowels);
  const coda = t.coda ? choose(p.codas) : undefined;
  return {
    ...(onset === undefined ? {} : { onset }),
    nucleus,
    ...(coda === undefined ? {} : { coda }),
  };
}

export class Language {
  readonly id: string;
  readonly name: string;
  readonly spec: LanguageSpec;
  readonly phonology: Phonology;
  readonly concepts: ReadonlyMap<string, ConceptDef>;
  readonly #roots = new Map<string, Lexeme>();

  constructor(
    spec: LanguageSpec,
    phonology: Phonology,
    concepts: readonly ConceptDef[],
    roots: readonly Lexeme[],
  ) {
    this.id = spec.id;
    this.name = spec.name;
    this.spec = spec;
    this.phonology = phonology;
    this.concepts = new Map(concepts.map((c) => [c.id, c]));
    for (const r of roots) this.#roots.set(r.gloss[0] as string, r);
  }

  /** Las raíces, en el orden de los conceptos. */
  roots(): Lexeme[] {
    return [...this.#roots.values()];
  }

  root(concept: string): Lexeme {
    const r = this.#roots.get(concept);
    if (!r) throw new RangeError(`la lengua ${this.id} no tiene el concepto ${concept}`);
    return r;
  }

  /**
   * Un compuesto de conceptos dados en orden de lectura (modificador, cabeza): la lengua los pone
   * en su orden (`compound.headFirst`). Es función de las partes, así que no importa cuándo se pida.
   */
  compound(concepts: readonly string[]): Lexeme {
    if (concepts.length === 1) return this.root(concepts[0] as string);
    const parts = concepts.map((c) => this.root(c));
    const ordered = this.spec.compound.headFirst ? [...parts].reverse() : parts;
    const form = ordered.flatMap((p) => p.form);
    return {
      id: `${this.id}:${concepts.join("+")}`,
      language: this.id,
      form,
      text: romanize(this.phonology, form),
      gloss: concepts,
      origin: { kind: "compound", parts: parts.map((p) => p.id) },
    };
  }

  /** Cómo se dicen en castellano los conceptos de una forma (la glosa del inspector). */
  glossOf(lexeme: Pick<Lexeme, "gloss">): string {
    return lexeme.gloss.map((g) => this.concepts.get(g)?.es ?? g).join(" ");
  }
}

/** La lengua de este seed: fonología, y una raíz para cada concepto sin repetir forma. */
export function generateLanguage(
  seed: Seed,
  spec: LanguageSpec,
  concepts: readonly ConceptDef[],
): Language {
  const rng = Rng.root(seed).fork("lang", spec.id);
  const phonology = generatePhonology(spec, rng.fork("phonology"));
  const sorted = [...concepts].sort((a, b) => compareStrings(a.id, b.id));
  const taken = new Set<string>();
  const roots: Lexeme[] = [];
  for (const c of sorted) {
    const base = rng.fork("lexeme", c.id);
    // Cada intento es su propio flujo; si no sale una forma libre en varios, la raíz crece.
    for (let attempt = 0; ; attempt++) {
      const r = base.fork(attempt);
      const length = 1 + r.weighted(spec.rootSyllables) + Math.floor(attempt / 8);
      const form = Array.from({ length }, () => syllable(phonology, spec, r));
      const text = romanize(phonology, form);
      if (taken.has(text)) continue;
      taken.add(text);
      roots.push({
        id: `${spec.id}:${c.id}`,
        language: spec.id,
        form,
        text,
        gloss: [c.id],
        origin: { kind: "root" },
      });
      break;
    }
  }
  return new Language(spec, phonology, sorted, roots);
}
