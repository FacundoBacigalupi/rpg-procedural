// La etiqueta como norma y las ofensas que cuestan cara (social-structure §4, §3, Fase 2). Una
// cultura declara sus normas en `content/etiquette/` (qué acto debe quien está abajo a quien
// está arriba); romperlas es una ofensa cuyo tamaño depende de la distancia de rango QUE EL
// OFENDIDO CREE, de los testigos y de lo que el infractor podía saber. La cara (`FACE`) es el
// capital social que se pierde o se gana en público; quien fue ofendido decide qué hacer con su
// poder y su cara en juego. Todo es puro: quien escribe el estado es el proceso del juego.
//
// Todavía sin castigos que tengan costo legal (law, Fase 3), ni el aprendizaje de la etiqueta
// del otro estrato como habilidad (skills), ni la respuesta por medio de la organización.

import { contentId, defineContent, type Tick, z } from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { StandingBelief } from "./belief.ts";

export const EtiquetteNorm = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  culture: contentId,
  /** Qué acto regula (`address`, `greet`…): lo que el diálogo declara que hizo o dejó de hacer. */
  act: contentId,
  /** Quién lo debe: el que está por debajo de quien lo recibe. */
  owedBy: z.enum(["lower"]),
  /** Escalones de rango, creídos, desde los que se debe. */
  minGap: z.number().int().min(1),
  /** 0-1: lo grave de omitirlo, con una persona más arriba y a solas. */
  severity: z.number().gt(0).max(1),
});
export type EtiquetteNorm = z.infer<typeof EtiquetteNorm>;

export const ETIQUETTE = defineContent("etiquette", EtiquetteNorm, (n) => [
  { kind: "cultures", id: n.culture, at: "culture" },
]);

/** La cara de alguien (npc-psychology): 0-1, la reputación pública que se juega en cada trato. */
export interface Face {
  readonly value: number;
  readonly updated: Tick;
}
export const FACE = table<Face>("social.face");
export const DEFAULT_FACE = 0.5;

export interface Offense {
  readonly norm: string;
  /** 0-1. */
  readonly size: number;
  /** Escalones de rango que el ofendido creía entre ambos. */
  readonly gap: number;
  readonly witnesses: number;
}

export interface BreachInput {
  /** El rango real del ofendido: el que recibe el acto. */
  readonly offendedRank: number;
  /** Lo que el ofendido cree del rango del infractor (no la verdad). */
  readonly believedActor: Pick<StandingBelief, "rank" | "confidence"> | undefined;
  /** 0-1: cuánto conoce el infractor la etiqueta de este estrato (§4). */
  readonly actorKnowsEtiquette: number;
  /** Los que presencian, sin contar a los dos. */
  readonly witnesses: number;
}

export const WITNESS_GROWTH = 0.25;
export const WITNESS_CAP = 4;
export const GAP_GROWTH = 0.5;
export const IGNORANCE_MITIGATION = 0.5;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * ¿Rompió `norm` quien omitió el acto? Solo si el ofendido cree al infractor por debajo (por al
 * menos `minGap` escalones): al que cree igual o más alto no le debía nada, y al que no pudo
 * leer, tampoco lo juzga. Crece con la distancia creída y los testigos; la ignorancia honesta
 * de la etiqueta lo atenúa. Devuelve `null` si no hay ofensa.
 */
export function judgeBreach(norm: EtiquetteNorm, input: BreachInput): Offense | null {
  const b = input.believedActor;
  if (!b) return null;
  const gap = input.offendedRank - b.rank;
  if (gap < norm.minGap) return null;
  const witnesses = Math.max(0, Math.floor(input.witnesses));
  const size =
    norm.severity *
    (1 + GAP_GROWTH * (gap - norm.minGap)) *
    (1 + WITNESS_GROWTH * Math.min(witnesses, WITNESS_CAP)) *
    (1 - IGNORANCE_MITIGATION * (1 - clamp01(input.actorKnowsEtiquette)));
  return { norm: norm.id, size: clamp01(size), gap, witnesses };
}

/** La cara que pierde el ofendido: más cuanto más público (con testigos, hasta 3). */
export function faceLoss(offense: Offense): number {
  return clamp01(offense.size * (0.5 + 0.5 * Math.min(1, offense.witnesses / 3)));
}

export function adjustFace(face: Face | undefined, delta: number, at: Tick): Face {
  return { value: clamp01((face?.value ?? DEFAULT_FACE) + delta), updated: at };
}

export type OffenseResponse = "ignore" | "rebuke" | "punish";

export interface ResponseInput {
  readonly offendedRank: number;
  readonly believedActorRank: number;
  readonly face: number;
  /** 0-1: el poderoso magnánimo (temperamento y valores). */
  readonly magnanimity: number;
}

export const REBUKE_AT = 0.25;
export const PUNISH_AT = 0.5;

/**
 * Qué hace el ofendido (§4): ignorar (el magnánimo o el que no quiere testigos), reprender, o
 * castigar, que solo está a mano de quien está por encima de verdad. Con la cara baja, la ofensa
 * pesa más; la magnanimidad la baja.
 */
export function respondToOffense(offense: Offense, r: ResponseInput): OffenseResponse {
  const score = offense.size * (1 + 0.5 * (1 - clamp01(r.face))) - 0.3 * clamp01(r.magnanimity);
  if (score >= PUNISH_AT && r.offendedRank > r.believedActorRank) return "punish";
  if (score >= REBUKE_AT) return "rebuke";
  return "ignore";
}

export interface ExposureInput {
  /** El rango que el impostor hizo creer. */
  readonly claimed: number;
  /** Su rango de verdad. */
  readonly actual: number;
  readonly witnesses: number;
}

export const IMPOSTOR_SEVERITY = 0.4;

/**
 * Fingir un rango más alto y que te descubran es una ofensa a la cara de los engañados (§3). Su
 * tamaño crece con cuánto se fingió y con los testigos; fingir más bajo no ofende a nadie.
 */
export function exposureOffense(x: ExposureInput): Offense | null {
  const gap = x.claimed - x.actual;
  if (gap <= 0) return null;
  const witnesses = Math.max(0, Math.floor(x.witnesses));
  const size = clamp01(
    IMPOSTOR_SEVERITY *
      (1 + GAP_GROWTH * (gap - 1)) *
      (1 + WITNESS_GROWTH * Math.min(witnesses, WITNESS_CAP)),
  );
  return { norm: "impostor", size, gap, witnesses };
}
