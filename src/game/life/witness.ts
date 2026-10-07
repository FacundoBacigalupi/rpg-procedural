// Quién es el personaje para la percepción (perception §2): su gente y sus sentidos. Aparte de
// `view` y `world` para que la fase `perceive`, que `world` registra, pueda usarlo sin ciclos.

import type { AgentId, PlanetClock, Tick } from "../../core/index.ts";
import {
  ATTENTION,
  callName,
  familyName,
  LOCATION,
  type Observer,
  PERSON,
  PERSON_NAME,
  PLACE_NAME,
  type ReadonlyWorldTruth,
  sensorAcuity,
} from "../../sim/index.ts";
import type { Acquaintance } from "../view/index.ts";

/** Lo mínimo del mundo para saber quién es el personaje y qué ve. */
export interface Witness {
  readonly truth: ReadonlyWorldTruth;
  readonly player: AgentId;
  readonly clock: PlanetClock;
}

export function acquaintances(w: Pick<Witness, "truth" | "player">): Map<AgentId, Acquaintance> {
  const me = w.truth.get(PERSON, w.player);
  const out = new Map<AgentId, Acquaintance>();
  if (!me) return out;
  const sexed = (id: AgentId | null, female: string, male: string) => {
    const p = id ? w.truth.get(PERSON, id) : undefined;
    return p?.sex === "female" ? female : male;
  };
  const known = (id: AgentId, relation: string): Acquaintance => {
    const given = callName(w.truth.get(PERSON_NAME, id) ?? { language: "", parts: [] });
    return given === undefined ? { relation } : { name: given, relation };
  };
  if (me.mother) out.set(me.mother, known(me.mother, "madre"));
  if (me.father) out.set(me.father, known(me.father, "padre"));
  if (me.spouse) out.set(me.spouse, known(me.spouse, sexed(me.spouse, "esposa", "esposo")));
  for (const id of w.truth.ids(PERSON) as AgentId[]) {
    if (id === w.player || out.has(id)) continue;
    const p = w.truth.get(PERSON, id);
    if (!p) continue;
    if (p.household === me.household) out.set(id, known(id, sexed(id, "hermana", "hermano")));
  }
  return out;
}

/**
 * Las palabras de su lengua que el personaje conoce y puede citar: su apellido y el de su gente, y
 * el nombre de los lugares de la aldea (language §13). Los nombres de pila de sus conocidos ya
 * entran por `acquaintances`.
 */
export function knownWords(w: Pick<Witness, "truth" | "player">): string[] {
  const words = new Set<string>();
  for (const [id] of acquaintances(w)) {
    const f = familyName(w.truth.get(PERSON_NAME, id) ?? { language: "", parts: [] });
    if (f !== undefined) words.add(f);
  }
  const mine = familyName(w.truth.get(PERSON_NAME, w.player) ?? { language: "", parts: [] });
  if (mine !== undefined) words.add(mine);
  for (const id of w.truth.ids(PLACE_NAME)) {
    const n = w.truth.get(PLACE_NAME, id);
    if (n) words.add(n.form);
  }
  return [...words];
}

/** El personaje como observador (perception §2): su lugar, sus sentidos por edad, su gente. */
export function playerObserver(
  w: Witness,
  attention: number = ATTENTION.relaxed,
  now: Tick,
): Observer {
  const me = w.truth.get(PERSON, w.player);
  const at = w.truth.get(LOCATION, w.player);
  if (!me || !at) throw new Error("el personaje no tiene persona o lugar");
  const age = (now - me.born) / w.clock.year;
  return {
    id: w.player,
    at,
    acuity: sensorAcuity(age),
    attention,
    familiar: new Map([...acquaintances(w).keys()].map((id) => [id, 0.9])),
  };
}
