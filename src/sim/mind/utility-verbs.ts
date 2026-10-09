// Candidatas del catálogo de verbos para la utilidad (npc-psychology §7, actions §5): cada verbo con
// `serves` se prueba con cada objetivo que el NPC CONOCE (personas y lugares de sus creencias, no
// de la verdad), se descarta lo que cree imposible (`believesPossible`) y la chance es la
// creída con su autoimagen (`believedChance`), bajada por lo que duda de dónde está el otro. Así
// «buscar al personaje donde cree que está» sale del mismo camino que cualquier verbo. Puro: no
// mira la verdad, solo la `BeliefView` que le pasan.

import type { AgentId, EntityRef } from "../../core/index.ts";
import {
  type ActionCatalog,
  type ActionDef,
  type ActionPlan,
  type ArgValue,
  assessPlan,
  type BeliefView,
  believedChance,
  believesPossible,
  type PlanNode,
} from "../actions/index.ts";
import { VALUE_IDS } from "./mind.ts";
import { type Candidate, NEED_IDS, type UtilityDrive } from "./utility.ts";

/** Lo que cada nivel de apuesta del verbo hace temer (riesgo) y perder (pérdida), sin calibrar. */
export const STAKES_RISK: Readonly<Record<ActionDef["stakes"], { risk: number; loss: number }>> = {
  none: { risk: 0, loss: 0.05 },
  harm: { risk: 0.3, loss: 0.3 },
  crime: { risk: 0.5, loss: 0.5 },
  lethal: { risk: 0.7, loss: 0.8 },
};

/** Chance de un verbo sin habilidad: casi seguro, pero nunca del todo. */
export const UNSKILLED_VERB_CHANCE = 0.9;
/** Cuánto baja la chance cada aviso blando (no sabe dónde está, creé que está lejos), por peso. */
export const DOUBT_PER_WEIGHT = 0.5;
/** El peso del aviso «no sé dónde está» (el mismo que da `assessPlan`). */
export const UNKNOWN_WHEREABOUTS_WEIGHT = 0.4;
/** Un verbo largo no se prueba con todo: tope de combinaciones por verbo. */
export const MAX_PER_VERB = 24;

const DRIVE_IDS: readonly string[] = [...NEED_IDS, ...VALUE_IDS];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const r = (x: number) => Math.round(x * 1e6) / 1e6;

export interface VerbContext {
  readonly catalog: ActionCatalog;
  /** Lo que el NPC cree; con `risk` la chance usa su autoimagen. */
  readonly view: BeliefView;
  /** Las personas que conoce, y los lugares que conoce. */
  readonly persons: readonly EntityRef[];
  readonly places: readonly EntityRef[];
  /** Textos posibles de los verbos que piden `what` o `content` (por verbo). */
  readonly texts?: Readonly<Record<string, readonly string[]>>;
  /** Suma de ánimo por verbo y objetivo (gusto, culpa, rencor): lo arma quien llama. */
  readonly mood?: (verb: string, target: EntityRef | undefined) => number;
}

/** Los impulsos de un verbo, solo los ids que la utilidad conoce. */
export function drivesOf(def: ActionDef): Partial<Record<UtilityDrive, number>> {
  const out: Partial<Record<UtilityDrive, number>> = {};
  for (const [k, v] of Object.entries(def.serves)) {
    if (DRIVE_IDS.includes(k)) out[k as UtilityDrive] = v;
  }
  return out;
}

/** Todas las asignaciones de argumentos que el NPC puede probar para el verbo (en orden fijo). */
export function argChoices(def: ActionDef, ctx: VerbContext): ArgValue[][] {
  let combos: ArgValue[][] = [[]];
  for (const a of def.args) {
    if (!a.required) continue;
    let options: ArgValue[] = [];
    if (a.kind === "person") options = ctx.persons.map((entity) => ({ role: a.role, entity }));
    else if (a.kind === "place") options = ctx.places.map((entity) => ({ role: a.role, entity }));
    else if (a.kind === "duration") {
      const seconds = def.duration.kind === "arg" ? def.duration.default : 3600;
      options = [{ role: a.role, seconds }];
    } else if (a.kind === "text") {
      options = (ctx.texts?.[def.id] ?? []).map((text) => ({ role: a.role, text }));
    }
    if (options.length === 0) return [];
    combos = combos.flatMap((c) => options.map((o) => [...c, o]));
    if (combos.length > MAX_PER_VERB) combos = combos.slice(0, MAX_PER_VERB);
  }
  return combos;
}

function leaf(def: ActionDef, args: readonly ArgValue[]): Extract<PlanNode, { kind: "do" }> {
  return { kind: "do", verb: def.id, args, manner: [] };
}

function idOf(def: ActionDef, args: readonly ArgValue[]): string {
  const parts = args.map((a) => ("entity" in a ? a.entity : "text" in a ? a.text : ""));
  return `${def.id}:${parts.filter((p) => p !== "").join("+")}`;
}

/**
 * Las candidatas del catálogo para este NPC. Un verbo sin `serves` no aparece (no empuja nada);
 * lo que cree imposible tampoco; el resto lleva la chance de su autoimagen y los avisos blandos.
 */
export function verbCandidates(ctx: VerbContext): Candidate[] {
  const out: Candidate[] = [];
  for (const def of ctx.catalog.verbs) {
    const contributes = drivesOf(def);
    if (Object.keys(contributes).length === 0) continue;
    for (const args of argChoices(def, ctx)) {
      const node = leaf(def, args);
      const plan: ActionPlan = {
        actor: (ctx.view.risk?.id ?? "") as AgentId,
        source: "utility",
        root: node,
        manner: [],
        causes: [],
      };
      const warnings = assessPlan(plan, ctx.catalog, ctx.view);
      if (!believesPossible(warnings)) continue;
      let chance = UNSKILLED_VERB_CHANCE;
      if (def.skill && ctx.view.risk) {
        const image = ctx.view.skill(def.skill.id);
        chance = believedChance(
          {
            def,
            node,
            planManner: [],
            actor: {
              id: ctx.view.risk.id,
              z: ctx.view.risk.z,
              capabilities: capabilitiesFor(def, ctx.view),
              hex: ctx.view.hex,
            },
            scene: ctx.view.risk.scene,
          },
          image,
        ).chance;
      }
      for (const w of warnings) {
        if (w.kind === "far" || w.kind === "unknown_whereabouts") {
          chance *= 1 - DOUBT_PER_WEIGHT * w.weight;
        }
      }
      const target = args.flatMap((a) => ("entity" in a ? [a.entity] : []))[0];
      // Buscar o ir hacia alguien de quien no sabe dónde está (y el verbo no lo avisó ya).
      const warned = warnings.some((w) => w.kind === "unknown_whereabouts" || w.kind === "far");
      if (target !== undefined && !warned && ctx.view.hexOf(target) === null) {
        chance *= 1 - DOUBT_PER_WEIGHT * UNKNOWN_WHEREABOUTS_WEIGHT;
      }
      const stakes = STAKES_RISK[def.stakes];
      const mood = ctx.mood?.(def.id, target) ?? 0;
      out.push({
        id: idOf(def, args),
        verb: def.id,
        ...(target === undefined ? {} : { target }),
        contributes,
        chance: r(clamp01(chance)),
        loss: stakes.loss,
        ...(stakes.risk > 0 ? { risk: stakes.risk } : {}),
        ...(mood === 0 ? {} : { mood: r(mood) }),
      });
    }
  }
  return out;
}

function capabilitiesFor(
  def: ActionDef,
  view: BeliefView,
): Partial<Record<"locomotion" | "manipulation" | "speech" | "strength", number>> {
  const caps: Partial<Record<"locomotion" | "manipulation" | "speech" | "strength", number>> = {};
  for (const req of def.requires) {
    if (req.kind === "capability") caps[req.cap] = view.capability(req.cap) ?? 1;
  }
  return caps;
}
