// Maestro y discípulo (novel2-master-bond, organizations §9, cultivation §15): el vínculo vive en el
// discípulo (`MASTER_OF`: quién es su maestro, de qué secta, desde cuándo y por qué evento). Quien
// decide es el anciano: lo que pesa es lo que él puede saber del que pide (el talento que le midió la
// prueba, no el verdadero; el tramo, que un cultivador más alto siente; el aporte anotado en la
// secta y cómo lo trata), y cuántos discípulos ya carga. La regla es pura: sí, o por qué no.

import type { AgentId, EntityRef, EventId, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { MemberRank } from "./member.ts";

/** El vínculo, en el discípulo. */
export interface MasterOf {
  readonly master: AgentId;
  readonly org: EntityRef;
  readonly since: Tick;
  /** El evento que lo creó (`cultivation.master_taken`). */
  readonly event: EventId;
}

export const MASTER_OF = table<MasterOf>("cultivation.master_of");

export const MASTER_TAKEN_EVENT = "cultivation.master_taken";

/** Cuántos discípulos directos carga un anciano como mucho (sin calibrar). */
export const MAX_DISCIPLES = 3;
/** Desde qué puntaje toma al primero; cada discípulo que ya tiene lo vuelve más exigente. */
export const MASTER_BAR = 0.35;
export const MASTER_BAR_PER_DISCIPLE = 0.1;
/** Con un trato peor que esto no lo toma, valga lo que valga. */
export const MASTER_GRUDGE = -0.2;
/** Los pesos de lo que mira: talento medido, tramo, aporte y trato. */
export const MASTER_WEIGHTS = { talent: 0.45, stage: 0.25, points: 0.2, regard: 0.1 } as const;
/** El tramo y el aporte que ya cuentan enteros. */
export const MASTER_FULL_STAGE = 3;
export const MASTER_FULL_POINTS = 100;
/** Un discípulo externo pesa menos: todavía no se probó en la secta. */
export const OUTER_PENALTY = 0.1;

/** Lo que el anciano sabe o siente del que le pide. */
export interface MasterAsk {
  /** Si es de la misma secta que el anciano. */
  readonly sameOrg: boolean;
  readonly rank: MemberRank;
  /** Si ya tiene maestro. */
  readonly hasMaster: boolean;
  /** El talento que le midió la prueba (`TrialReading.quality`, 0-1); sin prueba, nada. */
  readonly talent?: number;
  /** El tramo en que está (un cultivador más alto lo siente). */
  readonly stage: number;
  /** Los puntos de contribución anotados. */
  readonly points: number;
  /** Cómo lo trata el anciano (-1 a 1; 0 si no lo conoce). */
  readonly regard: number;
  /** Cuántos discípulos directos tiene ya el anciano. */
  readonly disciples: number;
}

export type MasterRefusal = "not_member" | "has_master" | "full" | "grudge" | "unworthy";

export type MasterDecision =
  | { readonly kind: "accepted"; readonly score: number }
  | { readonly kind: "refused"; readonly refused: MasterRefusal; readonly score?: number };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Lo que vale el que pide a ojos del anciano (0-1, sin contar lo que ya carga). */
export function discipleWorth(a: MasterAsk): number {
  const w = MASTER_WEIGHTS;
  const score =
    w.talent * clamp01(a.talent ?? 0) +
    w.stage * clamp01(a.stage / MASTER_FULL_STAGE) +
    w.points * clamp01(a.points / MASTER_FULL_POINTS) +
    w.regard * clamp01(a.regard) -
    (a.rank === "outer" ? OUTER_PENALTY : 0);
  return Math.round(clamp01(score) * 1e4) / 1e4;
}

/** ¿Lo toma de discípulo directo? Por orden: secta, maestro previo, lugar, rencor, valía. */
export function masterAccepts(a: MasterAsk): MasterDecision {
  if (!a.sameOrg) return { kind: "refused", refused: "not_member" };
  if (a.hasMaster) return { kind: "refused", refused: "has_master" };
  if (a.disciples >= MAX_DISCIPLES) return { kind: "refused", refused: "full" };
  if (a.regard < MASTER_GRUDGE) return { kind: "refused", refused: "grudge" };
  const score = discipleWorth(a);
  return score >= MASTER_BAR + MASTER_BAR_PER_DISCIPLE * a.disciples
    ? { kind: "accepted", score }
    : { kind: "refused", refused: "unworthy", score };
}
