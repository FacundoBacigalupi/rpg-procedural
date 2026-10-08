// El sistema elemental del mundo (elements §1): la ley, no una tabla de ventajas. Los elementos
// van en un orden fijo y las matrices `G` (generar, 相生) y `K` (vencer, 相克) se indexan por ese
// orden, así un vector es un arreglo de cantidades y todo recorrido es determinista.
// Fase 1: la forma (cinco fases) está en `content/elements/` y el seed solo varía intensidades.

import { contentId, defineContent, type Rng, z } from "../../core/index.ts";
import { ESSENCE_SOURCES } from "../../worldgen/index.ts";

export const PhysicalSignature = z.strictObject({
  /** + calienta, − enfría. */
  heat: z.number().min(-1).max(1),
  /** + moja, − seca. */
  moisture: z.number().min(-1).max(1),
  /** + endurece, − ablanda. */
  rigidity: z.number().min(-1).max(1),
  /** + empuja y dispersa, − estanca. */
  motion: z.number().min(-1).max(1),
  /** + nutre, − marchita. */
  vitality: z.number().min(-1).max(1),
});
export type PhysicalSignature = z.infer<typeof PhysicalSignature>;

export const ElementDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  physical: PhysicalSignature,
  /** De qué fuentes de planet-gen nace (planet-gen §5). */
  geologicalSources: z.array(z.enum(ESSENCE_SOURCES)).min(1),
  /** Regiones del cuerpo con las que resuena (elements §7). */
  bodyAffinity: z.array(contentId),
});
export type ElementDef = z.infer<typeof ElementDef>;

const unit = z.number().min(0).max(1);
const matrix = z.array(z.array(unit));

export const ElementSystemDef = z
  .strictObject({
    id: contentId,
    name: z.string().min(1),
    family: z.enum(["five_phases", "yin_yang_phases", "trigrams", "four_classical", "generated"]),
    elements: z.array(ElementDef).min(2),
    /** `G[a][b]`: cuánto genera `a` a `b`. */
    G: matrix,
    /** `K[a][b]`: cuánto vence `a` a `b`. */
    K: matrix,
    /** λ ≥ 1: desde qué proporción el vencido invierte la relación (相侮). */
    insultRatio: z.number().min(1),
    /** ρ < 1: fuerza relativa del vencido cuando invierte. */
    inversionStrength: z.number().gt(0).lt(1),
    /** Fracción que se pierde al convertir por generación. */
    generationLoss: z.number().gt(0).lt(1),
    /** κ < 1: lo que gasta el vencedor por unidad que disuelve. */
    overcomeCost: z.number().gt(0).lt(1),
    /** Cuánto cuenta el mismo elemento de los dos lados (carga extra del contenedor). */
    resonance: unit,
  })
  .superRefine((s, ctx) => {
    for (const problem of systemProblems(s)) ctx.addIssue({ code: "custom", message: problem });
  });
export type ElementSystemDef = z.infer<typeof ElementSystemDef>;

export const ELEMENT_SYSTEMS = defineContent("elements", ElementSystemDef);

/** Las reglas del validador de elements §1 que se pueden comprobar sobre la forma. */
export function systemProblems(s: {
  elements: readonly ElementDef[];
  G: readonly (readonly number[])[];
  K: readonly (readonly number[])[];
  generationLoss: number;
}): string[] {
  const n = s.elements.length;
  const out: string[] = [];
  const square = (m: readonly (readonly number[])[]) =>
    m.length === n && m.every((row) => row.length === n);
  if (!square(s.G) || !square(s.K)) return [`G y K tienen que ser de ${n}×${n}`];
  const ids = new Set(s.elements.map((e) => e.id));
  if (ids.size !== n) out.push("elementos repetidos");

  for (let a = 0; a < n; a++) {
    const name = (s.elements[a] as ElementDef).id;
    let beats = 0;
    let beaten = 0;
    let fed = 0;
    for (let b = 0; b < n; b++) {
      if (b === a) continue;
      if (kOf(s, a, b) > 0) beats++;
      if (kOf(s, b, a) > 0) beaten++;
      if (gOf(s, b, a) > 0) fed++;
    }
    if (kOf(s, a, a) > 0 || gOf(s, a, a) > 0) out.push(`${name} se relaciona consigo mismo`);
    if (beats === n - 1) out.push(`${name} vence a todos`);
    if (beaten === n - 1) out.push(`${name} es vencido por todos`);
    if (fed === 0) out.push(`${name} no nace de ningún otro`);
  }

  // Cada fuente geológica tiene que llegar a algún elemento, o la esencia de la celda se perdería.
  for (const src of ESSENCE_SOURCES) {
    if (!s.elements.some((e) => e.geologicalSources.includes(src))) {
      out.push(`la fuente ${src} no corresponde a ningún elemento`);
    }
  }
  // Sin móvil perpetuo: dar la vuelta por cualquier camino de generación pierde esencia.
  if (!(s.generationLoss > 0)) out.push("generar sin pérdida permitiría un móvil perpetuo");
  return out;
}

const kOf = (s: { K: readonly (readonly number[])[] }, a: number, b: number) =>
  (s.K[a] as readonly number[])[b] as number;
const gOf = (s: { G: readonly (readonly number[])[] }, a: number, b: number) =>
  (s.G[a] as readonly number[])[b] as number;

/** El orden de un elemento (el índice en vectores y matrices). */
export function elementIndex(system: ElementSystemDef, id: string): number {
  const i = system.elements.findIndex((e) => e.id === id);
  if (i < 0) throw new RangeError(`elemento desconocido: ${id}`);
  return i;
}

/**
 * La ley de un mundo a partir de la forma del contenido: mismas relaciones, intensidades distintas
 * (elements §1, «las intensidades varían aunque la forma sea la misma»). Cada entrada de las
 * matrices se mueve hasta ±`spread` en proporción, siempre dentro de [0, 1], y las relaciones que
 * no existían siguen sin existir.
 */
export function varySystem(base: ElementSystemDef, rng: Rng, spread = 0.25): ElementSystemDef {
  const wiggle = (v: number, r: Rng, lo = 0, hi = 1) =>
    v === 0 ? 0 : Math.min(hi, Math.max(lo, v * (1 + spread * (r.float() * 2 - 1))));
  const vary = (m: readonly (readonly number[])[], key: string) =>
    m.map((row, a) => row.map((v, b) => wiggle(v, rng.fork(key, a, b))));
  return ElementSystemDef.parse({
    ...base,
    G: vary(base.G, "G"),
    K: vary(base.K, "K"),
    insultRatio: 1 + (base.insultRatio - 1) * (1 + spread * (rng.fork("lambda").float() * 2 - 1)),
    inversionStrength: wiggle(base.inversionStrength, rng.fork("rho"), 0.05, 0.95),
    generationLoss: wiggle(base.generationLoss, rng.fork("loss"), 0.02, 0.9),
    overcomeCost: wiggle(base.overcomeCost, rng.fork("kappa"), 0.05, 0.95),
  });
}
