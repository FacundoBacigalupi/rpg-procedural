// Señales de sustancias para el panel del jugador (body-health §9; player-loop §9). Opt-in
// (`characterPanel(w, { substances: true })`). Muro con la verdad: sale solo lo perceptible
// (envenenamiento por etapa, sedación, abstinencia), nunca el id ni el nombre de la sustancia: el
// personaje ve el efecto, no sabe qué lo causa. Sin números, sin RNG.

import type { AgentId } from "../../core/index.ts";
import {
  ENTITY,
  type HeldDef,
  LOCATION,
  PERSON_SUBSTANCE,
  type ReadonlyWorldTruth,
  SUBSTANCE,
  type SubstanceDef,
  type SubstanceStage,
  substanceSigns,
} from "../../sim/index.ts";
import { cueContextOf, cueCravingOf } from "./substances.ts";
import { acquaintances } from "./view.ts";
import type { LifeWorld } from "./world.ts";

/** Una señal visible, sin la sustancia que la causa. */
export interface SeenSubstanceSign {
  readonly kind: "poison" | "sedated" | "withdrawing";
  /** Solo en `poison`. */
  readonly stage?: Exclude<SubstanceStage, "none">;
}

export type SeenUrge = "faint" | "pressing";

/** Umbral desde el cual las ganas por el entorno se sienten como apremio. */
export const URGE_PRESSING = 0.3;
/** Por debajo de esto no se nota. */
export const URGE_NOTICED = 0.05;

/** C�mo se siente un ansia de se�al (n�mero de la verdad -> palabra); sin ganas notables, undefined. */
export function urgeOf(craving: number): SeenUrge | undefined {
  if (craving >= URGE_PRESSING) return "pressing";
  return craving >= URGE_NOTICED ? "faint" : undefined;
}

export interface SubstancePanel {
  /** Lo que nota de sí mismo. */
  readonly self: readonly SeenSubstanceSign[];
  /**
   * Ganas que le despierta el entorno por costumbre (se�ales aprendidas), sin decir de qu�; solo si
   * hay se�ales aprendidas y el entorno de ahora las despierta (opt-in `cravingCues`).
   */
  readonly urge?: SeenUrge;
  /** Lo que nota de los que tiene a la vista (mismo lugar), por cómo los llama; solo si hay señales. */
  readonly others: readonly {
    readonly who: string;
    readonly signs: readonly SeenSubstanceSign[];
  }[];
}

/** Las señales perceptibles de alguien; sin filas de sustancias, vacío. */
export function seenSubstanceSigns(truth: ReadonlyWorldTruth, who: AgentId): SeenSubstanceSign[] {
  const rows = truth.get(PERSON_SUBSTANCE, who)?.held;
  if (!rows || rows.length === 0) return [];
  const defs = new Map<string, SubstanceDef>();
  for (const id of truth.ids(SUBSTANCE)) {
    const rec = truth.get(SUBSTANCE, id);
    if (rec) defs.set(rec.def.id, rec.def);
  }
  const held: HeldDef[] = [];
  for (const h of rows) {
    const def = defs.get(h.substance);
    if (def) held.push({ def, state: h.state });
  }
  return substanceSigns(held).map((s) =>
    s.kind === "poison" && s.stage !== undefined && s.stage !== "none"
      ? { kind: s.kind, stage: s.stage }
      : { kind: s.kind },
  );
}

export function substancePanel(w: LifeWorld): SubstancePanel {
  const at = w.truth.get(LOCATION, w.player);
  const known = acquaintances(w);
  const others: { who: string; signs: SeenSubstanceSign[] }[] = [];
  if (at) {
    for (const id of w.truth.ids(LOCATION) as AgentId[]) {
      if (id === w.player) continue;
      const there = w.truth.get(LOCATION, id);
      if (!there || there.hex !== at.hex || there.space !== at.space) continue;
      if (w.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
      const signs = seenSubstanceSigns(w.truth, id);
      if (signs.length === 0) continue;
      const a = known.get(id);
      others.push({ who: a?.name ?? a?.relation ?? "alguien", signs });
    }
  }
  const now = w.scheduler.now;
  const urge = urgeOf(
    cueCravingOf(w.truth, w.player, cueContextOf(w.truth, w.player, now, w.clock), now, w.clock),
  );
  return { self: seenSubstanceSigns(w.truth, w.player), others, ...(urge ? { urge } : {}) };
}
