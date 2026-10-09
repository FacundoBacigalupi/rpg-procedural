// Lo que el personaje del jugador cree para evaluar la factibilidad de un plan (actions §5): el
// puente entre el juego y `assessPlan`. Es un muro como los paneles: del cuerpo vale lo que siente
// (redondeado, no el número), de la habilidad su autoimagen (skills §9), de las personas y los
// lugares lo que conoce (`knownEntities`) y de lo que tiene lo que carga. De lo que tiene el otro
// no sabe nada y no se avisa. Hasta que lleguen las creencias (Fase 2) lo conocido sale de ahí.

import type { EntityRef } from "../../core/index.ts";
import { type HolderRef, holderAccount } from "../../core/index.ts";
import {
  type BeliefView,
  BODY_STATE,
  type BodyPlanDef,
  capabilitiesOf,
  INNATE,
  isMoney,
  type KnownEntity,
  LOCATION,
  PERSON,
  PLACE,
  SELF_IMAGES,
  SKILL_STATE,
  seedSelfImage,
  standardize,
} from "../../sim/index.ts";
import { knownEntities } from "./known.ts";
import type { LifeWorld } from "./world.ts";

/** Cómo siente el cuerpo: a décimas, no el número exacto. */
const felt = (x: number) => Math.round(x * 10) / 10;

export function beliefViewOf(
  w: LifeWorld,
  known: readonly KnownEntity[] = knownEntities(w),
): BeliefView {
  const me = w.player;
  const byRef = new Map(known.map((k) => [k.ref, k] as const));
  const body = w.truth.get(BODY_STATE, me);
  const plan = body
    ? (w.plans.find((p) => p.id === body.plan) as BodyPlanDef | undefined)
    : undefined;
  const caps = body && plan ? capabilitiesOf(plan, body) : undefined;
  const images = w.truth.get(SELF_IMAGES, me);
  const skills = w.truth.get(SKILL_STATE, me);
  const here = w.truth.get(LOCATION, me)?.hex ?? 0;
  const held = w.ledger.holdings(holderAccount(me as unknown as HolderRef));
  const innate = w.truth.get(INNATE, me);
  const person = w.truth.get(PERSON, me);
  return {
    hex: here,
    // Sus rasgos y el lugar como los siente: con esto el aviso de riesgo usa la autoimagen.
    ...(innate && person
      ? {
          risk: {
            id: me,
            z: standardize(innate, w.traits, person.sex),
            scene: {
              light: 1,
              terrain: w.map.forest[here] ? 0.6 : 0.1,
              placeKinds: w.truth.ids(PLACE).flatMap((id) => {
                const p = w.truth.get(PLACE, id);
                return p?.hexes.includes(here) ? [p.kind] : [];
              }),
            },
          },
        }
      : {}),
    capability: (cap) => (caps ? felt(caps[cap]) : undefined),
    skill: (id) => {
      const state = skills?.[id];
      const def = w.skills.skill(id);
      const image =
        images?.[id] ?? (def && state ? seedSelfImage(def, state, {}, w.scheduler.now) : undefined);
      return image ? image.estimate : undefined;
    },
    hexOf: (ref: EntityRef) => {
      const k = byRef.get(ref);
      if (!k) return undefined;
      return k.at ?? null;
    },
    hexesOf: (ref: EntityRef) => byRef.get(ref)?.hexes,
    placeKindsAt: (hex) =>
      w.truth.ids(PLACE).flatMap((id) => {
        const p = w.truth.get(PLACE, id);
        return p?.hexes.includes(hex) ? [p.kind] : [];
      }),
    holds: (holder, what) => {
      if (holder !== "self") return undefined;
      const mine = held.filter((h) => h.amount > 0);
      return what === "money"
        ? mine.some((h) => isMoney(h.unit))
        : mine.some((h) => !isMoney(h.unit));
    },
    nameOf: (ref: EntityRef) => byRef.get(ref)?.names[0] ?? "eso",
  };
}
