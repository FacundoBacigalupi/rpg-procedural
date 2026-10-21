// Pertenencia (npc-psychology §13): necesidad lenta, de meses. No se come: se sostiene con vínculos
// (la casa, los padres, la pareja, la aldea). Núcleo puro: de lo que la persona tiene alrededor
// sale un objetivo, el nivel se acerca despacio y el déficit lleva sus causas (aislamiento,
// orfandad). Nunca es una variable suelta: cada fuente guarda su fuerza y su peso.

import type { EventId, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";

export type BelongingSourceKind = "family" | "village";
export type DeficitReason = "isolation" | "orphan";

export interface BelongingSource {
  readonly kind: BelongingSourceKind;
  /** 0-1: densidad de relaciones y años. */
  readonly strength: number;
  /** Cuánto de la pertenencia aporta esta fuente. */
  readonly weight: number;
}

export interface BelongingState {
  /** 0-1: cuánta pertenencia siente. El déficit es `1 - level`. */
  readonly level: number;
  readonly sources: readonly BelongingSource[];
  readonly reasons: readonly DeficitReason[];
  /** Hay déficit alto vigente (con histéresis, para no repetir el aviso cada día). */
  readonly inDeficit: boolean;
  readonly updatedAt: Tick;
  readonly originEventId: EventId;
}

/** La pertenencia por persona (opt-in `LifeOptions.belonging`). */
export const BELONGING = table<BelongingState>("mind.belonging");

/** Constantes sin calibrar. */
export const BELONGING_TUNING = {
  /** Convivientes de la casa que dan la compañía plena. */
  fullHousemates: 4,
  /** Aportes a la fuerza de la familia, además de los convivientes. */
  spouseBonus: 0.25,
  parentBonus: 0.15,
  /** Años en la aldea para el arraigo pleno. */
  rootYears: 10,
  weights: { family: 0.65, village: 0.35 },
  /** Hasta esta edad, sin ningún padre vivo cuenta como orfandad. */
  orphanAge: 16,
  /** Días que tarda el nivel en recorrer toda la distancia (3 meses). */
  settleDays: 90,
  /** Déficit que enciende y apaga el aviso (histéresis). */
  deficitOn: 0.6,
  deficitOff: 0.4,
} as const;

export interface BelongingInputs {
  readonly housemates: number;
  readonly spouseAlive: boolean;
  readonly parentsAlive: number;
  readonly ageYears: number;
  readonly yearsInVillage: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Las fuentes y las causas de déficit de lo que la persona tiene alrededor. Puro. */
export function belongingSources(i: BelongingInputs): {
  readonly sources: readonly BelongingSource[];
  readonly reasons: readonly DeficitReason[];
} {
  const t = BELONGING_TUNING;
  const family = clamp01(
    i.housemates / t.fullHousemates +
      (i.spouseAlive ? t.spouseBonus : 0) +
      i.parentsAlive * t.parentBonus,
  );
  const village = clamp01(i.yearsInVillage / t.rootYears);
  const reasons: DeficitReason[] = [];
  if (i.housemates === 0 && !i.spouseAlive) reasons.push("isolation");
  if (i.ageYears < t.orphanAge && i.parentsAlive === 0) reasons.push("orphan");
  return {
    sources: [
      { kind: "family", strength: family, weight: t.weights.family },
      { kind: "village", strength: village, weight: t.weights.village },
    ],
    reasons,
  };
}

/** El nivel al que tiende dadas las fuentes. */
export const belongingTarget = (sources: readonly BelongingSource[]): number =>
  clamp01(sources.reduce((a, s) => a + s.strength * s.weight, 0));

/** Avanza `days` días hacia el objetivo, lineal y sin pasarse. */
export function stepBelonging(level: number, target: number, days: number): number {
  const step = days / BELONGING_TUNING.settleDays;
  if (Math.abs(target - level) <= step) return target;
  return level + Math.sign(target - level) * step;
}

/** Déficit (0-1) de un estado. */
export const belongingDeficit = (s: Pick<BelongingState, "level">): number => 1 - s.level;

/** Histéresis del aviso: enciende con déficit alto, apaga cuando baja bastante. */
export function nextInDeficit(prev: boolean, level: number): boolean {
  const d = 1 - level;
  if (prev) return d > BELONGING_TUNING.deficitOff;
  return d >= BELONGING_TUNING.deficitOn;
}

/** Problemas de coherencia, para los invariantes. */
export function belongingProblems(s: BelongingState): string[] {
  const out: string[] = [];
  if (!(s.level >= 0 && s.level <= 1)) out.push(`nivel fuera de 0-1: ${s.level}`);
  for (const x of s.sources) {
    if (!(x.strength >= 0 && x.strength <= 1)) out.push(`fuerza fuera de 0-1: ${x.kind}`);
  }
  return out;
}
