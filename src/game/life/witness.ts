// Quién es el personaje para la percepción (perception §2): su gente y sus sentidos. Aparte de
// `view` y `world` para que la fase `perceive`, que `world` registra, pueda usarlo sin ciclos.

import type { AgentId, PlanetClock, Tick } from "../../core/index.ts";
import {
  ATTENTION,
  LOCATION,
  type Observer,
  PERSON,
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
  if (me.mother) out.set(me.mother, { relation: "madre" });
  if (me.father) out.set(me.father, { relation: "padre" });
  if (me.spouse) out.set(me.spouse, { relation: sexed(me.spouse, "esposa", "esposo") });
  for (const id of w.truth.ids(PERSON) as AgentId[]) {
    if (id === w.player || out.has(id)) continue;
    const p = w.truth.get(PERSON, id);
    if (!p) continue;
    if (p.household === me.household) out.set(id, { relation: sexed(id, "hermana", "hermano") });
  }
  return out;
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
