// Lo que el personaje conoce y puede nombrar al escribir (actions §4): su familia por la relación
// y los lugares de la aldea por lo que son. Con `sim/knowledge` (Fase 2) sale de sus creencias; por
// ahora es lo que se sabe de nacimiento y de vivir ahí. Los nombres propios llegan con language.

import type { AgentId, EntityRef } from "../../core/index.ts";
import {
  callName,
  type KnownEntity,
  LOCATION,
  PERSON,
  PERSON_NAME,
  PLACE,
  PLACE_NAME,
} from "../../sim/index.ts";
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

export function knownEntities(w: LifeWorld): KnownEntity[] {
  const me = w.truth.get(PERSON, w.player);
  const here = w.truth.get(LOCATION, w.player);
  const out: KnownEntity[] = [];
  if (me) {
    const family: [AgentId | null, string, string][] = [
      [me.mother, "madre", "madre"],
      [me.father, "padre", "padre"],
    ];
    for (const [id, name, rel] of family) {
      if (!id || !living(w.truth).includes(id)) continue;
      out.push(person(w, id, [name], rel, here));
    }
    for (const id of living(w.truth)) {
      const p = w.truth.get(PERSON, id);
      if (!p || id === w.player || id === me.mother || id === me.father) continue;
      if (p.household !== me.household) continue;
      const rel = p.sex === "female" ? "hermana" : "hermano";
      out.push(person(w, id, [rel], rel, here));
    }
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

function person(
  w: LifeWorld,
  id: AgentId,
  names: string[],
  rel: string,
  here: { hex: number; space?: string | undefined } | undefined,
): KnownEntity {
  const at = w.truth.get(LOCATION, id);
  const given = callName(w.truth.get(PERSON_NAME, id) ?? { language: "", parts: [] });
  return {
    ref: id,
    kind: "person",
    names: given === undefined ? names : [...names, given],
    features: [],
    relations: [{ rel, of: "self" }],
    present: !!here && !!at && at.hex === here.hex && at.space === here.space,
    // Provisorio: lo que cree es la verdad hasta que llegue `sim/knowledge` (Fase 2).
    at: at?.hex,
    via: [],
  };
}
