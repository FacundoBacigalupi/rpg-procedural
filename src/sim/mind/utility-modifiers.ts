// Modificadores de la utilidad (npc-psychology §7, Fase 3 (g)): lo que cambia el valor de una
// candidata sin cambiar lo que cree del mundo. Todos son puros y SUMAN al ánimo (`mood`) o ajustan
// la contribución de placer; sin insumos (sin memorias, hábitos, condiciones, sanciones) devuelven
// las mismas candidatas, así cablearlos no mueve nada hasta que el estado los alimente.
//
//   memorias   lo que le dejó tratar con esa persona (valencia × intensidad × saliencia de hoy ×
//              fe en el recuerdo), solo para los verbos de trato
//   hábitos    lo que repite ya tira (fuerza del hábito asentado de ese verbo)
//   disonancia actuar contra un valor propio (contribución negativa × su peso) pesa como culpa
//   evitación  una condición (trauma, culpa) disparada por la persona castiga acercarse y empuja
//              a alejarse (`avoidance`)
//   placer     el entumecimiento achica lo que da el gusto (`pleasureUtility`)
//   sanción    el castigo creído de romper una norma conocida (`sanctionWeight`) lo calcula quien llama
//
// Quedan fuera hasta tener insumos en el estado: `prophecyPull`, la opinión ajena de habilidad y
// `groupBias`.

import type { AgentId, Tick } from "../../core/index.ts";
import { avoidance, type MentalState, pleasureUtility } from "./conditions.ts";
import { type HabitDef, type Habits, habitStrength } from "./habits.ts";
import { type Memories, memoriesAbout } from "./memory.ts";
import type { ValueId } from "./mind.ts";
import type { Candidate, Drives } from "./utility.ts";

/** Cuánto empuja (±) el recuerdo de tratar con alguien, a saliencia, intensidad y fe 1 (sin calibrar). */
export const MEMORY_PULL = 0.3;
/** Cuánto empuja un hábito de fuerza 1 (sin calibrar). */
export const HABIT_PULL = 0.15;
/** Culpa de actuar contra un valor de peso 1 con contribución -1 (sin calibrar). */
export const DISSONANCE_GUILT = 0.4;
/** Cuánto castiga la evitación 1 acercarse al estímulo (y premia alejarse). */
export const AVOIDANCE_WEIGHT = 0.6;
/** Verbos de trato con otra persona: ahí pesan las memorias de ella. */
export const DEALING_VERBS: ReadonlySet<string> = new Set([
  "speak",
  "trade",
  "give",
  "consult",
  "tend",
]);

const AVOID_PREFIX = "avoid:";
const r = (x: number) => Math.round(x * 1e6) / 1e6;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export interface ModifierInputs {
  readonly now: Tick;
  readonly memories?: Memories | undefined;
  /** Fuerza (0-1) del hábito asentado de cada verbo, ya enfriada (`verbHabits`). */
  readonly habits?: Readonly<Record<string, number>>;
  /** Valores normalizados (`Drives.values`) para la disonancia. */
  readonly values?: Drives["values"] | undefined;
  readonly mental?: MentalState | undefined;
  /** Castigo creído (0-1) de hacer esa candidata, p. ej. `sanctionWeight(...).penalty`. */
  readonly sanction?: (c: Candidate) => number;
  /** Peso del castigo en la utilidad (1 = igual que una ganancia de 1). */
  readonly sanctionScale?: number;
}

/** Fuerza de hábito por verbo: el mayor entre los hábitos asentados que ese verbo alimenta. */
export function verbHabits(
  defs: readonly HabitDef[],
  habits: Habits | undefined,
  now: Tick,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const def of defs) {
    const hold = habits?.holds[def.id];
    const s = habitStrength(hold, def, now);
    if (s < def.settledAt) continue;
    for (const verb of def.verbs) out[verb] = Math.max(out[verb] ?? 0, s);
  }
  return out;
}

/** Lo que el trato con `who` le dejó, -1..1 por MEMORY_PULL: promedio de sus memorias ponderadas. */
export function memoryPull(memories: Memories | undefined, who: AgentId, now: Tick): number {
  let sum = 0;
  let weight = 0;
  for (const { memory: m, salience } of memoriesAbout(memories, who, now)) {
    const w = m.intensity * salience * m.confidence;
    sum += m.valence * w;
    weight += w;
  }
  if (weight === 0) return 0;
  return r(MEMORY_PULL * clamp(sum / weight, -1, 1) * Math.min(1, weight));
}

/** Culpa (>= 0) de actuar contra los propios valores: Σ peso × -contribución negativa. */
export function dissonanceOf(c: Candidate, values: Drives["values"] | undefined): number {
  if (!values) return 0;
  let guilt = 0;
  for (const [drive, amount] of Object.entries(c.contributes)) {
    if (amount >= 0) continue;
    const w = (values as Readonly<Record<string, number | undefined>>)[drive as ValueId] ?? 0;
    guilt += w * -amount;
  }
  return r(DISSONANCE_GUILT * guilt);
}

const asAgent = (target: string | undefined): AgentId | undefined =>
  target?.startsWith("agent:") ? (target as AgentId) : undefined;

/** El ajuste total (suma al ánimo) de una candidata. */
export function moodShift(c: Candidate, i: ModifierInputs): number {
  let shift = 0;
  const who = asAgent(c.target);
  if (who && DEALING_VERBS.has(c.verb)) shift += memoryPull(i.memories, who, i.now);
  shift += HABIT_PULL * (i.habits?.[c.verb] ?? 0);
  shift -= dissonanceOf(c, i.values);
  if (who && i.mental) {
    const dread = avoidance(i.mental, { who });
    if (dread > 0) shift += AVOIDANCE_WEIGHT * dread * (c.id.startsWith(AVOID_PREFIX) ? 1 : -1);
  }
  if (i.sanction) shift -= (i.sanctionScale ?? 1) * i.sanction(c);
  return r(shift);
}

/** El placer de la candidata tras el entumecimiento (`pleasureUtility`); sin condiciones, igual. */
function numbed(c: Candidate, mental: MentalState | undefined): Candidate {
  const pleasure = c.contributes["pleasure"];
  if (pleasure === undefined || !mental) return c;
  const after = pleasureUtility(pleasure, mental);
  return after === pleasure ? c : { ...c, contributes: { ...c.contributes, pleasure: after } };
}

/** Aplica todos los modificadores; devuelve la misma candidata si no cambia nada. */
export function modifyCandidates(candidates: readonly Candidate[], i: ModifierInputs): Candidate[] {
  return candidates.map((raw) => {
    const c = numbed(raw, i.mental);
    const shift = moodShift(c, i);
    return shift === 0 ? c : { ...c, mood: r((c.mood ?? 0) + shift) };
  });
}

/** Verbos que toman algo ajeno: solo ellos pueden chocar con un tabú sobre un bien. */
export const TAKING_VERBS: ReadonlySet<string> = new Set(["take"]);

/**
 * El bien que nombra una candidata que toma algo (`take:agent:ana+pan` → `pan`), o `undefined` si el
 * verbo no toma o no nombra una cosa (hoy `take` no ofrece textos: nadie lo nombra todavía).
 */
export function takenGood(c: Candidate): string | undefined {
  if (!TAKING_VERBS.has(c.verb)) return undefined;
  let rest = c.id.slice(c.verb.length + 1);
  if (c.target !== undefined && rest.startsWith(c.target)) rest = rest.slice(c.target.length);
  rest = rest.replace(/^\+/, "");
  return rest === "" ? undefined : rest;
}

/**
 * El callback `sanction` de `ModifierInputs`: el castigo creído (0-1) de tomar el bien que nombra
 * la candidata, según `weigh` (p. ej. `sanctionWeight(identidad, religión, bien).penalty`). Sin
 * bien nombrado, nada; no hay RNG.
 */
export function sanctionFor(weigh: (good: string) => number): (c: Candidate) => number {
  return (c) => {
    const good = takenGood(c);
    return good === undefined ? 0 : weigh(good);
  };
}
