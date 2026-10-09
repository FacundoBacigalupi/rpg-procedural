// Esconder y aparentar habilidad (skills §9): pelear por debajo del nivel propio, fingir torpeza,
// exagerar en público. Lo que se muestra es un nivel aparte del verdadero; quien mira lo ve con su
// propia lectura (`reading`) y se resuelve como engaño: el control del que finge contra la vista
// del que mira. Puro y sin azar: quien llama pasa el ruido ya tirado (`noise`, una normal).

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Qué quiere mostrar: lo que es, menos (esconder) o más (aparentar). */
export type ShowStance = "natural" | "hide" | "show";

/** Cuánto se aparta de lo verdadero un buen actor, en nivel (calibración abierta). */
export const MAX_FEIGN_GAP = 0.45;
/** Cuánto cuesta sostener la pose: atención que no va a la tarea (0-1 del control). */
export const FEIGN_STRAIN = 0.25;

export interface SkillDisplay {
  /** El nivel que muestra, 0-1. */
  readonly shown: number;
  /** Distancia entre lo mostrado y lo verdadero (con signo: negativo es esconder). */
  readonly gap: number;
}

/**
 * El nivel que muestra: `want` es cuánto quiere apartarse (0-1 del máximo) y `control` cuánto
 * domina el fingir (0-1: la faceta de ejecución de una habilidad de engaño/actuación). Esconder no
 * puede bajar de «torpe de verdad» (0) ni aparentar subir más que lo que el control sostiene.
 */
export function displayedLevel(
  trueLevel: number,
  stance: ShowStance,
  want: number,
  control: number,
): SkillDisplay {
  if (stance === "natural") return { shown: clamp01(trueLevel), gap: 0 };
  const reach = MAX_FEIGN_GAP * clamp01(want) * (0.4 + 0.6 * clamp01(control));
  const sign = stance === "hide" ? -1 : 1;
  const shown = clamp01(trueLevel + sign * reach);
  return { shown: round(shown), gap: round(shown - trueLevel) };
}

/** La mirada de quien observa contra la pose: cuánto ve de la mentira (0-1). */
export function seeThroughMargin(
  display: SkillDisplay,
  observerReading: number,
  actorControl: number,
  noise: number,
): number {
  // Un hueco grande es más visible; el control lo disimula y la lectura del que mira lo delata.
  return round(
    1.2 * Math.abs(display.gap) +
      observerReading -
      actorControl -
      FEIGN_STRAIN * Math.abs(display.gap) +
      0.15 * noise,
  );
}

/** Si el que mira nota que la pose es falsa (margen sobre cero), sin decir en qué sentido. */
export function seesThrough(
  display: SkillDisplay,
  observerReading: number,
  actorControl: number,
  noise: number,
): boolean {
  return display.gap !== 0 && seeThroughMargin(display, observerReading, actorControl, noise) > 0;
}

/**
 * Lo que el que mira cree del nivel: lo mostrado si se lo creyó, o lo verdadero (con su
 * dispersión) si lo notó. Es la entrada de la opinión ajena (`SkillBelief` sobre otro, ítem aparte).
 */
export function observedLevel(
  trueLevel: number,
  display: SkillDisplay,
  seen: boolean,
): { level: number; fooled: boolean } {
  return seen
    ? { level: round(clamp01(trueLevel)), fooled: false }
    : { level: display.shown, fooled: display.gap !== 0 };
}

/** Cuánto pesa cada rasgo en las ganas de esconder el nivel (calibración abierta). */
export const HOLD_BACK_BASE = 0.12;
/** El hueco de nivel sobre el que cree del otro, desde el cual esconderse sale gratis del todo. */
export const HOLD_BACK_EDGE = 0.3;

export interface HoldBackWish {
  /** La chance de que decida esconderse en esta pelea, 0-1. */
  readonly chance: number;
  /** Cuánto se contiene si lo decide, 0-1 (el `holdBack` de la pelea). */
  readonly amount: number;
}

/**
 * Si un NPC pelea por debajo de su nivel para que el otro se confíe (skills §9): lo hace el astuto
 * (intelecto y dominio de sí, poca calidez) y el audaz, y solo si cree que le sobra, con lo que
 * *cree* del otro (`believedRival`, su opinión ajena; sin opinión se arriesga menos). Puro: quien
 * llama tira con la chance. `z` son los rasgos tipificados de quien decide.
 */
export function holdBackWish(
  z: Readonly<Record<string, number>>,
  ownLevel: number,
  believedRival: number | undefined,
): HoldBackWish {
  const cunning = ((z["intellect"] ?? 0) + (z["control"] ?? 0)) / 2 - 0.5 * (z["warmth"] ?? 0);
  let chance = HOLD_BACK_BASE + 0.1 * cunning + 0.05 * (z["boldness"] ?? 0);
  if (believedRival === undefined) chance *= 0.5;
  const edge = believedRival === undefined ? 0 : ownLevel - believedRival;
  if (believedRival !== undefined) {
    if (edge < 0.05) return { chance: 0, amount: 0 };
    chance *= clamp01(edge / HOLD_BACK_EDGE);
  }
  const amount = clamp01(0.5 + 0.15 * cunning);
  return { chance: round(clamp01(chance)), amount: round(amount) };
}
