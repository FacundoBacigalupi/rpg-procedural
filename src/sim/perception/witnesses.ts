// Testigos de un evento (perception §12): quién de los presentes lo percibe, con presupuesto
// determinista y detalle según el tier del agente. Pura: el que arma los observadores (atención,
// agudeza, familiaridad) es el juego; acá solo se elige a los candidatos y se baja la resolución.

import type { Rng } from "../../core/index.ts";
import {
  type Medium,
  type Observer,
  type Percept,
  type PerceptField,
  type PerceptKey,
  perceive,
  type Stimulus,
} from "./percept.ts";

/** Tier de agente (simulation §4): 0 estadística … 4 conectado al jugador. */
export type AgentTier = 0 | 1 | 2 | 3 | 4;

/** Quien puede presenciar algo: sus sentidos y su tier. */
export interface WitnessCandidate {
  readonly observer: Observer;
  readonly tier: AgentTier;
}

/** Cuántos testigos evalúa un evento como máximo (sin calibrar; el resto queda como multitud). */
export const MAX_WITNESSES = 8;

/** Datos que conserva un testigo de tier 2: una tirada global, sin figura ni ropa. */
const COARSE_KEYS: readonly PerceptKey[] = ["presence", "identity", "action", "words"];

/** Un tier 2 percibe con detalle global: nada / vago / identificado, sin figura ni ropa. */
export function coarsen(p: Percept): Percept {
  const fields: Partial<Record<PerceptKey, PerceptField>> = {};
  for (const k of COARSE_KEYS) {
    const f = p.fields[k];
    if (f !== undefined) fields[k] = f;
  }
  const identity = fields.identity;
  const detail =
    identity !== undefined && identity.value !== null
      ? "identified"
      : fields.action !== undefined || fields.words !== undefined
        ? "clear"
        : "vague";
  return { ...p, detail, fields };
}

/**
 * Los candidatos que se evalúan: solo tier 2+ (los de abajo son agregado), del mismo hex que la
 * fuente, sin los excluidos, y con tope: primero los de tier más alto, después por id (orden
 * estable; el desempate no depende del orden de entrada).
 */
export function pickWitnesses(
  stimulus: Stimulus,
  candidates: readonly WitnessCandidate[],
  budget: number = MAX_WITNESSES,
): WitnessCandidate[] {
  const excluded = new Set(stimulus.exclude ?? []);
  return candidates
    .filter(
      (w) => w.tier >= 2 && w.observer.at.hex === stimulus.at.hex && !excluded.has(w.observer.id),
    )
    .sort((a, b) => (a.tier !== b.tier ? b.tier - a.tier : a.observer.id < b.observer.id ? -1 : 1))
    .slice(0, Math.max(0, budget));
}

/** Lo que perciben los testigos de un estímulo, con el detalle de su tier. */
export function witnessStimulus(
  stimulus: Stimulus,
  candidates: readonly WitnessCandidate[],
  medium: Medium,
  rng: Rng,
  budget: number = MAX_WITNESSES,
): Percept[] {
  const picked = pickWitnesses(stimulus, candidates, budget);
  const tierOf = new Map(picked.map((w) => [w.observer.id, w.tier]));
  const raw = perceive(
    stimulus,
    picked.map((w) => w.observer),
    medium,
    rng,
  );
  return raw.map((p) => ((tierOf.get(p.observer) ?? 2) >= 3 ? p : coarsen(p)));
}
