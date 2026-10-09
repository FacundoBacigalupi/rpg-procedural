// La historia previa de los adultos que ya vivían en la aldea (npc-psychology §2, Fase 2): la
// pre-corrida demográfica dejó quién murió y cuándo, y cada sobreviviente lo vivió a la edad que
// tenía entonces. Se vuelve a pasar por `form` con la etapa de esa edad, así un adulto que perdió
// a su madre de chico llega a la partida con la marca puesta en vez de con el esquema de base.
// Además de las muertes de la parentela marcan las uniones, los hijos propios, haber llegado de
// afuera, irse a casa propia y los años de hambre de la aldea.

import { type AgentId, type Event, type EventId, floorDiv, type Tick } from "../../core/index.ts";
import type { Person } from "../family/index.ts";
import { appraiseLoss } from "./appraise.ts";
import {
  type FormativeStimulus,
  form,
  type Mind,
  type SchemaDef,
  type StageDef,
  stageAt,
} from "./mind.ts";

/** Cercanía con quien murió, por parentesco (1 = lo más cercano). */
export const KIN_CLOSENESS = {
  parent: 1,
  child: 1,
  spouse: 0.9,
  sibling: 0.6,
} as const;
export type KinRole = keyof typeof KIN_CLOSENESS;

/** Intensidad de la penuria que deja que alguien de la parentela muera de hambre. */
export const STARVED_KIN_HARDSHIP = 0.5;

/** Intensidad de lo bueno que marca: casarse, tener un hijo, irse a casa propia. */
export const UNION_CARE = 0.25;
export const BIRTH_CARE = 0.35;
export const MOVE_OUT_SUCCESS = 0.2;
/** Dejar el lugar de uno para casarse en otro. */
export const ARRIVAL_LOSS = 0.2;
/** Un año flaco: piso de la penuria y lo que suma el hambre (0-1) de ese año. */
export const LEAN_YEAR_FLOOR = 0.15;
export const LEAN_YEAR_SPAN = 0.6;

export interface FoundersHistoryInput {
  readonly people: readonly Person[];
  /** Los eventos de la pre-corrida, en orden. */
  readonly events: readonly Event[];
  /** Ticks por año del planeta, para la edad que tenía cada uno. */
  readonly yearTicks: number;
  readonly schemas: readonly SchemaDef[];
  readonly stages: readonly StageDef[];
}

/** Quién era `dead` para `survivor`, o `null` si no eran parientes. */
export function kinRole(
  survivor: Person,
  dead: Person,
  unions: ReadonlySet<string>,
): KinRole | null {
  if (survivor.mother === dead.id || survivor.father === dead.id) return "parent";
  if (dead.mother === survivor.id || dead.father === survivor.id) return "child";
  if (unions.has(pair(survivor.id, dead.id))) return "spouse";
  const shares =
    (survivor.mother !== null && survivor.mother === dead.mother) ||
    (survivor.father !== null && survivor.father === dead.father);
  return shares ? "sibling" : null;
}

const pair = (a: AgentId, b: AgentId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Pasa por `form` cada muerte de un pariente que vivió cada sobreviviente, con la etapa de su edad
 * de entonces y el evento de la muerte como causa. Devuelve la mente nueva de quienes cambiaron.
 */
export function applyFoundersHistory(
  minds: ReadonlyMap<AgentId, Mind>,
  input: FoundersHistoryInput,
  innateOf: (id: AgentId) => Person["innate"],
): Map<AgentId, Mind> {
  const byId = new Map(input.people.map((p) => [p.id, p]));
  const unions = new Set<string>();
  for (const e of input.events) {
    if (e.kind !== "family.union") continue;
    const [wife, husband] = e.actors as AgentId[];
    if (wife && husband) unions.add(pair(wife, husband));
  }
  const out = new Map(minds);
  const alive = input.people.filter((p) => p.end === null && minds.has(p.id));
  const present = (p: Person, tick: Tick) => tick >= p.born && tick >= p.since;
  /** Quién de los vivos estaba en la aldea cuando pasó, y a quién le tocó. */
  const lived = (e: Event, ids: readonly AgentId[]) =>
    alive.filter((p) => ids.includes(p.id) && present(p, e.tick));
  const mark = (survivor: Person, e: Event, stimuli: readonly FormativeStimulus[]) => {
    if (stimuli.length === 0) return;
    out.set(survivor.id, relive(out.get(survivor.id) as Mind, stimuli, e.id, e.tick, survivor));
  };
  for (const e of input.events) {
    switch (e.kind) {
      case "person.died": {
        const dead = byId.get(e.actors[0] as AgentId);
        if (!dead) break;
        const starved = (e.data as { of?: string } | null)?.of === "hunger";
        for (const survivor of alive) {
          // Tiene que haber estado ahí: nacido y en la aldea cuando murió.
          if (survivor.id === dead.id || !present(survivor, e.tick)) continue;
          const role = kinRole(survivor, dead, unions);
          if (!role) continue;
          const stimuli: FormativeStimulus[] = appraiseLoss(KIN_CLOSENESS[role]).map(
            (a) => a.stimulus,
          );
          if (starved) stimuli.push({ theme: "hardship", intensity: STARVED_KIN_HARDSHIP });
          mark(survivor, e, stimuli);
        }
        break;
      }
      case "family.union":
        for (const p of lived(e, e.actors as AgentId[])) {
          mark(p, e, [{ theme: "care", intensity: UNION_CARE }]);
        }
        break;
      case "family.birth": {
        // Actores: el hijo, la madre y el padre. Los padres lo viven; el hijo no.
        const [, ...parents] = e.actors as AgentId[];
        for (const p of lived(e, parents)) mark(p, e, [{ theme: "care", intensity: BIRTH_CARE }]);
        break;
      }
      case "person.arrived":
        for (const p of lived(e, e.actors as AgentId[])) {
          mark(p, e, [{ theme: "loss", intensity: ARRIVAL_LOSS }]);
        }
        break;
      case "household.founded":
        // Una pareja que se arma casa propia (la fundación y los hogares sin actores no cuentan).
        if (e.tick <= 0) break;
        for (const p of lived(e, e.actors as AgentId[])) {
          mark(p, e, [{ theme: "success", intensity: MOVE_OUT_SUCCESS }]);
        }
        break;
      case "family.lean_year": {
        const hunger = (e.data as { hunger?: number } | null)?.hunger ?? 0;
        const intensity = Math.min(1, LEAN_YEAR_FLOOR + LEAN_YEAR_SPAN * hunger);
        // Los que ya estaban en la aldea pasaron ese año flaco.
        for (const p of alive) {
          if (present(p, e.tick)) mark(p, e, [{ theme: "hardship", intensity }]);
        }
        break;
      }
    }
  }
  return out;

  function relive(
    mind: Mind,
    stimuli: readonly FormativeStimulus[],
    event: EventId,
    tick: Tick,
    survivor: Person,
  ): Mind {
    const age = floorDiv(tick - survivor.born, input.yearTicks);
    const stage = stageAt(input.stages, age);
    let next = mind;
    for (const s of stimuli) {
      next = form(next, s, {
        schemas: input.schemas,
        stage,
        innate: innateOf(survivor.id),
        event,
      }).mind;
    }
    return next;
  }
}
