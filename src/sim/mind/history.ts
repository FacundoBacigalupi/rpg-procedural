// La historia previa de los adultos que ya vivían en la aldea (npc-psychology §2, Fase 2): la
// pre-corrida demográfica dejó quién murió y cuándo, y cada sobreviviente lo vivió a la edad que
// tenía entonces. Se vuelve a pasar por `form` con la etapa de esa edad, así un adulto que perdió
// a su madre de chico llega a la partida con la marca puesta en vez de con el esquema de base.

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
  for (const e of input.events) {
    if (e.kind !== "person.died") continue;
    const dead = byId.get(e.actors[0] as AgentId);
    if (!dead) continue;
    const starved = (e.data as { of?: string } | null)?.of === "hunger";
    for (const survivor of alive) {
      // Tiene que haber estado ahí: nacido y en la aldea cuando murió.
      if (survivor.id === dead.id || e.tick < survivor.born || e.tick < survivor.since) continue;
      const role = kinRole(survivor, dead, unions);
      if (!role) continue;
      const stimuli: FormativeStimulus[] = appraiseLoss(KIN_CLOSENESS[role]).map((a) => a.stimulus);
      if (starved) stimuli.push({ theme: "hardship", intensity: STARVED_KIN_HARDSHIP });
      out.set(survivor.id, relive(out.get(survivor.id) as Mind, stimuli, e.id, e.tick, survivor));
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
