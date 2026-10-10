// Señales de ansia sin abstinencia (body-health §9, npc-psychology §11): el cuerpo aprende que
// cierto lugar, cierta persona o cierta hora van con una sustancia, y volver a esa señal despierta
// ansia aunque no haya abstinencia (condicionamiento). Parte pura: se aprende al tomar una dosis
// (`learnCues`), se extingue con el tiempo sin reforzarse (`cueStrength`) y se lee como ansia
// (`cueCraving`). Sin señales devuelve 0. Sin calibrar.

import { pow } from "../../core/math/index.ts";

export type CueKind = "place" | "person" | "hour" | "object";

/** Una asociación aprendida entre una señal del entorno y una sustancia. */
export interface CravingCue {
  readonly substance: string;
  readonly kind: CueKind;
  /** Lugar: hex en texto; persona: id; hora: franja del día. */
  readonly key: string;
  /** 0-1 al momento `at`. */
  readonly strength: number;
  readonly at: number;
}

/** Lo que rodea a alguien en un momento. */
export interface CueContext {
  readonly hex: number;
  readonly people: readonly string[];
  /** 0-23. */
  readonly hour: number;
  /** Opcional: objetos u olores presentes (id del bien o de la marca de olor) que remiten a la sustancia. */
  readonly objects?: readonly string[];
}

/** Franjas del día para la señal de hora (cada 4 horas). */
export const HOUR_BAND = 4;
/** Cuánto sube la señal por dosis (hacia el techo). */
export const CUE_GAIN = 0.15;
/** Una señal sola nunca pasa de esto: el ansia por costumbre es menor que la de abstinencia. */
export const CUE_CEILING = 0.6;
/** Por debajo de esto la señal se olvida. */
export const CUE_TRACE = 0.02;

export const hourBand = (hour: number): string => `b${Math.floor(hour / HOUR_BAND)}`;

/** Las señales que tiene el entorno ahora, como pares (tipo, clave). */
export function cuesOf(ctx: CueContext): { kind: CueKind; key: string }[] {
  return [
    { kind: "place", key: `hex:${ctx.hex}` },
    ...[...ctx.people].sort().map((p) => ({ kind: "person" as const, key: p })),
    { kind: "hour", key: hourBand(ctx.hour) },
    ...[...(ctx.objects ?? [])].sort().map((o) => ({ kind: "object" as const, key: `obj:${o}` })),
  ];
}

/** Fuerza de la señal en `now`: se extingue a la mitad cada `halfLifeTicks` sin reforzarse. */
export function cueStrength(cue: CravingCue, now: number, halfLifeTicks: number): number {
  const dt = Math.max(0, now - cue.at);
  return cue.strength * pow(0.5, dt / Math.max(1, halfLifeTicks));
}

/** Tras una dosis de `substance` en `ctx`, refuerza (o crea) las señales de ese entorno. */
export function learnCues(
  cues: readonly CravingCue[],
  substance: string,
  ctx: CueContext,
  now: number,
  halfLifeTicks: number,
): CravingCue[] {
  const touched = cuesOf(ctx);
  const same = (c: CravingCue, t: { kind: CueKind; key: string }) =>
    c.substance === substance && c.kind === t.kind && c.key === t.key;
  const rest = cues.filter((c) => !touched.some((t) => same(c, t)));
  const next = touched.map((t) => {
    const prev = cues.find((c) => same(c, t));
    const s = prev ? cueStrength(prev, now, halfLifeTicks) : 0;
    const strength = Math.round((s + (CUE_CEILING - s) * CUE_GAIN) * 1e6) / 1e6;
    return { substance, kind: t.kind, key: t.key, strength, at: now };
  });
  return [...rest, ...next].sort((a, b) =>
    `${a.substance}|${a.kind}|${a.key}` < `${b.substance}|${b.kind}|${b.key}` ? -1 : 1,
  );
}

/** Quita las señales ya olvidadas. */
export function pruneCues(
  cues: readonly CravingCue[],
  now: number,
  halfLifeTicks: number,
): CravingCue[] {
  return cues.filter((c) => cueStrength(c, now, halfLifeTicks) >= CUE_TRACE);
}

/** 0-1: el ansia que despiertan las señales presentes (se combinan como 1 - Π(1 - s)). */
export function cueCraving(
  cues: readonly CravingCue[],
  ctx: CueContext,
  now: number,
  halfLifeTicks: number,
): number {
  if (cues.length === 0) return 0;
  const here = cuesOf(ctx);
  let calm = 1;
  for (const c of cues) {
    if (!here.some((t) => t.kind === c.kind && t.key === c.key)) continue;
    calm *= 1 - cueStrength(c, now, halfLifeTicks);
  }
  return Math.round((1 - calm) * 1e6) / 1e6;
}
