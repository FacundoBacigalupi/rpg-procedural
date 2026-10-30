// Los animales de las casas a la vista (play-scene-animals, livestock-draft-rest-look): dónde anda
// cada uno en el patio de su casa, cuáles se ven desde donde está el personaje según la luz y si se le
// nota el cansancio del tiro. Lo usan la barra (`Hud.place.animals`) y lo que se puede nombrar y
// mirar («miro el buey»). Solo lee: no cambia la verdad.

import type { EntityRef } from "../../core/index.ts";
import {
  ANIMAL,
  BUILDING,
  DRAFT_FATIGUE,
  ENTITY,
  type LivestockDef,
  LOCATION,
  skyLight,
  spaceLight,
} from "../../sim/index.ts";
import { type AnimalMark, animalMarksOf } from "./animal-marks.ts";
import type { LifeWorld } from "./world.ts";

/** La luz a grandes rasgos, como la barra (`Hud.light`). */
export type LightLook = "dark" | "dim" | "bright";

/** Un animal a la vista (play-scene-animals). */
export interface SeenAnimal {
  /** La especie de `content/livestock` (hen, dog, ox…): da la silueta. */
  readonly species: string;
  /** Al este (+) u oeste (−) de donde mira (m), y a qué distancia. */
  readonly x: number;
  readonly d: number;
  /**
   * Se le nota el cansancio del tiro (livestock-draft-rest-look): la cabeza gacha, solo de cerca
   * (`TIRED_SIGHT_M`) y con luz. Sin definir: descansado, lejos o sin `DRAFT_FATIGUE`.
   */
  readonly tired?: true;
}

/** Desde qué cansancio del tiro (`DRAFT_FATIGUE.level`) se le nota al animal. */
export const TIRED_LOOK_LEVEL = 0.2;
/** Hasta dónde se le nota el cansancio a un animal (m), con luz de día. */
export const TIRED_SIGHT_M = 25;

export {
  type AnimalMark,
  animalMarksOf,
  OLD_LOOK_SHARE,
  STARVING_LOOK_LEVEL,
  THIN_LOOK_LEVEL,
} from "./animal-marks.ts";

/** Hasta dónde distingue un animal según la luz (m): son más chicos que una casa. */
export const ANIMAL_SIGHT_M: Readonly<Record<LightLook, number>> = {
  bright: 80,
  dim: 30,
  dark: 6,
};
export const MAX_SEEN_ANIMALS = 8;

/**
 * Dónde anda en el patio de su casa: unos metros alrededor de la casa, fijo por animal (no hay
 * posiciones dentro del hex todavía; es solo para pintarlo).
 */
export function yardSpot(
  id: string,
  house: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  const n = Number(id.slice(id.indexOf(":") + 1)) || 0;
  return { x: house.x + (((n * 37) % 13) - 6), y: house.y + 3 + ((n * 17) % 5) };
}

/** Los animales a la vista desde `from`, los más cercanos, puestos de oeste a este. */
export function seenAnimals(
  animals: readonly AnimalRow[],
  from: { readonly x: number; readonly y: number },
  sightM: number,
  tiredSightM = TIRED_SIGHT_M,
): SeenAnimal[] {
  return seenAnimalRows(animals, from, sightM, tiredSightM).map((r) => r.view);
}

/** Un animal con su lugar en el patio (y si está cansado), antes de ver si se lo ve. */
export interface AnimalRow {
  readonly id: string;
  readonly species: string;
  readonly at: { x: number; y: number };
  readonly tired?: boolean;
  readonly marks?: readonly AnimalMark[];
}

function seenAnimalRows(
  animals: readonly AnimalRow[],
  from: { readonly x: number; readonly y: number },
  sightM: number,
  tiredSightM: number,
): { id: string; view: SeenAnimal; marks: readonly AnimalMark[] }[] {
  return animals
    .map((a) => {
      const dx = a.at.x - from.x;
      return { a, dx, d: Math.hypot(dx, a.at.y - from.y) };
    })
    .filter((s) => s.d <= sightM)
    .sort((a, b) => a.d - b.d || (a.a.id < b.a.id ? -1 : 1))
    .slice(0, MAX_SEEN_ANIMALS)
    .sort((a, b) => a.dx - b.dx || (a.a.id < b.a.id ? -1 : 1))
    .map((s) => ({
      id: s.a.id,
      view: {
        species: s.a.species,
        x: Math.round(s.dx),
        d: Math.round(s.d),
        ...(s.a.tired === true && s.d <= tiredSightM ? { tired: true as const } : {}),
      },
      marks: s.d <= tiredSightM ? (s.a.marks ?? []) : [],
    }));
}

/** Los animales vivos de la vida con su lugar en el patio. */
export function animalRows(w: LifeWorld): AnimalRow[] {
  const out: AnimalRow[] = [];
  const defs = new Map((w.livestockLife ?? []).map((d) => [d.id, d]));
  for (const id of [...w.truth.ids(ANIMAL)].sort()) {
    const a = w.truth.get(ANIMAL, id);
    if (!a || w.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const house = w.truth.get(BUILDING, a.home);
    if (!house) continue;
    const level = w.truth.get(DRAFT_FATIGUE, id)?.level ?? 0;
    const marks = animalMarks(w, id as EntityRef, a.bornAt, defs.get(a.species));
    out.push({
      id,
      species: a.species,
      at: yardSpot(id, house.at),
      ...(level >= TIRED_LOOK_LEVEL ? { tired: true } : {}),
      ...(marks.length > 0 ? { marks } : {}),
    });
  }
  return out;
}

/**
 * Lo que se le nota por edad, hambre y cría. La edad solo con las especies de `livestockLife` (sin
 * ellas no hay vida que comparar): cría antes de madurar (`breeding.maturityYears`, o un año), viejo
 * desde `OLD_LOOK_SHARE` de su vida.
 */
function animalMarks(
  w: LifeWorld,
  id: EntityRef,
  bornAt: number,
  def: LivestockDef | undefined,
): AnimalMark[] {
  return animalMarksOf(w.truth, id, bornAt, def, w.scheduler.now, w.clock.year);
}

/** Hasta dónde se nota el cansancio según la luz: de día `TIRED_SIGHT_M`, la mitad en penumbra. */
export function tiredSightOf(light: LightLook): number {
  return light === "bright" ? TIRED_SIGHT_M : light === "dim" ? TIRED_SIGHT_M / 2 : 0;
}

/** Cómo se lo nombra por especie (provisorio hasta `language`). */
export const ANIMAL_WORDS: Readonly<Record<string, readonly string[]>> = {
  hen: ["la gallina", "gallina", "gallinas", "pollo"],
  dog: ["el perro", "perro", "perra", "can"],
  ox: ["el buey", "buey", "bueyes"],
  goat: ["la cabra", "cabra", "cabras", "chivo"],
  sheep: ["la oveja", "oveja", "ovejas", "carnero", "cordero"],
};

/** Un animal que el personaje ve ahora (para nombrarlo y mirarlo). */
export interface AnimalInSight {
  readonly ref: EntityRef;
  readonly species: string;
  /** Se le nota el cansancio (de cerca y con luz). */
  readonly tired?: true;
  /** Lo demás que se le nota de cerca (livestock-look-more). */
  readonly marks?: readonly AnimalMark[];
}

/**
 * Los animales que ve desde donde está, con la misma regla que la barra: afuera, desde la casa en
 * cuyo espacio está (o la plaza), hasta donde alcanza la luz; adentro, ninguno.
 */
export function animalsInSight(w: LifeWorld): AnimalInSight[] {
  const at = w.truth.get(LOCATION, w.player);
  if (at?.space === undefined) return [];
  const node = w.spaces.spaces.find((s) => s.key === at.space);
  if (node?.indoor === true) return [];
  const rows = animalRows(w);
  if (rows.length === 0) return [];
  const sky = skyLight(w.map, w.clock, w.seed, w.scheduler.now);
  const lux = node ? spaceLight(node, sky) : sky;
  const light: LightLook = lux < 0.15 ? "dark" : lux < 0.5 ? "dim" : "bright";
  let from = { x: 0, y: 0 };
  for (const id of [...w.truth.ids(BUILDING)].sort()) {
    const b = w.truth.get(BUILDING, id);
    if (b?.graph.spaces.some((s) => s.key === at.space)) {
      from = b.at;
      break;
    }
  }
  return seenAnimalRows(rows, from, ANIMAL_SIGHT_M[light], tiredSightOf(light)).map((r) => ({
    ref: r.id as EntityRef,
    species: r.view.species,
    ...(r.view.tired === true ? { tired: true as const } : {}),
    ...(r.marks.length > 0 ? { marks: r.marks } : {}),
  }));
}
