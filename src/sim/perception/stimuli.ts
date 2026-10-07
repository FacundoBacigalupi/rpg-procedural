// Qué emite cada cosa (perception §2): una persona que está ahí y el paso que alguien hizo. Las
// intensidades van en las unidades de la emisión de las acciones (`content/actions`, 0-1); las
// legibilidades dicen cuánta señal pide cada dato (la cara pide más que "hay alguien").

import type { EntityRef, EventId, Tick } from "../../core/index.ts";
import type { Sex } from "../family/index.ts";
import type { Location } from "../world/index.ts";
import type { AttrEmission, Stimulus } from "./percept.ts";

/** Lo que se ve de una persona de lejos: sexo y edad aparente. */
export interface Look {
  readonly sex: Sex;
  readonly ageYears: number;
  /** Cómo viste, si se lo ve (social-structure §3): la marca de posición más legible. */
  readonly attire?: string;
}

export type AgeBand = "child" | "youth" | "adult" | "elder";

export interface Figure {
  readonly sex: Sex;
  readonly age: AgeBand;
}

export function ageBand(ageYears: number): AgeBand {
  if (ageYears < 13) return "child";
  if (ageYears < 20) return "youth";
  if (ageYears < 50) return "adult";
  return "elder";
}

/** El cuerpo quieto: se ve entero, apenas se oye (ropa, respiración). */
export const BODY = { sight: 1, sound: 0.01 } as const;

/** Legibilidades (perception §5; calibración abierta). */
export const LEGIBILITY = {
  presence: { sight: 0.001, sound: 0.3 },
  figure: { sight: 0.03 },
  attire: { sight: 0.05 },
  identity: { sight: 0.1, sound: 8 },
  action: { sight: 0.02, sound: 0.6 },
  words: { sound: 2.5 },
} as const;

/** La ropa, si se la ve: una marca de posición que se lee con la vista y a poca distancia. */
function attireOf(look: Look): AttrEmission[] {
  if (look.attire === undefined) return [];
  return [
    {
      key: "attire",
      value: look.attire,
      requires: "presence",
      signal: { sight: { intensity: BODY.sight, legibility: LEGIBILITY.attire.sight } },
    },
  ];
}

function figureOf(look: Look): Figure {
  return { sex: look.sex, age: ageBand(look.ageYears) };
}

/** Una persona que está: que hay alguien, su figura, y quién es para el que la conoce. */
export function presenceStimulus(person: {
  readonly id: EntityRef;
  readonly at: Location;
  readonly look: Look;
  readonly tick: Tick;
}): Stimulus {
  const attributes: AttrEmission[] = [
    {
      key: "presence",
      value: true,
      signal: {
        sight: { intensity: BODY.sight, legibility: LEGIBILITY.presence.sight },
        sound: { intensity: BODY.sound, legibility: LEGIBILITY.presence.sound },
      },
    },
    {
      key: "figure",
      value: figureOf(person.look),
      requires: "presence",
      signal: { sight: { intensity: BODY.sight, legibility: LEGIBILITY.figure.sight } },
    },
    {
      key: "identity",
      value: person.id,
      personal: person.id,
      requires: "presence",
      signal: { sight: { intensity: BODY.sight, legibility: LEGIBILITY.identity.sight } },
    },
  ];
  attributes.push(...attireOf(person.look));
  return {
    source: { entity: person.id },
    tick: person.tick,
    at: person.at,
    attributes,
    exclude: [person.id],
  };
}

/** Lo que perception necesita de un paso resuelto (`ActionResolution` y su evento). */
export interface ActionSight {
  readonly event: EventId;
  readonly tick: Tick;
  readonly actor: EntityRef;
  readonly at: Location;
  readonly look: Look;
  readonly verb: string;
  /** Qué emite el paso por canal, 0-1 (`ActionResolution.emissions`). */
  readonly emissions: { readonly sight: number; readonly sound: number };
  /** Lo dicho en voz alta, si el paso fue hablar y lo llegó a decir. */
  readonly words?: string | null;
}

/**
 * El paso de alguien: notarlo depende de cuánto emite (correr se ve, hablar se oye, lo hecho a
 * escondidas casi nada); una vez notado, se lo mira (figura y cara con el cuerpo entero) y se
 * escucha la voz, que también delata a quien habla.
 */
export function actionStimulus(a: ActionSight): Stimulus {
  const speaking = a.words !== undefined && a.words !== null && a.words.length > 0;
  const voice = speaking ? a.emissions.sound : 0;
  const attributes: AttrEmission[] = [
    {
      key: "presence",
      value: true,
      signal: {
        sight: { intensity: a.emissions.sight, legibility: LEGIBILITY.presence.sight },
        sound: { intensity: a.emissions.sound, legibility: LEGIBILITY.presence.sound },
      },
    },
    {
      key: "action",
      value: a.verb,
      requires: "presence",
      signal: {
        sight: { intensity: a.emissions.sight, legibility: LEGIBILITY.action.sight },
        sound: { intensity: a.emissions.sound, legibility: LEGIBILITY.action.sound },
      },
    },
    {
      key: "figure",
      value: figureOf(a.look),
      requires: "presence",
      signal: { sight: { intensity: BODY.sight, legibility: LEGIBILITY.figure.sight } },
    },
    {
      key: "identity",
      value: a.actor,
      personal: a.actor,
      requires: "presence",
      signal: {
        sight: { intensity: BODY.sight, legibility: LEGIBILITY.identity.sight },
        sound: { intensity: voice, legibility: LEGIBILITY.identity.sound },
      },
    },
  ];
  attributes.push(...attireOf(a.look));
  if (speaking) {
    attributes.push({
      key: "words",
      value: a.words,
      signal: { sound: { intensity: voice, legibility: LEGIBILITY.words.sound } },
    });
  }
  return {
    source: { event: a.event },
    tick: a.tick,
    at: a.at,
    attributes,
    exclude: [a.actor],
  };
}
