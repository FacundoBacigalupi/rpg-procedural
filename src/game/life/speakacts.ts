// Candidatas `speak` que declaran su acto (npc-c5b, dialogue §2): saludar a un conocido con quien
// no trata hace tiempo y preguntar a alguien por una persona querida de la que no sabe dónde está,
// con ánimo desde afecto y familiaridad propios. Puro, sin RNG ni verdad: recibe lo que el NPC cree.

import type { EntityRef, Tick } from "../../core/index.ts";
import { type Candidate, STAKES_RISK } from "../../sim/index.ts";

/** Opt-in de `decide`: ofrecer saludos y preguntas como candidatas con acto declarado. */
export interface SpeakActsOptions {
  /** Familiaridad mínima (0-1) para saludar o preguntar. */
  readonly minFamiliarity: number;
  /** Segundos sin trato desde los que saludar tiene sentido. */
  readonly quietSeconds: number;
  /** Peso del ánimo con familiaridad y afecto al máximo. */
  readonly weight: number;
  /** Chance creída de que la conversación salga (0-1). */
  readonly chance: number;
}

/** Un conocido tal como lo cree y lo siente el NPC. */
export interface Acquaintance {
  readonly id: string;
  readonly familiarity: number;
  readonly affection: number;
  /** Último momento en que su trato con él cambió (relación al día). */
  readonly updated: Tick;
  /** Si tiene una creencia de dónde está. */
  readonly whereaboutsKnown: boolean;
}

const r = (x: number) => Math.round(x * 1e6) / 1e6;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const warmth = (a: Acquaintance) => 0.5 * clamp01(a.familiarity) + 0.5 * clamp01(a.affection);

/**
 * A lo sumo una candidata `speak:<persona>` por conocido: preguntar por el más querido de quien no
 * sabe dónde está (si el interlocutor no es él), o si no, saludar a quien no ve hace `quietSeconds`.
 * Orden fijo por id; sin conocidos que alcancen la familiaridad, nada.
 */
export function speakActCandidates(
  people: readonly Acquaintance[],
  now: Tick,
  o: SpeakActsOptions,
): Candidate[] {
  const close = people
    .filter((p) => p.familiarity >= o.minFamiliarity)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const missed = close
    .filter((p) => !p.whereaboutsKnown && p.affection > 0)
    .sort((a, b) => warmth(b) - warmth(a) || (a.id < b.id ? -1 : 1))[0];
  const out: Candidate[] = [];
  for (const p of close) {
    const base = {
      id: `speak:${p.id}`,
      verb: "speak",
      target: p.id as unknown as EntityRef,
      contributes: { social: 0.3 },
      chance: o.chance,
      loss: STAKES_RISK.none.loss,
    } as const;
    if (missed && missed.id !== p.id && p.affection >= 0) {
      out.push({
        ...base,
        mood: r(o.weight * warmth(missed)),
        act: { kind: "ask", about: missed.id as unknown as EntityRef },
      });
    } else if (now - p.updated >= o.quietSeconds && p.affection > -0.2) {
      out.push({ ...base, mood: r(o.weight * warmth(p)), act: { kind: "greet" } });
    }
  }
  return out;
}
