// La sesión de oficio (crafts §1): un proceso por pasos sobre materiales reales. Cada minuto el
// artesano elige qué hacer con el fuego mirando solo lo que **percibe** (`PerceivedWork`), la mano
// ejecuta con ruido según su control, la ley (calor → cocción y quemado) cambia el trabajo real
// (`WorkState`) y los sentidos lo vuelven a leer con error. El producto es lo que quedó al final,
// no una tirada: crudo, a punto, seco o quemado, con la calidad que eso dé.
//
// Puro y determinista: el ruido sale de `rng.fork("craft", ...)`. Ninguna decisión lee el estado
// real: `decide` y `judge` reciben lo percibido y nada más.

import type { Rng, Tick } from "../../core/index.ts";
import type { RecipeDef } from "./recipe.ts";

/** La mano del artesano, 0-1 cada una (crafts §1, «la habilidad»). */
export interface Hands {
  /** Cuánto se aparta el fuego de lo que quiere: el pulso. */
  readonly control: number;
  /** Cuánto ve del estado del trabajo mientras lo hace. */
  readonly senses: number;
  /** Cuánto sabe corregir y anticiparse. */
  readonly judgment: number;
}

/** El estado real del trabajo (verdad). Nadie que decida lo lee. */
export interface WorkState {
  /** Temperatura del horno, °C. */
  readonly temperature: number;
  /** 0 crudo, 1 a punto, más es pasado. */
  readonly doneness: number;
  /** 0-1: cuánto se quemó. */
  readonly scorch: number;
}

/** Lo que el artesano cree ver del trabajo. */
export interface PerceivedWork {
  readonly temperature: number;
  readonly doneness: number;
  /** Minutos de cocción hasta ahora. */
  readonly minutes: number;
}

export interface SessionInput {
  readonly recipe: RecipeDef;
  readonly hands: Hands;
  readonly rng: Rng;
  /** Para la clave del ruido: de quién y cuándo. */
  readonly who: string;
  readonly tick: Tick;
}

export interface SessionResult {
  /** Lo que quedó (verdad). */
  readonly work: WorkState;
  /** La calidad real del producto, 0-1. */
  readonly quality: number;
  /** La calidad que el artesano cree que tiene lo que hizo, 0-1. */
  readonly perceivedQuality: number;
  /** Gramos de producto por gramo de insumo, ya con lo que se quemó. */
  readonly yield: number;
  /** Segundos que llevó todo: preparar y cocer. */
  readonly seconds: number;
  /** Minutos de cocción. */
  readonly cookMinutes: number;
  /** Cuántas veces corrigió el fuego. */
  readonly corrections: number;
}

/**
 * La mano de quien cocina: el nivel de la habilidad (0-1) y sus rasgos innatos en desvíos. El
 * pulso sale del control, los sentidos de la percepción y el juicio del intelecto.
 */
export function handsOf(skill: number, z: Readonly<Record<string, number>>): Hands {
  const c01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
  return {
    control: c01(0.2 + 0.6 * skill + 0.08 * (z["control"] ?? 0)),
    senses: c01(0.25 + 0.55 * skill + 0.08 * (z["perception"] ?? 0)),
    judgment: c01(0.15 + 0.65 * skill + 0.08 * (z["intellect"] ?? 0)),
  };
}

/** Temperatura del lugar al encender (°C). */
export const AMBIENT = 20;
/** Cuánto del hueco entre el horno y el fuego se cierra por minuto (inercia). */
const INERTIA = 0.3;
/** Desvío del pulso con control 0, °C por minuto; baja con el control. */
const FIRE_SD = 45;
/** Desvío con que se lee la temperatura con sentidos 0, °C. */
const TEMP_READ_SD = 30;
/** Desvío con que se lee el punto con sentidos 0. */
const DONE_READ_SD = 0.3;
/** Piso de error al leer, aun con los mejores sentidos. */
const READ_FLOOR = 0.03;
/** Pasada esta fracción del tiempo de la receta sin que esté a punto, se saca igual. */
const GIVE_UP = 2.5;
/** Cuánto pesa cada defecto en la calidad. */
const UNDER_PENALTY = 1.1;
const OVER_PENALTY = 0.9;
const SCORCH_PENALTY = 0.8;
/** Lo que cuesta de rinde un quemado entero. */
const SCORCH_LOSS = 0.5;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** La cocción por minuto a una temperatura: 1/minutos de la receta a la temperatura pedida. */
function cookRate(recipe: RecipeDef, t: number): number {
  const span = recipe.heat.target - 120;
  return clamp((t - 120) / span, 0, 2.5) / recipe.heat.minutes;
}

/** El quemado por minuto: el calor de más y lo que se pasa del punto. */
function scorchRate(recipe: RecipeDef, w: WorkState): number {
  const hot = Math.max(0, w.temperature - recipe.heat.scorchAt) / 60;
  const dry = Math.max(0, w.doneness - 1.15) * 0.6;
  return (hot + dry) / 6;
}

/** Cómo lee el artesano el trabajo: con error según sus sentidos. */
export function readWork(w: WorkState, minutes: number, hands: Hands, rng: Rng): PerceivedWork {
  const blur = 1 - hands.senses;
  return {
    temperature: w.temperature + rng.normal(0, TEMP_READ_SD * blur + 2),
    doneness: Math.max(0, w.doneness + rng.normal(0, DONE_READ_SD * blur + READ_FLOOR)),
    minutes,
  };
}

/**
 * Qué hace con el fuego: lo corrige hacia el que pide la receta según lo que cree que hay, y si
 * cree que ya está, lo saca. Quien juzga bien corrige más fuerte y se anticipa a la inercia.
 */
export function decide(
  recipe: RecipeDef,
  p: PerceivedWork,
  hands: Hands,
): { readonly fire: number; readonly pull: boolean } {
  const gain = 0.2 + 0.6 * hands.judgment;
  const lead = 0.05 * hands.judgment;
  const pull = p.doneness >= 1 - lead || p.minutes >= recipe.heat.minutes * GIVE_UP;
  // El fuego no se integra (el horno ya tiene inercia): se pone alrededor del que pide la receta,
  // más o menos según lo que cree que le falta, con un tope para no pasarse de golpe.
  const push = clamp(gain * (recipe.heat.target - p.temperature), -60, 60);
  return { fire: recipe.heat.target + push, pull };
}

/** Qué calidad le adivina a lo que hizo mirándolo (crafts §11, «el resultado se descubre»). */
export function judge(quality: number, hands: Hands, rng: Rng): number {
  return clamp(quality + rng.normal(0, 0.3 * (1 - hands.senses) + READ_FLOOR), 0, 1);
}

/** La calidad de lo que quedó: a punto es 1; crudo, seco o quemado resta. */
export function qualityOf(w: WorkState): number {
  const miss = w.doneness < 1 ? UNDER_PENALTY * (1 - w.doneness) : OVER_PENALTY * (w.doneness - 1);
  return clamp(1 - miss - SCORCH_PENALTY * w.scorch, 0, 1);
}

export function runSession(input: SessionInput): SessionResult {
  const { recipe, hands } = input;
  const rng = input.rng.fork("craft", input.who, recipe.id, input.tick);
  let work: WorkState = { temperature: AMBIENT, doneness: 0, scorch: 0 };
  let fire = recipe.heat.target;
  let minutes = 0;
  let corrections = 0;
  const limit = Math.ceil(recipe.heat.minutes * GIVE_UP) + 40;

  while (minutes < limit) {
    // Lee el trabajo, decide y la mano ejecuta con su ruido.
    const seen = readWork(work, minutes, hands, rng.fork("see", minutes));
    const next = decide(recipe, seen, hands);
    // Con el horno todavía frío no hay nada que sacar: la lectura crudísima es solo ruido.
    if (next.pull && work.temperature > AMBIENT + 60) break;
    if (Math.abs(next.fire - fire) > 1) corrections += 1;
    fire = clamp(next.fire, AMBIENT, 600);

    // La ley: el horno sigue al fuego con inercia y el pulso lo corre; el calor cuece y quema.
    const wobble = rng.fork("hand", minutes).normal(0, FIRE_SD * (1 - hands.control) + 1);
    const temperature = Math.max(
      AMBIENT,
      work.temperature + INERTIA * (fire - work.temperature) + wobble,
    );
    const stepped: WorkState = {
      temperature,
      doneness: work.doneness + cookRate(recipe, temperature),
      scorch: work.scorch,
    };
    work = { ...stepped, scorch: clamp(work.scorch + scorchRate(recipe, stepped), 0, 1) };
    minutes += 1;
  }

  const quality = qualityOf(work);
  return {
    work,
    quality,
    perceivedQuality: judge(quality, hands, rng.fork("judge")),
    yield: recipe.output.ratio * (1 - SCORCH_LOSS * work.scorch),
    seconds: Math.round((recipe.prepMinutes + minutes) * 60),
    cookMinutes: minutes,
    corrections,
  };
}
