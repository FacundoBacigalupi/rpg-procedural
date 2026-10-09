// Gustos básicos (npc-psychology §16): las preferencias de una persona no se sortean, salen de su
// temperamento, su cuerpo, su cultura y lo que estuvo expuesta a probar. Cada gusto es un hecho
// con origen (`originEventIds`) y se distingue lo innato de lo adquirido por exposición.
//
// Puro: `generateTastes` recibe el catálogo (`TasteDef`, contenido), lo innato, el cuerpo, la cultura
// y la exposición, y devuelve las `Preference`. No escribe nada ni toca el mundo. El cableado a la
// vida (tabla, nacimiento, narrador) es de quien lo llama. Constantes sin calibrar.

import {
  type AgentId,
  contentId,
  defineContent,
  type EventId,
  type Rng,
  z,
} from "../../core/index.ts";
import type { Innate } from "../family/index.ts";
import { TEMPERAMENT_AXES } from "./mind.ts";

export const TasteDef = z.strictObject({
  id: contentId,
  species: contentId,
  /** Dominio: `food.flavor`, `food.dish`, `pastime`, `color`, `music`... */
  domain: contentId,
  name: z.string().min(1),
  /** Cuánto empuja cada eje del temperamento a que guste (negativo: a que se rechace). */
  temperament: z.partialRecord(z.enum(TEMPERAMENT_AXES), z.number().min(-1).max(1)).default({}),
  /**
   * Sentidos del cuerpo que lo tocan: `sentido -> peso` sobre la sensibilidad (0-1, centrada en
   * 0.5). Un peso negativo en `bitter` hace que a quien lo siente más le guste menos.
   */
  body: z.record(contentId, z.number().min(-1).max(1)).default({}),
  /** Gusto que se adquiere: al principio se rechaza y la exposición repetida lo vuelve agrado. */
  acquiredTaste: z.boolean().default(false),
  /** 0-1: cuánto atrae lo raro y lo nuevo (lo lee `curiosity`). */
  novelty: z.number().min(0).max(1).default(0),
  /** Es un pasatiempo en grupo (lo lee `sociability`). */
  social: z.boolean().default(false),
  /** 0-1: cuán corriente es en una comunidad mortal común (lo que se come o se hace en la aldea). */
  common: z.number().min(0).max(1).default(0),
  /** Bienes que lo componen: si una práctica vedada de la comunidad los toca, lo veda. */
  goods: z.array(contentId).default([]),
});
export type TasteDef = z.infer<typeof TasteDef>;
export const TASTES = defineContent("tastes", TasteDef);

/** Un gusto de una persona (la forma de `Preference` de npc-psychology §16). */
export interface Preference {
  readonly domain: string;
  readonly item: string;
  /** -1..1 (las aversiones también). */
  readonly valence: number;
  /** 0-1: cuánto pesa. */
  readonly strength: number;
  readonly originEventIds: readonly EventId[];
  /** La persona a quien está ligado («el té amargo de tu abuela»): quien se lo dio de chico. */
  readonly about?: AgentId;
  /** Gusto adquirido por exposición repetida (té, vino, poesía difícil). */
  readonly acquired: boolean;
}

/** Lo que el cuerpo siente: sensibilidades 0-1 por sentido y lo que no tolera. */
export interface TasteBody {
  readonly sensitivities: Readonly<Record<string, number>>;
  /** Objetos que le caen mal por intolerancia (aversión de cuerpo, no de gusto). */
  readonly intolerances?: readonly string[];
}

/** Lo que la cultura de crianza tiene: `item -> 0..1` de cuán normal es; lo vedado va aparte. */
export interface TasteCulture {
  readonly familiar: Readonly<Record<string, number>>;
  readonly forbidden?: readonly string[];
}

/** Lo que se probó o se vivió con un objeto. */
export interface TasteExposure {
  /** Veces que lo probó o lo hizo. */
  readonly count: number;
  /** Lo conoció en la infancia (comida de consuelo). */
  readonly childhood?: boolean;
  /** -1 (le hizo mal: se enfermó después) a 1 (asociado a algo bueno). */
  readonly outcome?: number;
  /** Los eventos que lo explican (la comida de la abuela, la intoxicación). */
  readonly events?: readonly EventId[];
  /** Quién se lo dio o se lo enseñó de chico (la madre que cocinaba): liga el gusto a esa persona. */
  readonly from?: AgentId;
}

export interface TasteInput {
  readonly innate: Innate;
  readonly body: TasteBody;
  readonly culture: TasteCulture;
  readonly exposure: Readonly<Record<string, TasteExposure>>;
  /** Un evento al que citar los gustos sin otro origen (el nacimiento o la siembra). */
  readonly origin: EventId;
}

/** Valencia o fuerza por debajo de la cual no vale la pena guardar el gusto. */
export const TASTE_MIN_STRENGTH = 0.12;
/** Peso de cada insumo en la valencia. */
export const TASTE_WEIGHTS = {
  temperament: 0.7,
  body: 0.5,
  familiarity: 0.35,
  childhood: 0.3,
  exposure: 0.3,
  novelty: 0.4,
  taboo: 0.45,
  intolerance: 0.6,
  noise: 0.12,
} as const;
/** Veces que hace falta repetir para acostumbrarse del todo. */
export const EXPOSURE_SATURATION = 12;
/** Cuánto pesa en contra, al principio, un gusto que se adquiere. */
export const ACQUIRED_PENALTY = 0.5;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** Cuánto gusta algo por pura afinidad de temperamento, -1..1. */
export function temperamentPull(def: TasteDef, innate: Innate): number {
  let s = 0;
  for (const axis of TEMPERAMENT_AXES) s += (def.temperament[axis] ?? 0) * (innate[axis] ?? 0);
  s += def.novelty * (innate["curiosity"] ?? 0);
  if (def.social) s += 0.5 * (innate["sociability"] ?? 0);
  return clamp(s, -1, 1);
}

/** Cuánto empuja el cuerpo, -1..1: sensibilidad centrada en 0.5 por el peso del sentido. */
export function bodyPull(def: TasteDef, body: TasteBody): number {
  let s = 0;
  for (const [sense, w] of Object.entries(def.body)) {
    s += w * ((body.sensitivities[sense] ?? 0.5) - 0.5) * 2;
  }
  return clamp(s, -1, 1);
}

/**
 * Los gustos de una persona. Un objeto entra al repertorio si la cultura lo tiene (`familiar > 0`),
 * lo vedó, o lo probó alguna vez: lo que nunca conoció no le gusta ni le disgusta. El ruido sale de
 * `rng.fork("taste", id)`, así agregar un objeto al catálogo no mueve los demás gustos.
 */
export function generateTastes(
  defs: readonly TasteDef[],
  input: TasteInput,
  rng: Rng,
): Preference[] {
  const out: Preference[] = [];
  const intolerant = new Set(input.body.intolerances ?? []);
  const forbidden = new Set(input.culture.forbidden ?? []);
  for (const def of defs) {
    const familiar = input.culture.familiar[def.id] ?? 0;
    const exp = input.exposure[def.id];
    const known = familiar > 0 || forbidden.has(def.id) || (exp?.count ?? 0) > 0;
    if (!known) continue;

    const w = TASTE_WEIGHTS;
    const innatePart =
      w.temperament * temperamentPull(def, input.innate) + w.body * bodyPull(def, input.body);
    const reps = clamp((exp?.count ?? 0) / EXPOSURE_SATURATION, 0, 1);
    let valence = innatePart + w.familiarity * familiar;
    // Gusto que se adquiere: empieza rechazado y la repetición lo deshace.
    if (def.acquiredTaste) valence -= ACQUIRED_PENALTY * (1 - reps);
    // Mera exposición: lo conocido gusta más, hasta donde el resultado no lo desmienta.
    let exposurePart = 0;
    if (exp) {
      const outcome = exp.outcome ?? 0.3;
      exposurePart = w.exposure * reps * outcome;
      if (exp.childhood) exposurePart += w.childhood * Math.max(0, outcome + 0.5);
      if (outcome < 0) exposurePart += outcome * 0.8; // lo que hizo mal da asco, repita o no
    }
    valence += exposurePart;
    if (forbidden.has(def.id)) valence -= w.taboo;
    if (intolerant.has(def.id)) valence -= w.intolerance;
    valence += rng.fork("taste", def.id).normal(0, w.noise);
    valence = clamp(valence, -1, 1);

    const strength = clamp(
      Math.abs(valence) * (0.6 + 0.4 * Math.max(reps, familiar, exp?.childhood ? 1 : 0)),
      0,
      1,
    );
    if (strength < TASTE_MIN_STRENGTH) continue;

    const acquired =
      (def.acquiredTaste && reps >= 0.5 && valence > 0) ||
      (exp !== undefined && Math.abs(exposurePart) > Math.abs(innatePart) && exp.count > 0);
    out.push({
      domain: def.domain,
      item: def.id,
      valence: round(valence),
      strength: round(strength),
      originEventIds: exp?.events?.length ? [...exp.events] : [input.origin],
      acquired,
      // Solo lo bueno de la infancia queda ligado a quien lo dio: el recuerdo cálido.
      ...(exp?.childhood && exp.from !== undefined && valence > 0 ? { about: exp.from } : {}),
    });
  }
  return out;
}

/** Lo que el narrador puede decir de un gusto (el personaje lo sabe de sí). */
export interface TasteMention {
  readonly item: string;
  readonly domain: string;
  readonly name: string;
  readonly stance: "loves" | "likes" | "dislikes" | "loathes";
  /** A quién le recuerda, si el gusto viene de una persona. */
  readonly about?: AgentId;
}

/** Los gustos que vale la pena mencionar, los más fuertes primero (desempate por id). */
export function mentionableTastes(
  prefs: readonly Preference[],
  defs: readonly TasteDef[],
  limit = 3,
  minStrength = 0.4,
): TasteMention[] {
  const names = new Map(defs.map((d) => [d.id, d.name]));
  return prefs
    .filter((p) => p.strength >= minStrength && names.has(p.item))
    .sort((a, b) => b.strength - a.strength || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0))
    .slice(0, limit)
    .map((p) => ({
      item: p.item,
      domain: p.domain,
      name: names.get(p.item) as string,
      stance:
        p.valence >= 0.6
          ? "loves"
          : p.valence > 0
            ? "likes"
            : p.valence <= -0.6
              ? "loathes"
              : "dislikes",
      ...(p.about === undefined ? {} : { about: p.about }),
    }));
}
