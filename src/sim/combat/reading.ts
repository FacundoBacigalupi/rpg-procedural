// Leer al rival, fintas, chances creídas y quiebre (combat.md §5, §11), parte pura. Nada de esto
// toca la verdad del rival: `readRival` arma una creencia (`RivalRead`) con ruido según la vista, la
// luz y el ojo de quien lee; la finta se resuelve contra lo que el defensor lee de ella; las
// chances creídas salen de esa lectura y de lo que se ve de la pelea; y el quiebre mira esas chances
// contra el punto de quiebre y los impulsos que empujan a seguir. Todo determinista: el ruido sale
// de la `Rng` que se pasa, y las mismas entradas dan lo mismo.

import type { Rng } from "../../core/index.ts";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Quien lee: cuánto ve y cuánto sabe mirar. */
export interface Reader {
  /** 0-1: capacidad de ver del cuerpo. */
  readonly sight: number;
  /** 0-1: el nivel de pelea (el ojo entrenado, skills §2). */
  readonly skill: number;
  /** 0-1: familiaridad con el estilo de este rival (skills §2.3). */
  readonly familiarity?: number;
}

/** Lo que del rival se deja ver: la verdad, que solo `readRival` toca. */
export interface Readable {
  /** 0-1: su potencia real para pelear. */
  readonly power: number;
  /** 0-1: el aire que le queda. */
  readonly breath: number;
  /** 0-1: cuánto del cuerpo perdió por heridas. */
  readonly hurt: number;
  /** 0-1: cuánto miedo tiene. */
  readonly fear: number;
  /** 0-1: cuánto esconde su nivel (aparenta torpeza, §5): tira la potencia leída hacia abajo. */
  readonly hides?: number;
  /** Golpes seguidos que dio antes de abrir la guardia (un vicio, skills §5). */
  readonly streak?: number;
  /** Después de cuántos golpes seguidos baja la guardia, si tiene el vicio (0 = no lo tiene). */
  readonly dropsGuardAfter?: number;
}

/** Lo que alguien cree del rival: una creencia con incertidumbre, no el estado real. */
export interface RivalRead {
  readonly power: number;
  readonly tired: number;
  readonly hurt: number;
  readonly afraid: number;
  /** Desvío de la lectura (0-1): cuánto no se fía de ella. */
  readonly spread: number;
  /** Cree que va a bajar la guardia en el próximo golpe (leyó el vicio). */
  readonly guardDownSoon: boolean;
}

/** Ruido máximo de una lectura a ciegas, en potencia (a vista y ojo nulos). */
export const READ_NOISE = 0.35;
/** Cuánto baja la potencia leída un rival que esconde su nivel (a esconder 1, en potencia). */
export const HIDE_SHIFT = 0.3;

/** Qué tan clara es la lectura: vista, luz, ojo entrenado y haber visto pelear a este rival. */
export function clarity(r: Reader, light: number): number {
  const seen = clamp01(r.sight * (0.3 + 0.7 * clamp01(light)));
  return clamp01(seen * (0.4 + 0.45 * clamp01(r.skill) + 0.15 * clamp01(r.familiarity ?? 0)));
}

/** Lee al rival (combat §5): una creencia ruidosa; con luz y ojo, cerca de la verdad. */
export function readRival(reader: Reader, foe: Readable, light: number, rng: Rng): RivalRead {
  const c = clarity(reader, light);
  const spread = round(READ_NOISE * (1 - c));
  const noisy = (x: number) => clamp01(x + rng.normal(0, spread / 2));
  const hides = clamp01(foe.hides ?? 0);
  // Lo que esconde se cree en la medida en que no se lo ve bien: quien lee claro no se deja engañar.
  const shown = foe.power - HIDE_SHIFT * hides * (1 - c);
  const after = foe.dropsGuardAfter ?? 0;
  const guardDownSoon = after > 0 && (foe.streak ?? 0) + 1 >= after && rng.chance(c);
  return {
    power: round(noisy(shown)),
    tired: round(noisy(1 - foe.breath)),
    hurt: round(noisy(foe.hurt)),
    // El miedo se ve menos que la sangre.
    afraid: round(noisy(foe.fear * (0.5 + 0.5 * c))),
    spread,
    guardDownSoon,
  };
}

// ---- Fintas ----

export type FeintOutcome = "bought" | "read";

export interface FeintResult {
  readonly outcome: FeintOutcome;
  /** Pulsos que cuesta la finta a quien la hace (siempre ≥ 1: el tiempo se gasta aunque no compre nada). */
  readonly cost: number;
  /** Equilibrio que pierde el defensor si la compra (0 si la lee). */
  readonly balanceLost: number;
  /** Ventaja para el siguiente golpe de quien fintó (0-1): el defensor reaccionó mal. */
  readonly opening: number;
}

export interface FeintDefender {
  readonly sight: number;
  /** 0-1: nivel de pelea de quien defiende (su `reading`). */
  readonly skill: number;
  /** Está atento (si no, la compra casi seguro). */
  readonly alert: boolean;
  readonly familiarity?: number;
}

/** Equilibrio que pierde quien reacciona a una finta que compró. */
export const FEINT_BALANCE = 0.3;
/** Ventaja que deja una finta comprada. */
export const FEINT_OPENING = 0.5;

/**
 * Una finta es una preparación falsa (§5). La compra el defensor que no la lee como falsa: cuanto
 * más ve y más entrenado, menos. Contra un ojo muy entrenado cuesta tiempo y no compra nada.
 */
export function resolveFeint(
  feinter: { readonly skill: number },
  defender: FeintDefender,
  light: number,
  rng: Rng,
): FeintResult {
  const c = clarity(
    { sight: defender.sight, skill: defender.skill, familiarity: defender.familiarity ?? 0 },
    light,
  );
  const buy = defender.alert ? clamp01(0.55 + 0.45 * clamp01(feinter.skill) - 0.9 * c * c) : 0.95;
  const bought = rng.chance(buy);
  return {
    outcome: bought ? "bought" : "read",
    cost: bought ? 1 : 2,
    balanceLost: bought ? FEINT_BALANCE : 0,
    opening: bought ? FEINT_OPENING * (0.5 + 0.5 * clamp01(feinter.skill)) : 0,
  };
}

// ---- Chances creídas ----

export interface OddsBelief {
  /** 0-1: cuánto cree que gana. */
  readonly myOdds: number;
  /** Cuánto se fía poco de la cifra (de la lectura del rival). */
  readonly spread: number;
}

export interface OddsFacts {
  /** Mi potencia tal como la siento (0-1). */
  readonly myPower: number;
  /** Golpes que metí y que comí (combat §11: se ven). */
  readonly landed: number;
  readonly taken: number;
  /** Compañeros míos que cayeron y rivales que cayeron (visibles). */
  readonly alliesDown?: number;
  readonly foesDown?: number;
  /** 0-1: el rival se mueve más rápido o fuerte de lo que esperaba. */
  readonly surprise?: number;
}

/** Peso de cada golpe visto, de cada caído y de la sorpresa sobre las chances. */
export const HIT_WEIGHT = 0.06;
export const DOWN_WEIGHT = 0.1;
export const SURPRISE_WEIGHT = 0.2;

/** Chances creídas a partir de la lectura del rival y de lo visto en la pelea (§11). */
export function believedOdds(read: RivalRead, f: OddsFacts): OddsBelief {
  // El rival leído: más herido y cansado vale menos.
  const foePower = clamp01(read.power * (1 - 0.35 * read.hurt) * (1 - 0.25 * read.tired));
  const seen =
    HIT_WEIGHT * (f.landed - f.taken) +
    DOWN_WEIGHT * ((f.foesDown ?? 0) - (f.alliesDown ?? 0)) -
    SURPRISE_WEIGHT * clamp01(f.surprise ?? 0) +
    0.1 * read.afraid;
  return {
    myOdds: round(clamp01(0.5 + 0.8 * (clamp01(f.myPower) - foePower) + seen)),
    spread: read.spread,
  };
}

// ---- Quiebre ----

export type Drive = "fear" | "anger" | "desperation" | "duty" | "pride" | "hate" | "protect";

export interface BreakInput {
  readonly belief: OddsBelief;
  /** Punto de quiebre (temperamento, experiencia, nada que perder). */
  readonly breakAt: number;
  /** Impulsos que empujan a seguir, cada uno 0-1. */
  readonly drivers: Readonly<Partial<Record<Drive, number>>>;
  /** Puede correr (locomoción y aire). */
  readonly canRun: boolean;
  /** Está acorralado (sin salida): la desesperación sube las ganas. */
  readonly cornered: boolean;
  /** El rival lo alcanzaría si corre. */
  readonly foeFaster: boolean;
  /** 0-1: pánico, baja la cognición. */
  readonly panic?: number;
}

export type BreakKind = "hold" | "flee" | "yield" | "freeze";

export interface BreakDecision {
  readonly kind: BreakKind;
  /** Disposición a seguir, ya sumados los impulsos (§11 `will`). */
  readonly will: number;
}

/** Cuánto suma cada impulso a la disposición a seguir. */
export const DRIVER_WEIGHT: Readonly<Record<Drive, number>> = {
  fear: -0.15,
  anger: 0.12,
  desperation: 0.2,
  duty: 0.1,
  pride: 0.08,
  hate: 0.1,
  protect: 0.15,
};

/** Cuánto pesa no fiarse de la lectura cuando las chances ya son bajas. */
export const DOUBT_WEIGHT = 0.3;

/**
 * Se quiebra quien cree que sus chances cayeron por debajo de su punto de quiebre, corridas por los
 * impulsos y por no fiarse de su lectura. Si se quiebra: huye si puede correr (y el otro no lo
 * alcanza, o con suerte), se rinde si no, y con pánico fuerte y sin salida se paraliza.
 */
export function resolveBreak(input: BreakInput, rng: Rng): BreakDecision {
  let will = 0;
  for (const [k, v] of Object.entries(input.drivers)) {
    will += DRIVER_WEIGHT[k as Drive] * clamp01(v ?? 0);
  }
  if (input.cornered) will += 0.1;
  const doubt = DOUBT_WEIGHT * input.belief.spread * (1 - input.belief.myOdds);
  const edge = input.belief.myOdds + will - doubt;
  if (edge >= input.breakAt) return { kind: "hold", will: round(will) };
  const panic = clamp01(input.panic ?? 0);
  if (input.cornered && panic > 0.7 && rng.chance(panic - 0.5)) {
    return { kind: "freeze", will: round(will) };
  }
  if (input.canRun && !input.cornered && (!input.foeFaster || rng.chance(0.3))) {
    return { kind: "flee", will: round(will) };
  }
  return { kind: "yield", will: round(will) };
}
