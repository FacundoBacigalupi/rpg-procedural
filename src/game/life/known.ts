// Lo que el personaje conoce y puede nombrar al escribir (actions §4): su familia por la relación
// y los lugares de la aldea por lo que son. Con `sim/knowledge` (Fase 2) sale de sus creencias; por
// ahora es lo que se sabe de nacimiento y de vivir ahí. Los nombres propios llegan con language.

import type { AgentId, EntityRef, Tick } from "../../core/index.ts";
import {
  BELIEFS,
  type Beliefs,
  BUILDING,
  beliefConfidenceAt,
  believed,
  callName,
  ENTITY,
  type KnownEntity,
  type KnownSpace,
  LOCATION,
  PERSON,
  PERSON_NAME,
  type Percept,
  PLACE,
  PLACE_NAME,
  VILLAGE_SQUARE,
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
    if (id === undefined || !id.startsWith("agent:") || id === w.player) continue;
    const identity = p.fields.identity;
    const named =
      identity !== undefined &&
      identity.confidence >= RECOGNIZED_CONFIDENCE &&
      identity.value === id;
    if (listed.has(id)) {
      // Solo una identidad reconocida vincula la figura vista con un familiar recordado.
      // El id oculto de una figura desconocida no permite actualizar dónde cree que está.
      if (named) {
        const index = out.findIndex((k) => k.ref === id);
        const previous = out[index];
        if (previous)
          out[index] = {
            ...previous,
            features: [...new Set([...previous.features, ...featuresOfPercept(p)])],
            present: true,
            ...(here === undefined ? {} : { at: here.hex }),
            phantom: false,
          };
        continue;
      }
      // Sin reconocerlo es una figura más («el viejo»): se le puede hablar con lo que se ve, con el
      // mismo ref (lo resuelve la sim) pero sin vincularla al familiar en lo que el personaje cree.
      out.push(figure(id, p, here));
      continue;
    }
    listed.add(id);
    const given = named
      ? callName(w.truth.get(PERSON_NAME, id as AgentId) ?? { language: "", parts: [] })
      : undefined;
    out.push(figure(id, p, here, given));
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

/** Alguien visto ahora: con nombre si se lo reconoce, si no solo lo que se ve. */
function figure(id: EntityRef, p: Percept, here: Where | undefined, given?: string): KnownEntity {
  return {
    ref: id,
    kind: "person",
    names: given === undefined ? [] : [given],
    features: featuresOfPercept(p),
    relations: [],
    present: true,
    ...(here === undefined ? {} : { at: here.hex }),
    via: [],
  };
}

/**
 * Suma a quienes tiene delante las palabras con que la última escena los nombró («una figura
 * desconocida», «el hombre del sombrero»): el jugador los señala con lo que leyó (actions §4). Solo
 * a los presentes: lo narrado de alguien que ya no está no lo vuelve a señalar.
 */
export function withNarratedWords(
  known: readonly KnownEntity[],
  narrated: ReadonlyMap<string, readonly string[]>,
): KnownEntity[] {
  return known.map((k) => {
    const words = k.present ? narrated.get(k.ref) : undefined;
    return words === undefined || words.length === 0
      ? k
      : { ...k, features: [...new Set([...k.features, ...words])] };
  });
}

/**
 * La plaza y las calles: de acá se va a cualquier casa y al campo. El pozo de la aldea está en la
 * plaza (`villageSpaces`), y «por ahí» sin destino es salir a dar una vuelta por la aldea.
 */
const SQUARE_NAMES = [
  "la plaza",
  "la calle",
  "las calles",
  "la aldea",
  "el pueblo",
  "el centro",
  "el pozo",
  "por ahí",
];
/** Desde adentro, «afuera» es la plaza (las puertas de las casas dan ahí). */
const OUT_NAMES = ["afuera", "fuera"];
/** El fogón está en el cuarto principal de la casa (donde se vive y se cocina). */
const HOME_NAMES = [
  "casa",
  "mi casa",
  "adentro",
  "dentro",
  "mi cuarto",
  "el cuarto",
  "mi hogar",
  "el fogón",
  "la cocina",
];
const YARD_NAMES = ["el patio", "mi patio"];
/** El cuarto de guardar de la propia casa (la casa de labranza lo tiene). */
const STORE_NAMES = ["el depósito", "la despensa", "el almacén"];
/** El granero de la aldea: comunal, todos saben dónde está (settlements). */
const GRANARY_NAMES = ["el granero", "el granero comunal"];

/**
 * Los espacios de la aldea que el personaje puede nombrar para ir (perception §3): la plaza (y
 * «afuera» si está bajo techo), su casa (y su fogón), su patio, su depósito, el granero de la aldea
 * y la casa de cada persona que conoce (por ahora, conocer a alguien es saber dónde vive: la
 * creencia sobre casas llega con settlements). Lo fijo del sitio lo sabe por vivir ahí, sin mirar.
 */
export function knownSpaces(w: LifeWorld, known: readonly KnownEntity[]): KnownSpace[] {
  const square = w.spaces.spaces.find((s) => s.key === VILLAGE_SQUARE);
  if (!square) return [];
  const village = w.truth.ids(PLACE).find((id) => {
    const p = w.truth.get(PLACE, id);
    return p?.kind === "village" && p.hexes.includes(square.hex);
  });
  if (village === undefined) return [];
  const here = w.truth.get(LOCATION, w.player);
  const node = w.spaces.spaces.find((s) => s.key === here?.space);
  const mine = w.truth.get(PERSON, w.player)?.household;
  const out: KnownSpace[] = [
    {
      key: square.key,
      place: village as EntityRef,
      names: [...SQUARE_NAMES, ...(node?.indoor === true ? OUT_NAMES : [])],
      owners: [],
    },
  ];
  const housed = new Set<string>();
  for (const s of w.spaces.spaces) {
    if (s.household === undefined) continue;
    const own = s.household === mine;
    if (s.kind === "yard") {
      if (own) out.push({ key: s.key, place: village as EntityRef, names: YARD_NAMES, owners: [] });
      continue;
    }
    if (s.key.endsWith("/store")) {
      if (own)
        out.push({ key: s.key, place: village as EntityRef, names: STORE_NAMES, owners: [] });
      continue;
    }
    // El primer cuarto de cada casa es por donde se entra y donde se vive.
    if (!s.indoor || housed.has(s.household)) continue;
    housed.add(s.household);
    const owners = known
      .filter(
        (k) =>
          k.kind === "person" &&
          !k.phantom &&
          w.truth.get(PERSON, k.ref as AgentId)?.household === s.household,
      )
      .map((k) => k.ref);
    if (!own && owners.length === 0) continue;
    out.push({ key: s.key, place: village as EntityRef, names: own ? HOME_NAMES : [], owners });
  }
  const live = new Set(w.spaces.spaces.map((s) => s.key));
  for (const id of [...w.truth.ids(BUILDING)].sort()) {
    const b = w.truth.get(BUILDING, id);
    if (b?.type !== "granary" || w.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const main = b.graph.spaces[0];
    if (main && live.has(main.key))
      out.push({ key: main.key, place: village as EntityRef, names: GRANARY_NAMES, owners: [] });
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
