// Factibilidad creída (actions §5, primer paso): antes de ejecutar, el actor evalúa el plan contra
// lo que CREE: su cuerpo como lo siente, lo que cree saber hacer (la autoimagen, skills §9), dónde
// cree que está cada cosa y cada persona, y qué cree que tiene cada uno. Nunca mira la verdad: si
// el actor se equivoca, se entera al ejecutar (el segundo paso es `attempt`, contra la verdad).
//
// El resultado son avisos en términos del personaje ("nunca aprendiste a hacer eso", "creés que
// Wu está lejos"). Para el jugador son solo eso: si insiste, se intenta. Los que `blocks` son los
// que un NPC no intenta, porque cree que no puede (el jugador sí puede, es libre). Las normas no
// son requisitos y no aparecen acá (law, social-structure §4). Puro y sin tiradas.

import type { EntityRef } from "../../core/index.ts";
import type { PlaceKind } from "../world/index.ts";
import type { ActionCatalog, CapabilityKey, Requirement } from "./catalog.ts";
import { type ActionPlan, type PlanNode, planLeaves } from "./plan.ts";

/** Todo lo que el actor cree, sin la verdad. Lo que no sabe queda `undefined`: no se avisa. */
export interface BeliefView {
  /** El hex donde el actor cree estar (su posición la percibe). */
  readonly hex: number;
  /** Cómo siente el cuerpo, 0-1; sin dato, no hay aviso. */
  capability(cap: CapabilityKey): number | undefined;
  /** Su autoimagen de la habilidad (skills §9); `undefined` si nunca la practicó ni la vio. */
  skill(id: string): { readonly level: number; readonly spread: number } | undefined;
  /** Dónde cree que está una persona o cosa: un hex, `null` si cree no saberlo, `undefined` si no la conoce. */
  hexOf(ref: EntityRef): number | null | undefined;
  /** Los hexes de un lugar que conoce. */
  hexesOf(ref: EntityRef): readonly number[] | undefined;
  /** Los tipos de lugar que cree que hay en un hex. */
  placeKindsAt(hex: number): readonly PlaceKind[];
  /** Si cree que `holder` ("self": él) tiene bienes o dinero; `undefined` si no tiene idea. */
  holds(holder: EntityRef | "self", what: "goods" | "money"): boolean | undefined;
  /** Cómo nombra a alguien o algo, para el aviso. */
  nameOf(ref: EntityRef): string;
}

export const WARNING_KINDS = [
  "body",
  "wrong_place",
  "no_means",
  "far",
  "unknown_whereabouts",
  "untrained",
  "unskilled",
] as const;
export type WarningKind = (typeof WARNING_KINDS)[number];

export interface FeasibilityWarning {
  readonly kind: WarningKind;
  /** El camino de la hoja del plan ("0.1"). */
  readonly at: string;
  readonly verb: string;
  /** Un NPC no intenta lo que cree imposible; el jugador recibe el aviso y decide. */
  readonly blocks: boolean;
  /** Cuánto pesa el aviso (0-1): ordena y deja callar los menores. */
  readonly weight: number;
  /** En palabras del personaje. */
  readonly text: string;
}

/** Debajo de este nivel creído la habilidad se siente como «casi nada» (calibración abierta). */
export const UNSKILLED_BELIEVED = 0.1;

const BODY_TEXT: Record<CapabilityKey, string> = {
  locomotion: "las piernas no te dan para eso",
  manipulation: "con las manos como las tenés ahora no vas a poder",
  speech: "no creés poder hablar bien ahora",
  strength: "no creés tener la fuerza para eso",
};

/**
 * Los avisos del plan según lo que el actor cree. El orden es el de los pasos y, dentro de uno, el
 * de los requisitos del verbo: determinista, sin azar.
 */
export function assessPlan(
  plan: ActionPlan,
  catalog: ActionCatalog,
  view: BeliefView,
): FeasibilityWarning[] {
  const out: FeasibilityWarning[] = [];
  // Dónde cree el actor que va a estar al llegar a cada paso (los `move` lo cambian).
  let at: number | undefined = view.hex;
  let arrived: readonly number[] = [];
  for (const { path, node } of planLeaves(plan.root)) {
    const def = catalog.verb(node.verb);
    if (!def) continue;
    const where = path.join(".") || "0";
    const push = (kind: WarningKind, blocks: boolean, weight: number, text: string): void => {
      out.push({ kind, at: where, verb: node.verb, blocks, weight, text });
    };

    for (const r of def.requires) {
      requirement(r, node, view, at, arrived, push);
    }
    if (def.skill) {
      const s = view.skill(def.skill.id);
      if (s === undefined) {
        push("untrained", false, 0.6, `nunca aprendiste a hacer esto (${def.name})`);
      } else if (s.level < UNSKILLED_BELIEVED) {
        push("unskilled", false, 0.3, `sabés muy poco de esto (${def.name})`);
      }
    }
    if (def.resolver === "move") {
      const to = node.args.find((a) => a.role === "to");
      const hexes = to && "entity" in to ? view.hexesOf(to.entity) : undefined;
      if (hexes && hexes.length > 0) {
        arrived = hexes;
        at = Math.min(...hexes);
      } else {
        arrived = [];
        at = undefined;
      }
    }
  }
  return out;
}

function requirement(
  r: Requirement,
  node: Extract<PlanNode, { kind: "do" }>,
  view: BeliefView,
  at: number | undefined,
  arrived: readonly number[],
  push: (kind: WarningKind, blocks: boolean, weight: number, text: string) => void,
): void {
  const entity = (role: string): EntityRef | undefined => {
    const a = node.args.find((x) => x.role === role);
    return a && "entity" in a ? a.entity : undefined;
  };
  switch (r.kind) {
    case "capability": {
      const felt = view.capability(r.cap);
      if (felt !== undefined && felt < r.min) push("body", true, 1, BODY_TEXT[r.cap]);
      return;
    }
    case "position": {
      if (at === undefined) return;
      if ("near" in r) {
        const who = entity(r.near);
        if (who === undefined) return;
        const hex = view.hexOf(who);
        if (hex === undefined) return;
        if (hex === null) {
          push("unknown_whereabouts", false, 0.4, `no sabés dónde está ${view.nameOf(who)}`);
        } else if (hex !== at && !arrived.includes(hex)) {
          push("far", false, 0.5, `creés que ${view.nameOf(who)} no está cerca`);
        }
        return;
      }
      const kinds = view.placeKindsAt(at);
      if (!r.at.some((k) => kinds.includes(k))) {
        push("wrong_place", true, 0.8, "acá no hay dónde hacer eso");
      }
      return;
    }
    case "means": {
      const holder = r.holder === "self" ? "self" : entity(r.holder);
      if (holder === undefined) return;
      if (view.holds(holder, r.what) !== false) return;
      const what = r.what === "money" ? "con qué pagar" : "nada que ofrecer";
      push(
        "no_means",
        true,
        0.9,
        holder === "self"
          ? `no tenés ${what}`
          : `creés que ${view.nameOf(holder)} no tiene nada que dar`,
      );
      return;
    }
  }
}

/** Un NPC solo intenta lo que cree posible (actions §5). */
export function believesPossible(warnings: readonly FeasibilityWarning[]): boolean {
  return warnings.every((w) => !w.blocks);
}

/** Los avisos en una sola línea para el jugador, los más pesados primero y sin repetir. */
export function renderWarnings(warnings: readonly FeasibilityWarning[], max = 3): string {
  const seen = new Set<string>();
  const texts: string[] = [];
  for (const w of [...warnings].sort((a, b) => b.weight - a.weight)) {
    if (seen.has(w.text)) continue;
    seen.add(w.text);
    texts.push(w.text);
  }
  return texts.slice(0, max).join("; ");
}
