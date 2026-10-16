// La vendetta como justicia por defecto (law §9, contracts §11): donde el consejo no alcanza al
// acusado (el citado desoyó, o el foro no tuvo fuerza para sancionar), el acusador y su linaje
// pueden cobrárselo solos. Puro y sin IO. Se decide con lo que el acusador CREE (cuánto creyó el foro
// la denuncia, su propio rencor hacia el acusado) y cuánto confía en el tribunal (su lealtad al foro);
// nunca con la verdad del hecho. Escala por etapas acotadas y se cierra al enfriarse el rencor.

import type { AgentId, Tick } from "../../core/index.ts";
import type { Case, Vendetta } from "./cases.ts";

/** Tope de la escalada: murmullo, aislamiento y enemistad abierta. */
export const MAX_VENDETTA_STAGE = 3;
/** Parientes que sostienen la vendetta, como mucho. */
export const MAX_VENDETTA_KIN = 4;
/** Días entre un escalón y el siguiente. */
export const VENDETTA_ESCALATION_DAYS = 10;
/** Rencor por debajo del cual el acusador la deja morir. */
export const VENDETTA_COOL_BELOW = 0.1;
/** Rencor que sube por etapa al acusador hacia el acusado. */
export const VENDETTA_GAIN = 0.1;
/** Rencor que gana el acusado hacia el acusador, como parte de lo que gana el acusador. */
export const VENDETTA_RETURN = 0.5;
/** Rencor que gana cada pariente del acusador, como parte de lo que gana el acusador. */
export const VENDETTA_KIN_SHARE = 0.5;

export interface VendettaRules {
  readonly escalationDays: number;
  readonly gain: number;
  readonly coolBelow: number;
}

export const DEFAULT_VENDETTA_RULES: VendettaRules = {
  escalationDays: VENDETTA_ESCALATION_DAYS,
  gain: VENDETTA_GAIN,
  coolBelow: VENDETTA_COOL_BELOW,
};

/** Por qué el consejo no alcanzó al acusado, si no lo alcanzó (null: el caso no abre vendetta). */
export function unreachedReason(c: Case): "defied" | "unreached" | null {
  if (c.vendetta) return null;
  if (c.status === "defied") return "defied";
  if (c.status === "dropped" && (c.response === "sanction" || c.response === "summon")) {
    return "unreached";
  }
  return null;
}

export interface VendettaGrievance {
  /** Cuánto creyó el foro la denuncia (0-1). */
  readonly belief: number;
  /** Rencor del acusador hacia el acusado (0-1). */
  readonly resentment: number;
  /** Lealtad del acusador al foro (0-1): quien confía en el tribunal no se hace justicia. */
  readonly loyalty: number;
  readonly reason: "defied" | "unreached";
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Probabilidad de declarar la vendetta: agravio creído, menos la fe en el tribunal. */
export function vendettaChance(g: VendettaGrievance): number {
  const grievance = 0.5 * clamp01(g.belief) + 0.5 * clamp01(g.resentment);
  const trust = 1 - 0.6 * clamp01(g.loyalty);
  const base = g.reason === "defied" ? 1 : 0.6;
  return round(clamp01(grievance * trust * base));
}

/** Registra la decisión: declarada (etapa 1, con su linaje) o descartada. */
export function decideVendetta(
  c: Case,
  reason: "defied" | "unreached",
  declare: boolean,
  chance: number,
  kin: readonly AgentId[],
  at: Tick,
): Case {
  const v: Vendetta = {
    status: declare ? "active" : "declined",
    reason,
    decidedAt: at,
    chance,
    stage: declare ? 1 : 0,
    lastAt: at,
    kin: declare ? [...kin].sort().slice(0, MAX_VENDETTA_KIN) : [],
  };
  return { ...c, vendetta: v };
}

/** ¿Toca revisar la vendetta activa (escalar o enfriar)? */
export function vendettaDue(c: Case, now: Tick, wait: Tick): boolean {
  const v = c.vendetta;
  return v !== undefined && v.status === "active" && now - v.lastAt >= wait;
}

/** Cierra la vendetta (rencor enfriado, acusado ausente o tope de la escalada sin más que hacer). */
export function closeVendetta(c: Case, at: Tick): Case {
  return c.vendetta ? { ...c, vendetta: { ...c.vendetta, status: "closed", lastAt: at } } : c;
}

/** Sube una etapa si el rencor del acusador sigue vivo; si se enfrió la cierra. */
export function escalateVendetta(
  c: Case,
  grudge: number,
  at: Tick,
  coolBelow: number = VENDETTA_COOL_BELOW,
): Case {
  const v = c.vendetta;
  if (v?.status !== "active") return c;
  if (grudge < coolBelow || v.stage >= MAX_VENDETTA_STAGE) return closeVendetta(c, at);
  return { ...c, vendetta: { ...v, stage: v.stage + 1, lastAt: at } };
}

/** Cuánto rencor suma una etapa al acusador hacia el acusado. */
export function vendettaPush(stage: number, gain: number = VENDETTA_GAIN): number {
  return round(Math.max(0, Math.min(MAX_VENDETTA_STAGE, stage)) * Math.max(0, gain));
}
