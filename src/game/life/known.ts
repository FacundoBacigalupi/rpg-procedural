// Lo que el personaje conoce y puede nombrar al escribir (actions §4): su familia por la relación
// y los lugares de la aldea por lo que son. Con `sim/knowledge` (Fase 2) sale de sus creencias; por
// ahora es lo que se sabe de nacimiento y de vivir ahí. Los nombres propios llegan con language.

import type { AgentId, EntityRef, Tick } from "../../core/index.ts";
import {
  BELIEFS,
  type Beliefs,
  beliefConfidenceAt,
  believed,
  callName,
  ENTITY,
  type KnownEntity,
  LOCATION,
  PERSON,
  PERSON_NAME,
  type Percept,
  PLACE,
  PLACE_NAME,
} from "../../sim/index.ts";
import { RECOGNIZED_CONFIDENCE } from "./view.ts";
import { type LifeWorld, living } from "./world.ts";

/** Cómo se dice cada lugar en castellano (provisorio hasta `language`). */
const PLACE_NAMES: Readonly<Record<string, readonly string[]>> = {
  village: ["la aldea", "el pueblo", "la plaza"],
  fields: ["los campos", "el campo", "las chacras"],
  forest: ["el bosque", "el monte"],
  river: ["el río"],
  stream: ["el arroyo"],
  lake: ["el lago"],
  sea: ["el mar"],
  groundwater: ["el pozo"],
};

/** Cómo se dice una figura vista, en castellano y con sinónimos: «niño», «nene», «chico». */
const FIGURE_WORDS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  female: {
    child: ["niña", "nena", "chica", "criatura"],
    youth: ["muchacha", "joven", "chica"],
    adult: ["mujer", "señora"],
    elder: ["vieja", "anciana", "abuela"],
  },
  male: {
    child: ["niño", "nene", "chico", "criatura"],
    youth: ["muchacho", "joven", "chico"],
    adult: ["hombre", "señor"],
    elder: ["viejo", "anciano", "abuelo"],
  },
};

/** Lo que se ve de alguien que no se reconoce: su figura y su ropa, nunca quién es. */
export function featuresOfPercept(p: Percept): string[] {
  const fig = p.fields.figure?.value as { sex?: string; age?: string } | undefined;
  const attire = p.fields.attire?.value;
  const words = fig?.sex && fig.age ? (FIGURE_WORDS[fig.sex]?.[fig.age] ?? []) : [];
  return [
    "persona",
    ...words,
    ...(attire === "fine" ? ["ropa fina"] : attire === "worn" ? ["ropa gastada"] : []),
  ];
}

/**
 * Lo que el personaje conoce y puede nombrar. Con `seen` (los percepts de personas de la escena
 * actual, `PlayerViewOptions.onSeen`) suma a quienes ve ahora aunque no sean de su familia: sin
 * nombre si no los reconoce, con lo que se ve (figura, ropa) y presentes.
 */
export function knownEntities(w: LifeWorld, seen: readonly Percept[] = []): KnownEntity[] {
  const me = w.truth.get(PERSON, w.player);
  const here = w.truth.get(LOCATION, w.player);
  const out: KnownEntity[] = [];
  if (me) {
    const family: [AgentId | null, string, string][] = [
      [me.mother, "madre", "madre"],
      [me.father, "padre", "padre"],
    ];
    const alive = new Set(living(w.truth));
    const mine = w.truth.get(BELIEFS, w.player);
    for (const [id, name, rel] of family) {
      if (!id) continue;
      if (!alive.has(id)) {
        // Murió y no se enteró: para él sigue vivo (y donde lo vio) hasta que algo se lo corrija.
        if (believesAlive(mine, id, w.scheduler.now)) {
          out.push(person(w, id, [name], rel, here, false));
        }
        continue;
      }
      out.push(person(w, id, [name], rel, here));
    }
    // Convivientes (hermanos): los vivos y los muertos que el personaje cree vivos (phantom).
    for (const id of w.truth.ids(ENTITY)) {
      if (!id.startsWith("agent:")) continue;
      const agent = id as AgentId;
      const p = w.truth.get(PERSON, agent);
      if (!p || agent === w.player || agent === me.mother || agent === me.father) continue;
      if (p.household !== me.household) continue;
      const rel = p.sex === "female" ? "hermana" : "hermano";
      if (alive.has(agent)) out.push(person(w, agent, [rel], rel, here));
      else if (believesAlive(mine, agent, w.scheduler.now)) {
        out.push(person(w, agent, [rel], rel, here, false));
      }
    }
  }
  // Quienes ve ahora y no son de su familia: los desconocidos no tienen nombre, solo lo que se ve.
  const listed = new Set<EntityRef>(out.map((k) => k.ref));
  for (const p of seen) {
    const id = p.sourceEntityId;
    if (id === undefined || !id.startsWith("agent:") || id === w.player || listed.has(id)) continue;
    listed.add(id);
    const identity = p.fields.identity;
    const named =
      identity !== undefined &&
      identity.confidence >= RECOGNIZED_CONFIDENCE &&
      identity.value === id;
    const given = named
      ? callName(w.truth.get(PERSON_NAME, id as AgentId) ?? { language: "", parts: [] })
      : undefined;
    out.push({
      ref: id,
      kind: "person",
      names: given === undefined ? [] : [given],
      features: featuresOfPercept(p),
      relations: [],
      present: true,
      ...(here === undefined ? {} : { at: here.hex }),
      via: [],
    });
  }
  for (const id of w.truth.ids(PLACE)) {
    const p = w.truth.get(PLACE, id);
    if (!p) continue;
    const proper = w.truth.get(PLACE_NAME, id)?.form;
    const names = [
      ...(PLACE_NAMES[p.detail ?? p.kind] ?? PLACE_NAMES[p.kind] ?? []),
      ...(proper === undefined ? [] : [proper]),
    ];
    if (names.length === 0) continue;
    out.push({
      ref: id as EntityRef,
      kind: "place",
      names,
      features: [],
      relations: [],
      present: here !== undefined && p.hexes.includes(here.hex),
      hexes: p.hexes,
      via: [],
    });
  }
  return out;
}

/** Pura: el personaje cree vivo a `id` con confianza (envejecida) que todavía pesa. */
export function believesAlive(beliefs: Beliefs | undefined, id: AgentId, now: Tick): boolean {
  const b = believed(beliefs, id, "alive");
  return b?.value === true && beliefConfidenceAt(b, now) >= RECOGNIZED_CONFIDENCE;
}

type Where = { hex: number; space?: string | undefined };

/** Dónde cree el personaje que está alguien, y si lo cree acá y todavía con peso (player-loop §9). */
export interface Whereabouts {
  readonly at: number | undefined;
  readonly present: boolean;
  /** La creencia ya no sostiene a la persona acá: sirve para distinguir lo visto de lo recordado. */
  readonly believed: boolean;
}

/**
 * Pura: lo que dicen las creencias sobre dónde está `id`. Si cree que está acá con confianza
 * (envejecida) >= `RECOGNIZED_CONFIDENCE`, está presente; si la creencia es vieja, `at` queda como
 * el último lugar donde lo vio pero ya no está presente. Sin creencia alguna, `believed` es false y
 * quien llama decide (hoy: los convivientes se dan por conocidos donde la verdad los pone hasta que
 * `knowing` los haya visto una vez).
 */
export function whereaboutsFromBeliefs(
  beliefs: Beliefs | undefined,
  id: AgentId,
  here: Where | undefined,
  now: Tick,
): Whereabouts {
  const b = believed(beliefs, id, "at");
  if (b === undefined || typeof b.value === "boolean" || typeof b.value === "string") {
    return { at: undefined, present: false, believed: false };
  }
  const loc = b.value;
  const fresh = beliefConfidenceAt(b, now) >= RECOGNIZED_CONFIDENCE;
  return {
    at: loc.hex,
    present: fresh && !!here && loc.hex === here.hex && loc.space === here.space,
    believed: true,
  };
}

function person(
  w: LifeWorld,
  id: AgentId,
  names: string[],
  rel: string,
  here: Where | undefined,
  alive = true,
): KnownEntity {
  const truthAt = w.truth.get(LOCATION, id);
  const truthHere =
    alive && !!here && !!truthAt && truthAt.hex === here.hex && truthAt.space === here.space;
  const seen = whereaboutsFromBeliefs(w.truth.get(BELIEFS, w.player), id, here, w.scheduler.now);
  const given = callName(w.truth.get(PERSON_NAME, id) ?? { language: "", parts: [] });
  // Sin creencia, el conviviente se da por conocido donde está; con creencia manda lo que cree y
  // `phantom` marca la que la verdad desmiente (se fue, murió sin que lo supiera).
  const present = seen.believed ? seen.present : truthHere;
  return {
    ref: id,
    kind: "person",
    names: given === undefined ? names : [...names, given],
    features: [],
    relations: [{ rel, of: "self" }],
    present,
    at: seen.believed ? seen.at : truthAt?.hex,
    via: [],
    ...(seen.believed && seen.present && !truthHere ? { phantom: true } : {}),
    ...(!alive ? { phantom: true } : {}),
  };
}
