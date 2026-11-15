// Desafíos y duelos (novel3-challenge-core, combat §13, social-structure §4, dialogue): retar a alguien es un
// acto social con cara en juego. El retado pesa lo que cree de sus chances, su orgullo, los testigos,
// la regla, su valentía, la distancia de rango y el rencor; rechazar en público puede costar más que
// perder. Las reglas del duelo son normas, no física: se pueden romper (eso es de quien pelea).
//
// Puro: recibe lo que el retado cree y siente; los números son de acá, sin calibrar.

import type { AgentId, EventId, PlaceRef, Rng, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import { faceStakes } from "./threats.ts";

/** Hasta dónde va el duelo: que uno se rinda (o caiga), la primera sangre, o la muerte. */
export type DuelRule = "yield" | "first_blood" | "death";
export const DUEL_RULES: readonly DuelRule[] = ["yield", "first_blood", "death"];

/** Lo que arriesga el cuerpo en cada regla (0-1): lo que pesa perder. */
export const DUEL_RISK: Readonly<Record<DuelRule, number>> = {
  first_blood: 0.15,
  yield: 0.35,
  death: 1,
};

/** Cuánto de la cara en juego cuesta rechazar según la regla: negarse a uno a muerte es prudencia. */
export const REFUSE_COST: Readonly<Record<DuelRule, number>> = {
  first_blood: 1,
  yield: 0.8,
  death: 0.35,
};

/** Un mayor que rechaza a uno de abajo pierde la mitad: «no me rebajo». */
export const SENIOR_REFUSE_RELIEF = 0.5;
/** Ruido de la decisión. */
export const CHALLENGE_NOISE = 0.05;
/** La cara que mueve el resultado, sin testigos (la de los dos: se sabe igual). */
export const DUEL_FACE_BASE = 0.03;
/** Lo que suma cada testigo a lo que mueve el resultado, hasta el tope de `faceStakes`. */
export const DUEL_FACE_PER_WITNESS = 0.02;
/** Por cada escalón de rango: ganarle a uno de arriba vale más; perder con uno de abajo cuesta más. */
export const DUEL_RANK_SHIFT = 0.25;

export interface ChallengeInput {
  readonly rule: DuelRule;
  /** 0-1: las chances que el retado cree tener de ganar (`believedOdds` sin golpes). */
  readonly myOdds: number;
  /** 0-1: orgullo / apego a la cara. */
  readonly pride: number;
  /** 0-1: valentía. */
  readonly courage: number;
  /** Los que presencian, sin contar a los dos. */
  readonly witnesses: number;
  /** Escalones de rango del retado sobre quien reta (negativo: quien reta está arriba). */
  readonly rankGap: number;
  /** 0-1: rencor del retado hacia quien reta. */
  readonly grudge: number;
}

export type ChallengeResponse = "accept" | "refuse";

/** Cómo quedó un desafío en el evento: además, esperando al personaje o vencido sin respuesta. */
export type ChallengeOutcome = ChallengeResponse | "pending" | "ignored";

export interface ChallengeVerdict {
  readonly response: ChallengeResponse;
  readonly scores: Readonly<Record<ChallengeResponse, number>>;
  /** La cara que pierde el retado si rechaza (0-1); quien reta gana la mitad. */
  readonly refuseFace: number;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round = (x: number) => Math.round(x * 1000) / 1000;

/** La cara que pierde quien rechaza: la que se juega en público, por la regla y el rango. */
export function refuseFace(i: Pick<ChallengeInput, "rule" | "pride" | "witnesses" | "rankGap">) {
  const stakes = faceStakes(i.pride, i.witnesses);
  const relief = i.rankGap > 0 ? SENIOR_REFUSE_RELIEF : 1;
  return round(stakes * REFUSE_COST[i.rule] * relief);
}

/**
 * Qué hace el retado. Aceptar paga lo que cree poder ganar, el rencor, la valentía y la cara que no
 * pierde; rechazar paga lo que arriesga el cuerpo si pierde (más en un duelo a muerte). Mismo seed,
 * misma respuesta.
 */
export function weighChallenge(i: ChallengeInput, rng: Rng): ChallengeVerdict {
  const odds = clamp01(i.myOdds);
  const risk = DUEL_RISK[i.rule];
  const lost = refuseFace(i);
  const scores: Record<ChallengeResponse, number> = {
    accept: odds * 0.8 + clamp01(i.grudge) * 0.3 + clamp01(i.courage) * 0.2 + lost * 1.5,
    refuse: (1 - odds) * risk * 1.2 + 0.35,
  };
  let best: ChallengeResponse = "refuse";
  let top = Number.NEGATIVE_INFINITY;
  for (const r of ["accept", "refuse"] as const) {
    const v = scores[r] + (rng.float() - 0.5) * 2 * CHALLENGE_NOISE;
    scores[r] = round(scores[r]);
    if (v > top) {
      top = v;
      best = r;
    }
  }
  return { response: best, scores, refuseFace: lost };
}

/**
 * La cara que mueve el resultado del duelo: lo que gana el vencedor y pierde el vencido, más con
 * testigos y con lo que arriesgaba la regla; `rankGap` es del vencido sobre el vencedor (ganarle a
 * uno de arriba vale más, y a ese le cuesta más perder).
 */
export function duelFace(
  rule: DuelRule,
  witnesses: number,
  rankGap: number,
): { readonly win: number; readonly lose: number } {
  const w = Math.min(4, Math.max(0, Math.floor(witnesses)));
  const base = (DUEL_FACE_BASE + DUEL_FACE_PER_WITNESS * w) * (0.5 + DUEL_RISK[rule]);
  const shift = 1 + DUEL_RANK_SHIFT * Math.max(-2, Math.min(2, rankGap));
  const v = round(clamp01(base * Math.max(0.25, shift)));
  return { win: v, lose: v };
}

/** La regla que dice un desafío (texto ya normalizado, sin tildes); sin decirla, hasta rendirse. */
export function duelRuleIn(norm: string): DuelRule {
  if (/\b(a muerte|hasta la muerte|vida o muerte|plataforma)\b/.test(norm)) return "death";
  if (/\b(primera sangre|hasta que (?:uno )?sangre|hasta sangrar)\b/.test(norm))
    return "first_blood";
  return "yield";
}

/**
 * Si el texto (normalizado) reta a duelo: «te desafío», «te reto a un duelo», «te reto a pelear». Un
 * «te reto» suelto es retar en el sentido de rezongar: sin duelo ni pelea, no es un desafío.
 */
export function challenges(norm: string): boolean {
  if (/\bdesafi\w*\b/.test(norm)) return true;
  return (
    /\bret(?:o|ar|arte|arlo|arla|amos)\b/.test(norm) &&
    /\b(duelo|pelea\w*|combat\w*|batirnos|batirte|muerte|plataforma|primera sangre)\b/.test(norm)
  );
}

/** El evento de un desafío contestado: `data` lleva la regla, la respuesta y la cara de rechazar. */
export const CHALLENGE_EVENT = "combat.challenge";

/** Un duelo aceptado y todavía no peleado, en la entidad de cada uno de los dos. */
export interface Duel {
  /** Con quién. */
  readonly with: AgentId;
  readonly rule: DuelRule;
  /** Quién retó. */
  readonly challenger: AgentId;
  readonly at: Tick;
  /** Hasta cuándo vale lo acordado: después, ya no es un duelo. */
  readonly until: Tick;
  /** El desafío aceptado. */
  readonly event: EventId;
}

export const DUEL = table<Duel>("combat.duel");

/** Días que vale un desafío aceptado (calibración abierta). */
export const DUEL_DAYS = 1;

/** Si `d` es un duelo vivo con `other` en `now`. */
export function duelWith(d: Duel | undefined, other: AgentId, now: Tick): d is Duel {
  return d !== undefined && d.with === other && now <= d.until;
}

/**
 * Un desafío que espera la respuesta del personaje (novel3-challenge-npc): la simulación no decide
 * por el jugador; queda anotado en él hasta que conteste (acepta o rechaza hablándole a quien lo
 * retó) o se le pase el plazo, que delante de otros cuesta lo mismo que rechazarlo.
 */
export interface DuelOffer {
  readonly from: AgentId;
  readonly rule: DuelRule;
  readonly at: Tick;
  readonly until: Tick;
  /** La cara que le cuesta no aceptarlo (0 si lo retaron a solas). */
  readonly refuseFace: number;
  readonly event: EventId;
  readonly place: PlaceRef;
}

export const DUEL_OFFER = table<DuelOffer>("combat.duel_offer");

/** Horas que espera un desafío al personaje antes de darse por rechazado (calibración abierta). */
export const DUEL_OFFER_HOURS = 2;

/** Cuándo retó por última vez a cada uno (por id): para no retar a cada rato al mismo. */
export const CHALLENGES_SENT = table<Readonly<Record<string, Tick>>>("combat.challenges_sent");

/** Días entre un desafío y el siguiente al mismo (calibración abierta). */
export const CHALLENGE_COOLDOWN_DAYS = 7;

/** Lo que el retado cree de cada uno para pelear: su nivel (0-1) y los umbrales cruzados. */
export interface DuelStanding {
  readonly skill: number;
  readonly stage: number;
}

/** Cuánto pesa un umbral cruzado frente al oficio (calibración abierta). */
export const DUEL_STAGE_HALF = 2;

/** Lo que vale alguien para pelear, creído: la mitad oficio, la mitad umbrales (con techo suave). */
export function duelPower(s: DuelStanding): number {
  const stage = Math.max(0, s.stage);
  return clamp01(0.5 * clamp01(s.skill) + 0.5 * (stage / (stage + DUEL_STAGE_HALF)));
}

/**
 * Las chances que el retado cree tener antes de pelear (sin golpes vistos, como `believedOdds`): lo
 * que cree valer él, por cómo está el cuerpo (`condition`, 0-1), contra lo que cree del otro.
 */
export function challengeOdds(mine: DuelStanding, theirs: DuelStanding, condition: number): number {
  return round(clamp01(0.5 + 0.8 * (duelPower(mine) * clamp01(condition) - duelPower(theirs))));
}
