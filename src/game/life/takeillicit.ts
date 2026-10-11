// Tomar lo ajeno desde lo que se cree (g2b, npc-psychology §7, law §2): `take` solo existe como
// candidata si el NPC oyó (rumor `has`, creencia y no verdad) que un conocido tiene un bien, y su
// sanción sale de la norma que conoce: los robos de los que se enteró (`KNOWN_DEEDS`). Puro, sin RNG
// ni verdad.

import type { EntityRef } from "../../core/index.ts";
import {
  type Candidate,
  type KnownDeeds,
  type MoldRumor,
  STAKES_RISK,
  type UtilityDrive,
} from "../../sim/index.ts";

/** Opt-in de `decide`: ofrecer `take` sobre bienes que cree que tiene otro, con sanción por la norma conocida. */
export interface TakeBelievedOptions {
  /** Confianza mínima (0-1) en el rumor para que el bien entre como texto. */
  readonly minConfidence: number;
  /** Castigo creído (0-1) por cada robo conocido, hasta `maxPenalty`. */
  readonly perDeed: number;
  readonly maxPenalty: number;
  /** Impulsos que sirve el hurto (por defecto riqueza 0,5). */
  readonly serves?: Partial<Record<UtilityDrive, number>>;
}

export interface BelievedHolding {
  readonly holder: string;
  readonly good: string;
  readonly confidence: number;
}

/** Quién tiene qué según rumores `has` sobre personas conocidas; la mejor confianza por par, orden fijo. */
export function believedHoldings(
  rumors: readonly { readonly rumor: MoldRumor; readonly confidence: number }[],
  known: ReadonlySet<string>,
  self: string,
  o: TakeBelievedOptions,
): BelievedHolding[] {
  const best = new Map<string, BelievedHolding>();
  for (const { rumor: r, confidence } of rumors) {
    if (r.mold !== "attr" || r.attr !== "has" || typeof r.value !== "string") continue;
    if (!known.has(r.about) || r.about === self || confidence < o.minConfidence) continue;
    const key = `${r.about}|${r.value}`;
    const prev = best.get(key);
    if (!prev || confidence > prev.confidence)
      best.set(key, { holder: r.about, good: r.value, confidence });
  }
  return [...best.values()].sort((a, b) =>
    a.holder === b.holder
      ? a.good < b.good
        ? -1
        : a.good > b.good
          ? 1
          : 0
      : a.holder < b.holder
        ? -1
        : 1,
  );
}

/** Chance base de un hurto que cree posible, antes de la confianza en el rumor. */
export const TAKE_BASE_CHANCE = 0.6;

/**
 * Las candidatas `take:<dueño>+<bien>`, una por bien que cree que tiene un conocido. El catálogo no
 * ofrece `take` (no sirve a ningún impulso): acá sirve a `serves` (por defecto riqueza) con la
 * apuesta de un delito (`loss`/`risk`), y la sanción la pone `theftNormPenalty` y el tabú del bien.
 */
export function takeCandidates(
  held: readonly BelievedHolding[],
  o: TakeBelievedOptions,
): Candidate[] {
  return held.map((h) => ({
    id: `take:${h.holder}+${h.good}`,
    verb: "take",
    target: h.holder as unknown as EntityRef,
    contributes: o.serves ?? { wealth: 0.5 },
    chance: Math.round(TAKE_BASE_CHANCE * h.confidence * 1e6) / 1e6,
    loss: STAKES_RISK.crime.loss,
    risk: STAKES_RISK.crime.risk,
  }));
}

/** Castigo creído de robar (0-1): crece con los robos que conoce, sin pasar `maxPenalty`. Sin robos conocidos, nada. */
export function theftNormPenalty(known: KnownDeeds | undefined, o: TakeBelievedOptions): number {
  const thefts = (known?.deeds ?? []).filter((d) => d.kind === "theft").length;
  return Math.round(Math.min(o.maxPenalty, o.perDeed * thefts) * 1e6) / 1e6;
}
