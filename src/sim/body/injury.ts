// Herirse y tratarse (body-health §4, §11): un golpe, un corte o una caída se vuelven una herida
// concreta en una zona, con lo que sangra, si abrió un vaso o rompió un hueso, la suciedad que
// entró y cuán virulento es lo que entró. Las tiradas usan el rng de la herida (body-health,
// principio 7: `fork("body", entidad, evento)`). Tratar es física: limpiar saca suciedad y carga,
// vendar frena el sangrado, entablillar deja soldar el hueso.

import { type EventId, log, type Rng, type Tick } from "../../core/index.ts";
import type { VerbEffect } from "../actions/index.ts";
import { type BodyPlanDef, zoneOf } from "./plan.ts";
import type { Body, DeathCause, Wound, WoundKind } from "./state.ts";

/** Lo que llega al cuerpo: qué tipo de daño, con cuánta fuerza, dónde (si se sabe) y de qué evento. */
export interface Blow {
  readonly kind: WoundKind;
  /** 0-1: la fuerza que llegó (la del golpe ya pasada por lo que lo frenó). */
  readonly force: number;
  /** La zona, si el golpe apuntó o la caída la decide; si no, sale del tamaño de cada zona. */
  readonly zone?: string;
  /** 0-1: cuán sucio estaba lo que hirió (0,5 es lo de siempre: un palo, el suelo). */
  readonly dirt?: number;
  readonly cause: EventId;
  readonly at: Tick;
}

/** Cuánto daño hace cada tipo por unidad de fuerza. */
const KIND_HARM: Readonly<Record<WoundKind, number>> = { cut: 1, puncture: 0.9, blunt: 0.7 };
/** Litros por hora por unidad de gravedad, por tipo. */
const KIND_BLEED: Readonly<Record<WoundKind, number>> = { cut: 0.4, puncture: 0.25, blunt: 0.03 };
/** Mediana y dispersión (log) de cuán rápido crece lo que entra en una herida, por hora. */
export const VIRULENCE = { median: 0.1, sigma: 0.6 };

export interface Injury {
  readonly body: Body;
  readonly wound: Wound;
  /** Si el golpe mató en el acto (la cabeza). */
  readonly died: DeathCause | null;
}

/** Hace la herida. `rng` es el fork del golpe en este cuerpo. */
export function injure(plan: BodyPlanDef, body: Body, blow: Blow, rng: Rng): Injury {
  if (body.death) throw new RangeError("no se hiere a un muerto (es el cadáver, Fase 3)");
  const zone = blow.zone
    ? zoneOf(plan, blow.zone)
    : (plan.zones[rng.weighted(plan.zones.map((z) => z.size))] as BodyPlanDef["zones"][number]);
  const force = Math.min(1, Math.max(0, blow.force));
  const severity = Math.min(
    1,
    Math.max(0.02, force * KIND_HARM[blow.kind] * (0.75 + 0.5 * rng.float())),
  );
  const sharp = blow.kind !== "blunt";
  const arterial = sharp && severity > 0.3 && rng.chance(Math.min(1, zone.vessel * severity * 2));
  const fracture = rng.chance(Math.min(1, zone.bone * severity * (sharp ? 0.5 : 1.5)));
  const organ =
    zone.vital?.kind === "organ" &&
    (blow.kind === "puncture" ? severity > 0.25 : severity > (sharp ? 0.5 : 0.7));
  // Un golpe que no rompe la piel casi no deja entrar nada.
  const open = sharp || severity > 0.4;
  const contamination = Math.min(
    1,
    zone.contamination * (0.5 + (blow.dirt ?? 0.5)) * (open ? 1 : 0.1),
  );
  const virulence = rng.logNormal(log(VIRULENCE.median), VIRULENCE.sigma);
  const wound: Wound = {
    id: body.nextWound,
    kind: blow.kind,
    zone: zone.id,
    severity,
    bleeding: KIND_BLEED[blow.kind] * severity + (arterial ? 1.5 + 2 * severity : 0),
    arterial,
    internal: organ ? severity : 0,
    fracture,
    contamination,
    infection: contamination * 0.02,
    virulence,
    repair: 0,
    stage: "fresh",
    cleaned: false,
    bandaged: false,
    splinted: false,
    at: blow.at,
    cause: blow.cause,
  };
  const brain = zone.vital?.kind === "brain";
  const died: DeathCause | null =
    brain && severity >= (zone.vital?.lethal ?? 1) ? "brain_trauma" : null;
  // En la cabeza, un golpe fuerte deja sin sentido un rato.
  const knocked = brain && severity >= (sharp ? 0.5 : 0.35);
  const stunnedUntil = knocked
    ? Math.max(body.stunnedUntil ?? 0, blow.at + Math.round(severity * 2 * 3600))
    : body.stunnedUntil;
  return {
    body: {
      ...body,
      wounds: [...body.wounds, wound],
      nextWound: body.nextWound + 1,
      stunnedUntil,
      consciousness: knocked || died ? "unconscious" : body.consciousness,
      death: died ? { cause: died, at: blow.at } : body.death,
    },
    wound,
    died,
  };
}

/**
 * Lo que un golpe de la resolución de acciones le hace a quien lo recibe, o nada si no pegó. Sin
 * armas en la Fase 1, todo golpe es contundente; uno de refilón llega con menos fuerza.
 */
export function blowFromStrike(
  effect: VerbEffect,
  cause: EventId,
  at: Tick,
  kind: WoundKind = "blunt",
): Blow | null {
  if (effect.kind !== "strike" || !effect.committed || !effect.hit) return null;
  return { kind, force: effect.force * (effect.glancing ? 0.4 : 1), cause, at };
}

/**
 * Los percances de los verbos (actions §8): se cayó caminando o juntando, o se lastimó
 * trabajando. Una caída golpea una pierna o un brazo; el trabajo corta una mano con la
 * herramienta. La fuerza la pone el rng del percance.
 */
export function blowFromMishap(
  effect: VerbEffect,
  cause: EventId,
  at: Tick,
  rng: Rng,
): Blow | null {
  const fell = (effect.kind === "move" || effect.kind === "gather") && effect.stumbled;
  if (fell) {
    const zone = rng.pick(["left_leg", "right_leg", "left_arm", "right_arm", "head"] as const);
    return { kind: "blunt", force: rng.float() * 0.5, zone, dirt: 0.7, cause, at };
  }
  if (effect.kind === "work" && effect.hurt) {
    const zone = rng.pick(["left_arm", "right_arm", "left_leg"] as const);
    return { kind: "cut", force: 0.1 + rng.float() * 0.35, zone, dirt: 0.6, cause, at };
  }
  return null;
}

export type Treatment = "clean" | "bandage" | "splint";

/**
 * Trata una herida. Limpiar saca la suciedad y gran parte de la carga (nunca la sube); vendar
 * frena el sangrado de afuera (no el de adentro); entablillar sirve si hay hueso roto.
 */
export function treat(body: Body, woundId: number, how: Treatment): Body {
  const wounds = body.wounds.map((w) => {
    if (w.id !== woundId || w.stage === "healed") return w;
    if (how === "clean") {
      return {
        ...w,
        cleaned: true,
        contamination: w.contamination * 0.2,
        infection: w.infection * 0.3,
      };
    }
    if (how === "bandage") return { ...w, bandaged: true };
    return w.fracture ? { ...w, splinted: true } : w;
  });
  return { ...body, wounds };
}
