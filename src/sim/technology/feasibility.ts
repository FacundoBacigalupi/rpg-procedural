// Qué falta para que un proceso sea posible en un lugar (technology §1, principio 5): los
// prerrequisitos son físicos, no de menú. Que sea posible no quiere decir que alguien lo sepa
// (`knowledge.ts`) ni que alguien lo adopte (Fase 5). Pura: quien llama arma el `Surroundings`
// desde lo que hay cerca (planet-gen), lo que la cultura sabe y la ley del mundo.

import type { EnergyKind, TechProcessDef } from "./process.ts";

/** Lo que hay donde se quiere hacer el proceso. */
export interface Surroundings {
  /** Recursos al alcance (ids de recurso: `tin`, `clay`, `flax`). */
  readonly resources: ReadonlySet<string>;
  /** El máximo que alcanza cada fuente de energía aquí (°C del fuego; el resto, cualquier número > 0). */
  readonly energy: Readonly<Partial<Record<EnergyKind, number>>>;
  /** Ideas que conoce quien lo intenta o su cultura. */
  readonly concepts: ReadonlySet<string>;
  /** Procesos disponibles como herramienta (los que alguien aquí sabe hacer y tiene hechos). */
  readonly tools: ReadonlySet<string>;
  /** Personas que pueden trabajar en esto. */
  readonly workers: number;
  /** Condiciones de la ley del mundo que se cumplen. */
  readonly laws: ReadonlySet<string>;
}

export type Missing =
  | { readonly kind: "resource"; readonly id: string }
  | {
      readonly kind: "energy";
      readonly energy: EnergyKind;
      readonly have: number;
      readonly need: number;
    }
  | { readonly kind: "concept"; readonly id: string }
  | { readonly kind: "tool"; readonly id: string }
  | { readonly kind: "scale"; readonly have: number; readonly need: number }
  | { readonly kind: "law"; readonly id: string };

export interface Feasibility {
  readonly possible: boolean;
  /** Lo que falta, en el orden de la definición. */
  readonly missing: readonly Missing[];
}

/**
 * Si el proceso se puede hacer con lo que hay. Un proceso con una ley del mundo que no se cumple
 * no existe: no se lista nada más que la ley, porque lo demás no importa.
 */
export function feasibility(def: TechProcessDef, here: Surroundings): Feasibility {
  const lawMissing: Missing[] = def.worldLaw
    .filter((l) => !here.laws.has(l))
    .map((id) => ({ kind: "law", id }));
  if (lawMissing.length > 0) return { possible: false, missing: lawMissing };

  const missing: Missing[] = [];
  const r = def.requires;
  for (const id of r.resources) if (!here.resources.has(id)) missing.push({ kind: "resource", id });
  if (r.energy) {
    const have = here.energy[r.energy.kind] ?? 0;
    const need = r.energy.temperature ?? 1;
    if (have < need) missing.push({ kind: "energy", energy: r.energy.kind, have, need });
  }
  for (const id of r.concepts) if (!here.concepts.has(id)) missing.push({ kind: "concept", id });
  for (const id of r.tools) if (!here.tools.has(id)) missing.push({ kind: "tool", id });
  if (here.workers < r.scale) missing.push({ kind: "scale", have: here.workers, need: r.scale });
  return { possible: missing.length === 0, missing };
}

/** Los procesos del catálogo que se pueden hacer aquí, ordenados por id (el catálogo ya lo está). */
export function possibleHere(
  defs: readonly TechProcessDef[],
  here: Surroundings,
): readonly TechProcessDef[] {
  return defs.filter((d) => feasibility(d, here).possible);
}
