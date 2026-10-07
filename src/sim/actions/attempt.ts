// La tirada común de un paso (actions §5, §7, §8): requisitos al ejecutar, factores, contienda,
// margen → resultado, la forma del fracaso por el factor que más restó y lo que el actor cree que
// pasó (autopercepción). No cambia el mundo: eso lo hace el resolver de cada verbo con este
// resultado (la tarea siguiente del ROADMAP). Puro y determinista: la tirada usa la clave
// `fork("action", actor, verb, tick)` y cada oponente tira con la suya.
//
// Todo va en desvíos: los rasgos llegan estandarizados (`standardize`), la facilidad del verbo y
// de los modos suma, cada factor suma o resta y la tirada es una normal. Un margen de 0 es una
// moneda al aire. El factor `skill` junta la aptitud cruda (rasgos innatos) y lo practicado (el
// nivel efectivo de la habilidad del verbo, que calcula `sim/skills` y llega en `actor.skill`).

import type { EntityRef, Rng, Tick } from "../../core/index.ts";
import type { Innate, Sex, Trait } from "../family/index.ts";
import type { PlaceKind } from "../world/index.ts";
import type { ActionDef, CapabilityKey, FactorKey, FailureModeId, Requirement } from "./catalog.ts";
import type { PlanNode } from "./plan.ts";

export type Outcome =
  | "success"
  | "partial"
  | "failure"
  /** Falló y el actor cree que salió bien. */
  | "failure_unnoticed"
  /** Falló y el actor sospecha. */
  | "failure_suspected"
  /** Salió, pero alguien lo vio. */
  | "discovered"
  /** Excepcional, para bien o para mal (el signo del margen dice cuál). */
  | "critical";

/** Lo que el actor cree de su resultado. */
export type BelievedOutcome = "success" | "partial" | "failure" | "unsure";

/** Umbrales de margen (en desvíos): calibración abierta (actions §12). */
export const CRITICAL_MARGIN = 2.5;
export const SUCCESS_MARGIN = 0.5;
export const PARTIAL_MARGIN = -0.5;
/** Un factor que resta al menos esto deja una pista que el actor puede percibir. */
export const CUE_THRESHOLD = 0.5;
/** Cuántos desvíos suma una habilidad en nivel 1 (skills §11; calibración abierta). */
export const SKILL_SPAN = 2.5;

export interface AttemptActor {
  readonly id: EntityRef;
  /** Rasgos en desvíos de la población (0 es el promedio). */
  readonly z: Readonly<Record<string, number>>;
  /** Capacidades del cuerpo, 0-1; las que faltan valen 1 (body-health §3, Fase 1). */
  readonly capabilities: Readonly<Partial<Record<CapabilityKey, number>>>;
  readonly hex: number;
  /** Nivel efectivo, 0-1, de la habilidad que usa el verbo (`sim/skills`); sin ella, 0. */
  readonly skill?: number;
}

/** Otra parte del paso (el blanco, la contraparte), por su rol. */
export interface AttemptParty {
  readonly id: EntityRef;
  readonly z: Readonly<Record<string, number>>;
  readonly hex: number;
  /** Nivel efectivo, 0-1, de la habilidad que pone en contra (`contest.skill`); sin ella, 0. */
  readonly skill?: number;
}

export interface Scene {
  /** 0 a oscuras, 1 a pleno sol. */
  readonly light: number;
  /** 0 llano y limpio, 1 lo más difícil (bosque cerrado, pendiente). */
  readonly terrain: number;
  /** Los lugares donde está el actor. */
  readonly placeKinds: readonly PlaceKind[];
}

export interface AttemptInput {
  readonly def: ActionDef;
  readonly node: Extract<PlanNode, { kind: "do" }>;
  /** Los modos de todo el plan; los que el verbo no tiene se ignoran. */
  readonly planManner: readonly string[];
  readonly actor: AttemptActor;
  readonly parties: Readonly<Record<string, AttemptParty>>;
  readonly scene: Scene;
  /** Si alguien tiene algo que ofrecer o que sacarle. */
  readonly has: (holder: EntityRef, what: "goods" | "money") => boolean;
  readonly tick: Tick;
  readonly rng: Rng;
}

export interface FactorValue {
  readonly factor: FactorKey;
  /** En desvíos: positivo ayuda, negativo resta. */
  readonly value: number;
}

export interface Attempt {
  /** La verdad. */
  readonly outcome: Outcome;
  /** null si no se tiró (faltó un requisito). */
  readonly margin: number | null;
  /**
   * El margen esperado sin el azar (la oposición con su media): cuán difícil era el paso para el
   * actor. Lo usa el aprendizaje (skills §3.1: se aprende más cerca del borde).
   */
  readonly expected: number | null;
  readonly factors: readonly FactorValue[];
  readonly failure: FailureModeId | null;
  /** El requisito que faltó, si fue eso. */
  readonly unmet: Requirement | null;
  /** Quienes notaron el intento (contienda de sigilo perdida). */
  readonly noticedBy: readonly EntityRef[];
  /** Lo que el actor cree que pasó. */
  readonly believed: BelievedOutcome;
  /** Los factores que el actor percibe que le jugaron en contra. */
  readonly cues: readonly FactorKey[];
}

/** Los modos que valen en este paso: los del paso y los del plan que el verbo conoce. */
export function activeManners(
  def: ActionDef,
  node: AttemptInput["node"],
  planManner: readonly string[],
) {
  const ids = new Set([...planManner, ...node.manner]);
  return def.manners.filter((m) => ids.has(m.id));
}

/** Cuánto dura el paso, en segundos. `pathSeconds` es lo que dice el camino para `path`. */
export function actionDuration(
  def: ActionDef,
  node: AttemptInput["node"],
  planManner: readonly string[],
  pathSeconds = 0,
): number {
  let base: number;
  const d = def.duration;
  if (d.kind === "fixed") base = d.seconds;
  else if (d.kind === "path") base = pathSeconds;
  else {
    const a = node.args.find((x) => x.role === d.role);
    base = Math.min(d.max, a && "seconds" in a ? a.seconds : d.default);
  }
  const k = activeManners(def, node, planManner).reduce((p, m) => p * m.duration, 1);
  return Math.max(1, Math.round(base * k));
}

/** Los rasgos innatos en desvíos de la población (con el corrimiento de los varones). */
export function standardize(
  innate: Innate,
  traits: readonly Trait[],
  sex: Sex,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of traits) {
    const v = innate[t.id];
    if (v === undefined) continue;
    out[t.id] = (v - t.mean - (sex === "male" ? (t.maleShift ?? 0) : 0)) / t.sd;
  }
  return out;
}

function weighted(
  z: Readonly<Record<string, number>>,
  ws: readonly { trait: string; weight: number }[],
) {
  return ws.reduce((s, w) => s + w.weight * (z[w.trait] ?? 0), 0);
}

function entityOf(node: AttemptInput["node"], role: string): EntityRef | undefined {
  const a = node.args.find((x) => x.role === role);
  return a && "entity" in a ? a.entity : undefined;
}

/** El primer requisito que no se cumple, o null. Los que nombran un rol ausente no aplican. */
export function unmetRequirement(input: AttemptInput): Requirement | null {
  const { def, node, actor, parties, scene, has } = input;
  for (const r of def.requires) {
    switch (r.kind) {
      case "capability":
        if ((actor.capabilities[r.cap] ?? 1) < r.min) return r;
        break;
      case "position":
        if ("near" in r) {
          if (entityOf(node, r.near) === undefined) break;
          const p = parties[r.near];
          if (!p || p.hex !== actor.hex) return r;
        } else if (!r.at.some((k) => scene.placeKinds.includes(k))) return r;
        break;
      case "means": {
        const holder = r.holder === "self" ? actor.id : entityOf(node, r.holder);
        if (holder !== undefined && !has(holder, r.what)) return r;
        break;
      }
    }
  }
  return null;
}

/** La forma del fracaso: la del factor que más restó entre los que el verbo sabe cómo fallan. */
function failureBy(def: ActionDef, factors: readonly FactorValue[]): FailureModeId | null {
  let worst: { id: FailureModeId; value: number } | null = null;
  for (const f of factors) {
    const mode = def.failureModes.find((m) => m.factor === f.factor);
    if (mode && (worst === null || f.value < worst.value)) worst = { id: mode.id, value: f.value };
  }
  return worst?.id ?? null;
}

export function attempt(input: AttemptInput): Attempt {
  const { def, node, actor, scene } = input;
  const rng = input.rng.fork("action", actor.id, def.id, input.tick);

  const unmet = unmetRequirement(input);
  if (unmet) {
    // Sin tirada: la forma la da el requisito, y el actor se da cuenta (no puede ni empezar).
    const factor: FactorKey = unmet.kind;
    return {
      outcome: "failure",
      margin: null,
      expected: null,
      factors: [],
      failure: def.failureModes.find((m) => m.factor === factor)?.id ?? null,
      unmet,
      noticedBy: [],
      believed: "failure",
      cues: [factor],
    };
  }

  const manners = activeManners(def, node, input.planManner);
  const f = def.factors;
  const factors: FactorValue[] = [];
  const push = (factor: FactorKey, value: number) => {
    if (value !== 0) factors.push({ factor, value });
  };
  const skill = weighted(actor.z, f.skill) + SKILL_SPAN * (actor.skill ?? 0);
  push("skill", skill);
  push("light", -2 * f.light * (1 - scene.light));
  push("terrain", -2 * f.terrain * scene.terrain);
  push("nerve", f.nerve * (actor.z["boldness"] ?? 0));
  const caps = def.requires.flatMap((r) => (r.kind === "capability" ? [r.cap] : []));
  if (caps.length > 0) {
    push("capability", -2 * (1 - Math.min(...caps.map((c) => actor.capabilities[c] ?? 1))));
  }

  const ease = def.ease + manners.reduce((s, m) => s + m.ease, 0);
  let expected = ease + factors.reduce((s, x) => s + x.value, 0);
  let margin = expected + rng.normal();

  // Contienda (§7.4): el otro tira con su propia clave.
  const noticedBy: EntityRef[] = [];
  const c = def.contest;
  const opp = c && entityOf(node, c.against) !== undefined ? input.parties[c.against] : undefined;
  if (c && opp) {
    const oRng = input.rng.fork("action", actor.id, def.id, input.tick, "oppose", opp.id);
    const against = weighted(opp.z, c.oppose) + SKILL_SPAN * (opp.skill ?? 0);
    const opposition = against + oRng.normal();
    if (!c.stealth) expected -= against;
    if (c.stealth) {
      // Perder la de sigilo no hace fallar: hace que el otro lo note.
      const stealth =
        manners.reduce((s, m) => s + m.stealth, 0) + 1.5 * (1 - scene.light) + skill + rng.normal();
      if (opposition > stealth) noticedBy.push(opp.id);
    } else {
      margin -= opposition;
    }
  }

  const truth: Outcome =
    Math.abs(margin) >= CRITICAL_MARGIN
      ? "critical"
      : margin >= SUCCESS_MARGIN
        ? "success"
        : margin >= PARTIAL_MARGIN
          ? "partial"
          : "failure";
  const failed = margin < PARTIAL_MARGIN;
  const failure = failed || truth === "partial" ? failureBy(def, factors) : null;

  // Autopercepción (§7.6): lo evidente del verbo, la percepción del actor y la luz.
  const cues = factors
    .filter((x) => x.value <= -CUE_THRESHOLD && x.factor !== "skill")
    .map((x) => x.factor);
  // Lo del todo evidente (perderse, errar el golpe) siempre se nota.
  const pNotice =
    def.evidence >= 1
      ? 1
      : clamp01(def.evidence + 0.15 * (actor.z["perception"] ?? 0) - 0.3 * (1 - scene.light));
  const notices = rng.chance(pNotice);

  let outcome: Outcome = truth;
  let believed: BelievedOutcome;
  if (truth === "critical") believed = margin > 0 ? "success" : "failure";
  else if (truth === "success") believed = "success";
  else if (truth === "partial") believed = notices ? "partial" : "success";
  else if (notices) believed = "failure";
  else if (rng.chance(0.5)) {
    outcome = "failure_suspected";
    believed = "unsure";
  } else {
    outcome = "failure_unnoticed";
    believed = "success";
  }
  if (noticedBy.length > 0 && (truth === "success" || truth === "partial")) outcome = "discovered";

  return { outcome, margin, expected, factors, failure, unmet: null, noticedBy, believed, cues };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
