// Los gustos elegidos (game-modes §2.1 `tastes`, npc-psychology §16): el pedido del jugador antes de
// empezar. Un gusto elegido sigue siendo un hecho con origen: lo que se pide es el gusto y de dónde
// viene (`because`), y el resultado cita el evento que lo fija (el de la concepción condicionada o
// el `novel_setup`). Los que el pedido no nombra los genera el mundo (gustos básicos, §16).
//
// Puro. Este módulo valida y normaliza; no inventa dominios: el catálogo de dominios y objetos lo
// pone el contenido (`known`), y un gusto fuera de él se rechaza con la razón.

import { contentId, type EventId, z } from "../../core/index.ts";

/** De dónde viene el gusto pedido (el origen que la sim cuenta). */
export const TasteBecause = z.enum(["innate", "childhood", "parent", "illness", "memory"]);
export type TasteBecause = z.infer<typeof TasteBecause>;

export const TasteSpec = z.strictObject({
  domain: contentId,
  item: contentId,
  /** -1 (aversión) a 1 (le encanta). */
  valence: z.number().min(-1).max(1),
  /** 0-1: cuánto pesa. */
  strength: z.number().min(0).max(1).default(0.6),
  because: TasteBecause.default("innate"),
});
export type TasteSpec = z.infer<typeof TasteSpec>;

/** Un gusto ya fijado, con su origen (la forma de `Preference`, npc-psychology §16). */
export interface ChosenTaste {
  readonly domain: string;
  readonly item: string;
  readonly valence: number;
  readonly strength: number;
  /** Adquirido por exposición (infancia, padre): no es innato. */
  readonly acquired: boolean;
  readonly because: TasteBecause;
  readonly originEventIds: readonly EventId[];
  /** Siempre `chosen`: la crónica distingue lo elegido de lo generado. */
  readonly source: "chosen";
}

/** Los dominios y objetos que el contenido conoce: `domain -> items`. */
export type TasteCatalog = ReadonlyMap<string, ReadonlySet<string>>;

export interface TasteResolution {
  readonly tastes: ChosenTaste[];
  /** Pedidos rechazados, con la razón (§2.4: imposible, contradictorio). */
  readonly rejected: { readonly index: number; readonly reason: string }[];
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Normaliza los gustos pedidos. Rechaza lo que el contenido no conoce, y las contradicciones: el
 * mismo objeto pedido dos veces con signo opuesto. Repetido con el mismo signo se funde en el más
 * fuerte. El orden de salida es el del pedido (determinista).
 */
export function resolveTastes(
  specs: readonly TasteSpec[],
  catalog: TasteCatalog,
  origin: EventId,
): TasteResolution {
  const tastes: ChosenTaste[] = [];
  const rejected: { index: number; reason: string }[] = [];
  specs.forEach((s, index) => {
    const items = catalog.get(s.domain);
    if (!items) {
      rejected.push({ index, reason: `${s.domain}: no es un dominio de gusto de este mundo` });
      return;
    }
    if (!items.has(s.item)) {
      rejected.push({ index, reason: `${s.domain}/${s.item}: no existe en este mundo` });
      return;
    }
    const prev = tastes.findIndex((t) => t.domain === s.domain && t.item === s.item);
    const prior = prev >= 0 ? tastes[prev] : undefined;
    if (prior && Math.sign(prior.valence) !== Math.sign(s.valence) && s.valence !== 0) {
      rejected.push({ index, reason: `${s.domain}/${s.item}: contradice un gusto ya pedido` });
      return;
    }
    const taste: ChosenTaste = {
      domain: s.domain,
      item: s.item,
      valence: round(s.valence),
      strength: round(s.strength),
      acquired: s.because !== "innate",
      because: s.because,
      originEventIds: [origin],
      source: "chosen",
    };
    if (prior) {
      if (taste.strength > prior.strength) tastes[prev] = taste;
      return;
    }
    tastes.push(taste);
  });
  return { tastes, rejected };
}
