// Efectos agudos de las sustancias sobre el cuerpo y la mente (body-health §9, npc-psychology
// §11), parte pura: lo que una persona tiene en el cuerpo (`SubstanceDef` + `SubstanceState`) baja
// capacidades (el efecto buscado mientras hay sustancia, la abstinencia cuando falta), alivia el
// dolor sentido, deja un ansia como necesidad y muestra etapas de envenenamiento que un médico
// puede ver. Sin sustancias devuelve `NEUTRAL` y las capacidades quedan idénticas. Sin calibrar.

import type { BodyCapabilities } from "./capabilities.ts";
import {
  craving,
  effectLevel,
  poisonStage,
  type SubstanceDef,
  type SubstanceStage,
  type SubstanceState,
  withdrawalSeverity,
} from "./substance.ts";

type Cap = keyof BodyCapabilities;

/** Una sustancia que el cuerpo tiene ahora, con su definición. */
export interface HeldDef {
  readonly def: SubstanceDef;
  readonly state: SubstanceState;
}

export interface AcuteEffects {
  /** Cuánto se pierde de cada capacidad (0-1), por el efecto y la abstinencia juntos. */
  readonly impair: Readonly<Partial<Record<Cap, number>>>;
  /** 0-1: cuánto del dolor deja de sentirse (analgesia). */
  readonly numbing: number;
  /** 0-1: la peor abstinencia en curso. */
  readonly withdrawal: number;
  /** 0-1: el ansia mayor entre las sustancias que reclama el cuerpo. */
  readonly craving: number;
}

export const NEUTRAL: AcuteEffects = { impair: {}, numbing: 0, withdrawal: 0, craving: 0 };

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const r = (x: number) => Math.round(x * 1e6) / 1e6;

/** Combina todo lo que el cuerpo tiene: las pérdidas se multiplican (1 - Π(1 - p)). */
export function acuteEffects(held: readonly HeldDef[]): AcuteEffects {
  if (held.length === 0) return NEUTRAL;
  const keep: Partial<Record<Cap, number>> = {};
  let relief = 1;
  let withdrawal = 0;
  let ansia = 0;
  for (const { def, state } of held) {
    const lvl = effectLevel(def, state);
    const wd = withdrawalSeverity(def, state);
    withdrawal = Math.max(withdrawal, wd);
    ansia = Math.max(ansia, craving(def, state));
    const a = def.acute;
    if (!a) continue;
    relief *= 1 - clamp01((a.numbs ?? 0) * lvl);
    const caps = new Set<string>([
      ...Object.keys(a.impairs ?? {}),
      ...Object.keys(a.withdrawalImpairs ?? {}),
    ]);
    for (const k of caps) {
      const loss = clamp01(
        (a.impairs?.[k as Cap] ?? 0) * lvl + (a.withdrawalImpairs?.[k as Cap] ?? 0) * wd,
      );
      keep[k as Cap] = (keep[k as Cap] ?? 1) * (1 - loss);
    }
  }
  const impair: Partial<Record<Cap, number>> = {};
  for (const [k, v] of Object.entries(keep)) if (v < 1) impair[k as Cap] = r(1 - v);
  return {
    impair,
    numbing: r(1 - relief),
    withdrawal: r(withdrawal),
    craving: r(ansia),
  };
}

/** Las capacidades con los efectos agudos aplicados; sin efecto, la misma instancia. */
export function applyAcute(caps: BodyCapabilities, fx: AcuteEffects): BodyCapabilities {
  const keys = Object.keys(fx.impair) as Cap[];
  if (keys.length === 0) return caps;
  const out: Record<Cap, number> = { ...caps };
  for (const k of keys) out[k] = r(caps[k] * (1 - (fx.impair[k] ?? 0)));
  return out;
}

/** Lo que se ve de alguien con sustancias encima: etapas de envenenamiento y señales sin números. */
export interface SubstanceSign {
  readonly substance: string;
  readonly kind: "poison" | "sedated" | "withdrawing";
  /** Solo en `poison`. */
  readonly stage?: SubstanceStage;
}

export const SEDATED_SEEN = 0.5;
export const WITHDRAWAL_SEEN = 0.3;

export function substanceSigns(held: readonly HeldDef[]): SubstanceSign[] {
  const out: SubstanceSign[] = [];
  for (const { def, state } of held) {
    const stage = poisonStage(state);
    if (stage !== "none") out.push({ substance: def.id, kind: "poison", stage });
    if (effectLevel(def, state) >= SEDATED_SEEN && def.acute?.numbs !== undefined)
      out.push({ substance: def.id, kind: "sedated" });
    if (withdrawalSeverity(def, state) >= WITHDRAWAL_SEEN)
      out.push({ substance: def.id, kind: "withdrawing" });
  }
  return out;
}
