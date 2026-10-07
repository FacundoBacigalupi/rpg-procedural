// Referencias (actions §4): el parser no conoce entidades, produce descripciones ("el viejo del
// puesto de té", "mi padre"); acá se resuelven contra lo que el actor conoce, nunca contra la
// verdad. Cuatro salidas: única (se usa), ambigua (la sim arma la aclaración con los rasgos que
// el actor percibió y el LLM solo la redacta), desconocida (el actor no tiene nada que encaje) y,
// desde la Fase 2, fantasma.
//
// Lo conocido llega armado de afuera (`KnownEntity`): en la Fase 1 lo arma el juego con la gente y
// los lugares de la aldea; cuando lleguen las creencias (information, `sim/knowledge`), saldrá de
// ellas con sus `via`.
//
// El parecido es por palabras, sin el LLM: se normalizan (minúsculas, sin tildes, sin plural ni
// vocal final, así "vieja" y "viejos" dan "viej") y se descartan las vacías ("el", "de", "mi").

import { type BeliefId, compareIds, type EntityRef } from "../../core/index.ts";
import type { EntityKind, RefDescription } from "./intent.ts";

/** Algo que el actor conoce, tal como lo conoce. */
export interface KnownEntity {
  readonly ref: EntityRef;
  readonly kind: EntityKind;
  /** Cómo lo nombra el actor: su nombre, o lo que es ("Wu", "el bosque"). El primero es el rótulo. */
  readonly names: readonly string[];
  /** Rasgos que el actor percibió o recuerda: "viejo", "puesto de té", "pelo gris". */
  readonly features: readonly string[];
  /** Relaciones que el actor conoce: "padre" de "self", "hermano" de `agent:7`. */
  readonly relations: readonly { readonly rel: string; readonly of: EntityRef | "self" }[];
  /** Lo percibe ahora: lo que está en la escena pesa más que lo que recuerda (§4). */
  readonly present: boolean;
  /** Dónde cree el actor que está una persona (hex): para ir a buscarla antes de hablarle. */
  readonly at?: number | undefined;
  /** Los hexes que cubre un lugar conocido: para saber a cuál ir. */
  readonly hexes?: readonly number[] | undefined;
  /** Las creencias de donde sale (vacío hasta que llegue `sim/knowledge`). */
  readonly via: readonly BeliefId[];
}

export interface RefCandidate {
  readonly ref: EntityRef;
  readonly score: number;
  readonly via: readonly BeliefId[];
}

/** Lo que distingue a un candidato de los otros, para la pregunta de aclaración. */
export interface ClarifyOption {
  readonly ref: EntityRef;
  readonly label: string;
  /** Nombres y rasgos que los otros candidatos no tienen. */
  readonly distinguishing: readonly string[];
  readonly present: boolean;
}

export type ResolvedRef =
  | {
      readonly status: "unique";
      readonly desc: RefDescription;
      readonly chosen: EntityRef;
      readonly candidates: readonly RefCandidate[];
    }
  | {
      readonly status: "ambiguous";
      readonly desc: RefDescription;
      readonly candidates: readonly RefCandidate[];
      readonly clarify: readonly ClarifyOption[];
    }
  | { readonly status: "unknown"; readonly desc: RefDescription; readonly candidates: readonly [] };

/** Cuánto pesa estar en la escena frente a recordar. */
export const PRESENT_BONUS = 0.25;
/** Dos candidatos a menos de esto del mejor son ambiguos. */
export const AMBIGUITY_GAP = 0.2;

const STOPWORDS = new Set([
  "a",
  "al",
  "con",
  "de",
  "del",
  "el",
  "en",
  "esa",
  "ese",
  "eso",
  "esta",
  "este",
  "la",
  "las",
  "lo",
  "los",
  "mi",
  "mis",
  "su",
  "sus",
  "tu",
  "tus",
  "que",
  "un",
  "una",
  "unos",
  "unas",
  "y",
]);

/** Las palabras con contenido de un texto, normalizadas. */
export function refTokens(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9ñ]+/u)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .map(stem);
}

function stem(w: string): string {
  let s = w;
  if (s.length > 3 && s.endsWith("es")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s")) s = s.slice(0, -1);
  if (s.length > 3 && /[aeo]$/.test(s)) s = s.slice(0, -1);
  return s;
}

/** Las palabras con que el actor podría nombrar a `e`: nombres, rasgos, relaciones y de quién. */
function bag(e: KnownEntity, byRef: ReadonlyMap<EntityRef, KnownEntity>): Set<string> {
  const out = new Set<string>();
  const add = (s: string) => {
    for (const t of refTokens(s)) out.add(t);
  };
  e.names.forEach(add);
  e.features.forEach(add);
  for (const r of e.relations) {
    add(r.rel);
    if (r.of !== "self") byRef.get(r.of)?.names.forEach(add);
  }
  return out;
}

/** Resuelve una descripción contra lo que el actor conoce. Determinista: no tira. */
export function resolveRef(desc: RefDescription, known: readonly KnownEntity[]): ResolvedRef {
  const byRef = new Map(known.map((k) => [k.ref, k]));
  // La relación estructurada filtra: "mi padre" es alguien que el actor sabe que es su padre.
  let relTo: EntityRef | "self" | undefined;
  if (desc.relation) {
    if (desc.relation.to === "self") relTo = "self";
    else {
      const inner = resolveRef(desc.relation.to, known);
      if (inner.status !== "unique") return { status: "unknown", desc, candidates: [] };
      relTo = inner.chosen;
    }
  }
  const relWord = desc.relation ? refTokens(desc.relation.rel) : [];
  const query = [...new Set([...refTokens(desc.text), ...desc.features.flatMap(refTokens)])];

  const scored: { e: KnownEntity; score: number }[] = [];
  for (const e of known) {
    if (desc.kind !== undefined && e.kind !== desc.kind) continue;
    if (relTo !== undefined) {
      const ok = e.relations.some(
        (r) =>
          r.of === relTo &&
          (relWord.length === 0 || refTokens(r.rel).some((t) => relWord.includes(t))),
      );
      if (!ok) continue;
    }
    const words = bag(e, byRef);
    const hits = query.filter((t) => words.has(t)).length;
    // Con relación, alcanza la relación; sin ella, algo de la descripción tiene que encajar.
    if (hits === 0 && relTo === undefined) continue;
    const coverage = query.length === 0 ? 1 : hits / query.length;
    scored.push({ e, score: coverage + (e.present ? PRESENT_BONUS : 0) });
  }
  if (scored.length === 0) return { status: "unknown", desc, candidates: [] };

  scored.sort((a, b) => b.score - a.score || compareIds(a.e.ref, b.e.ref));
  const candidates = scored.map(({ e, score }) => ({ ref: e.ref, score, via: e.via }));
  const best = (scored[0] as (typeof scored)[number]).score;
  const close = scored.filter((s) => best - s.score < AMBIGUITY_GAP);
  if (close.length === 1) {
    return {
      status: "unique",
      desc,
      chosen: (close[0] as (typeof close)[number]).e.ref,
      candidates,
    };
  }
  return { status: "ambiguous", desc, candidates, clarify: clarifyOptions(close.map((s) => s.e)) };
}

/** Cada candidato con lo que lo distingue de los otros. */
export function clarifyOptions(es: readonly KnownEntity[]): ClarifyOption[] {
  return es.map((e) => {
    const others = es.filter((o) => o !== e);
    const shared = (s: string) =>
      others.some((o) => [...o.names, ...o.features].some((x) => sameWords(x, s)));
    return {
      ref: e.ref,
      label: e.names[0] ?? e.features[0] ?? e.ref,
      distinguishing: [...e.names, ...e.features].filter((s) => !shared(s)),
      present: e.present,
    };
  });
}

function sameWords(a: string, b: string): boolean {
  return refTokens(a).join(" ") === refTokens(b).join(" ");
}
