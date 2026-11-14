// Técnicas de ataque (combat §9, cultivation §8; novel3-technique-core): un golpe a distancia que
// sale del qi del recipiente. Se lanza entero o no se lanza (el que no tiene el qi no puede
// empezarla); lo gastado sale del cuerpo pase lo que pase y quien llama lo devuelve a la celda
// (conservación). Llega o no según el control, la distancia y lo rápido que es el blanco; la fuerza
// se apaga con la distancia. Mal hecha (control bajo contra la dificultad) el qi se vuelve contra
// los meridianos de quien la lanza. Puro y determinista: todo el azar sale del `rng` que se pasa.
import type { EventId, Rng, Tick } from "../../core/index.ts";
import type { Blow, WoundKind } from "../body/index.ts";

/** Una técnica de ataque: de qué forma sale, qué cuesta y qué hace (los números son de la ley). */
export interface AttackArt {
  readonly id: string;
  /** Hoy solo proyectil: sale de la mano y viaja hasta el blanco. */
  readonly shape: "projectile";
  /** Qi del recipiente que gasta, entero. */
  readonly cost: number;
  /** Metros hasta donde llega con fuerza. */
  readonly range: number;
  /** 0-1: la fuerza con que pega a quemarropa y bien hecha. */
  readonly power: number;
  /** 0-1: cuánto control pide; con menos, se tuerce y puede volverse contra los meridianos. */
  readonly difficulty: number;
  readonly wound: WoundKind;
}

export interface CastInput {
  readonly art: AttackArt;
  /** Qi en el recipiente de quien la lanza. */
  readonly qi: number;
  /** 0-1: el control de quien la lanza (habilidad del golpe, meridianos, comprensión). */
  readonly control: number;
  /** Metros hasta el blanco. */
  readonly distance: number;
  /** 0-1: cuánto se le escapa el blanco por rápido o atento (0: quieto o dormido). */
  readonly evade: number;
  readonly rng: Rng;
  readonly cause: EventId;
  readonly at: Tick;
}

export type CastOutcome = "no_qi" | "faded" | "missed" | "hit";

export interface Cast {
  readonly outcome: CastOutcome;
  /** Qi que salió del recipiente: a la celda (0 si no alcanzaba). */
  readonly spent: number;
  /** El golpe para `injure`, si llegó. */
  readonly blow?: Blow;
  /** 0-1: daño nuevo a los meridianos por un contragolpe (0 si salió limpia). */
  readonly backlash: number;
}

/** Cuánto más allá del alcance todavía llega algo (a un cuarto de fuerza en el borde). */
export const ART_FADE_RATIO = 1.5;
/** La chance de contragolpe por unidad de falta de control (sin calibrar). */
export const ART_BACKLASH_RATE = 0.6;
/** El daño máximo a los meridianos de un contragolpe. */
export const ART_BACKLASH_MAX = 0.15;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/** Lanza una técnica de ataque: lo gastado, si llegó, el golpe y el contragolpe. */
export function castArt(i: CastInput): Cast {
  const { art } = i;
  if (i.qi < art.cost) return { outcome: "no_qi", spent: 0, backlash: 0 };
  const rng = i.rng.fork("art", art.id);
  const control = clamp01(i.control);
  // La falta de control contra lo que pide: con eso se tuerce y se vuelve.
  const lack = clamp01(art.difficulty - control);
  const backlash =
    lack > 0 && rng.fork("backlash").chance(clamp01(lack * ART_BACKLASH_RATE))
      ? round4(ART_BACKLASH_MAX * (0.4 + 0.6 * rng.fork("backlash-size").float()) * lack)
      : 0;
  const spent = art.cost;
  const reach = i.distance / Math.max(0.1, art.range);
  if (reach > ART_FADE_RATIO) return { outcome: "faded", spent, backlash };
  // Llegar: el control apunta, la distancia abre, el blanco se corre.
  const aim = clamp01((0.35 + 0.65 * control) * (1 - 0.3 * Math.min(1, reach)) - 0.7 * i.evade);
  if (!rng.fork("aim").chance(aim)) return { outcome: "missed", spent, backlash };
  // La fuerza: plena hasta la mitad del alcance, cae lineal hasta un cuarto en el borde del apagado;
  // un contragolpe se lleva parte.
  const fall = reach <= 0.5 ? 1 : 1 - 0.75 * ((reach - 0.5) / (ART_FADE_RATIO - 0.5));
  const force = round4(
    clamp01(art.power * (0.6 + 0.4 * control) * fall * (backlash > 0 ? 0.5 : 1)),
  );
  return {
    outcome: "hit",
    spent,
    backlash,
    blow: { kind: art.wound, force, dirt: 0, cause: i.cause, at: i.at },
  };
}
