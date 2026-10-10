// Rumores de otros moldes (information §4): no todo lo que se cuenta es un hecho con autor. Acá
// `price` («el arroz está a X en el mercado de Y») y `location` («hay hierba en la cueva»), con su
// propia deformación pura (sorteos fijos, nada que el narrador no tuviera: el precio se redondea o
// se infla desde el que él cree; el lugar se corre solo a uno cercano que conoce o se vuelve vago).
// Opt-in: nada de esto corre en la vida por defecto. Constantes sin calibrar.

import type { PlaceRef, Random } from "../../core/index.ts";

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const round = (x: number): number => Math.round(x * 1e6) / 1e6;

/** «El `good` vale `amount` en `market`.» `good` es la clave de bien tal como la usa la economía. */
export interface PriceRumor {
  readonly mold: "price";
  readonly good: string;
  readonly market: PlaceRef;
  readonly amount: number;
}

/** «Hay `what` en `where`.» `vague` = solo se acuerda de la zona, no del sitio. */
export interface LocationRumor {
  readonly mold: "location";
  readonly what: string;
  readonly where: PlaceRef;
  readonly vague: boolean;
}

export type MoldRumor = PriceRumor | LocationRumor;

export type MoldDistortion = "rounded" | "inflated" | "drifted" | "blurred";

export interface MoldDistortContext {
  /** 0-1: cuánto recuerda. */
  readonly memory: number;
  /** 0-1: ganas de dramatizar. */
  readonly drama: number;
  /** 0-1: apuro, alcohol, distracción. */
  readonly hurry: number;
  /** Lugares cercanos que el que cuenta conoce (a donde se puede correr la ubicación). */
  readonly nearby: readonly PlaceRef[];
}

/** Redondeo a una cifra «de boca»: 2 cifras significativas, nunca menos de 1. */
export function roundedAmount(x: number): number {
  if (x < 10) return Math.max(1, Math.round(x));
  let step = 1;
  while (x / step >= 100) step *= 10;
  return Math.max(1, Math.round(x / step) * step);
}

/**
 * Deforma un rumor de molde al contarlo (dos sorteos fijos por llamada). Precio: se redondea (menos
 * memoria, más apuro) y se infla con el dramatismo (hasta +50%). Lugar: con poca memoria se vuelve
 * vago, y si no, se corre a uno de los `nearby` que el narrador conoce (nunca inventa uno).
 */
export function distortMold(
  r: MoldRumor,
  ctx: MoldDistortContext,
  rng: Random,
): { rumor: MoldRumor; changes: readonly MoldDistortion[] } {
  const r1 = rng.float();
  const r2 = rng.float();
  const changes: MoldDistortion[] = [];
  if (r.mold === "price") {
    let amount = r.amount;
    if (r1 < clamp01(0.6 * (1 - ctx.memory) + 0.2 * ctx.hurry)) {
      const rounded = roundedAmount(amount);
      if (rounded !== amount) {
        amount = rounded;
        changes.push("rounded");
      }
    }
    if (r2 < clamp01(0.5 * ctx.drama)) {
      amount = Math.max(1, Math.round(amount * (1 + 0.25 * (1 + ctx.drama))));
      changes.push("inflated");
    }
    return { rumor: { ...r, amount: round(amount) }, changes };
  }
  let { where, vague } = r;
  if (!vague && r1 < clamp01(0.5 * (1 - ctx.memory))) {
    vague = true;
    changes.push("blurred");
  }
  const pool = ctx.nearby.filter((p) => !samePlace(p, r.where));
  if (pool.length > 0 && r2 < clamp01(0.4 * (1 - ctx.memory) + 0.2 * ctx.hurry)) {
    where =
      pool[Math.min(pool.length - 1, Math.floor(r2 * pool.length * 4) % pool.length)] ?? where;
    changes.push("drifted");
  }
  return { rumor: { ...r, where, vague }, changes };
}

/** Igualdad estructural de lugares (la clave canónica de abajo). */
export function samePlace(a: PlaceRef, b: PlaceRef): boolean {
  return placeKey(a) === placeKey(b);
}

export function placeKey(p: PlaceRef): string {
  switch (p.kind) {
    case "cell":
      return `cell:${p.cell}`;
    case "place":
      return `place:${p.place}`;
    case "building":
      return `building:${p.building}`;
    case "settlement":
      return `settlement:${p.settlement}`;
    case "realm":
      return `realm:${p.realm}`;
    case "plane":
      return `plane:${p.plane}`;
    case "carried":
      return `carried:${p.by}`;
  }
}

/** Qué tanto se aleja `c` de `truth` (0-1): precio por error relativo, lugar por sitio y vaguedad. */
export function moldDistance(truth: MoldRumor, c: MoldRumor): number {
  if (truth.mold === "price" && c.mold === "price") {
    if (truth.good !== c.good || !samePlace(truth.market, c.market)) return 1;
    return round(Math.min(1, Math.abs(c.amount - truth.amount) / Math.max(1, truth.amount)));
  }
  if (truth.mold === "location" && c.mold === "location") {
    if (truth.what !== c.what) return 1;
    return round(
      0.7 * (samePlace(truth.where, c.where) ? 0 : 1) + 0.3 * (truth.vague === c.vague ? 0 : 1),
    );
  }
  return 1;
}

/**
 * Cuánto vale para el oyente lo que cree de oídas como insumo de una decisión (comprar, ir): la
 * confianza ya pesada; un lugar vago vale menos (no alcanza para ir directo).
 */
export function moldUsefulness(r: MoldRumor, confidence: number): number {
  const base = clamp01(confidence);
  return round(r.mold === "location" && r.vague ? base * 0.5 : base);
}
