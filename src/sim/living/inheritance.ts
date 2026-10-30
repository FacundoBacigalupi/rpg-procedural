// La herencia del ganado (livestock-tenure-heir): cuando muere el último vivo de un hogar, sus
// animales no quedan sin dueño. Cada día, el hogar que tiene animales vivos y nadie vivo pasa los
// animales al pariente vivo más cercano del último que murió (el cónyuge, los hijos del mayor al
// menor, los padres, los hermanos), si ese pariente es de un hogar con casa en pie: cambian de
// dueño y de patio en un evento `living.livestock_inherited` causado por esa muerte. Sin pariente
// así, los animales quedan como estaban. La herencia por la norma de cada cultura (el primogénito,
// la hija menor, el linaje), la partición, el testamento y la disputa quedan para property.

import type { AgentId, AnimalId, BuildingId, HouseholdId } from "../../core/index.ts";
import { PERSON, type PersonRecord } from "../family/index.ts";
import {
  type EventDraft,
  type ProcessDef,
  type StateChange,
  setComponent,
} from "../scheduler/index.ts";
import { BUILDING } from "../settlements/index.ts";
import { ENTITY, type ReadonlyWorldTruth } from "../world/index.ts";
import { ANIMAL } from "./livestock.ts";

export const LIVESTOCK_INHERIT_PROCESS = "living.livestock_inherit";

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Pura: el pariente vivo más cercano de `dead` que es de otro hogar con casa en pie (`homes`): el
 * cónyuge, después los hijos (del mayor al menor), los padres y los hermanos (comparten madre o
 * padre). Sin ninguno, undefined.
 */
export function heirOf(
  truth: ReadonlyWorldTruth,
  dead: AgentId,
  homes: ReadonlyMap<HouseholdId, BuildingId>,
): AgentId | undefined {
  const me = truth.get(PERSON, dead);
  if (!me) return undefined;
  const people = ([...truth.ids(PERSON)] as AgentId[])
    .sort(byId)
    .map((id) => [id, truth.get(PERSON, id)] as const)
    .filter((p): p is readonly [AgentId, PersonRecord] => p[1] !== undefined);
  const ok = (id: AgentId, p: PersonRecord): boolean =>
    id !== dead &&
    p.household !== me.household &&
    homes.has(p.household) &&
    truth.get(ENTITY, id)?.endedAt === undefined;
  const spouse = people.filter(([id, p]) => id === me.spouse || p.spouse === dead);
  const children = people
    .filter(([, p]) => p.mother === dead || p.father === dead)
    .sort((a, b) => a[1].born - b[1].born || byId(a[0], b[0]));
  const parents = people.filter(([id]) => id === me.mother || id === me.father);
  const siblings = people.filter(
    ([, p]) =>
      (me.mother !== null && p.mother === me.mother) ||
      (me.father !== null && p.father === me.father),
  );
  for (const [id, p] of [...spouse, ...children, ...parents, ...siblings]) {
    if (ok(id, p)) return id;
  }
  return undefined;
}

/**
 * Cada día: los animales vivos del hogar sin nadie vivo pasan al hogar del heredero del último que
 * murió (`heirOf`) y a su primera casa en pie (por id).
 */
export function livestockInheritProcess(): ProcessDef {
  return {
    id: LIVESTOCK_INHERIT_PROCESS,
    system: "living",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [ANIMAL.name, ENTITY.name, PERSON.name, BUILDING.name],
    writes: [ANIMAL.name],
    scopeGuard: (truth) => truth.ids(ANIMAL).length > 0,
    run(ctx) {
      const truth = ctx.truth;
      const herds = new Map<HouseholdId, AnimalId[]>();
      for (const id of [...truth.ids(ANIMAL)].sort(byId) as AnimalId[]) {
        const a = truth.get(ANIMAL, id);
        if (!a || truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        herds.set(a.owner, [...(herds.get(a.owner) ?? []), id]);
      }
      if (herds.size === 0) return {};
      const living = new Set<HouseholdId>();
      const last = new Map<HouseholdId, { id: AgentId; at: number }>();
      for (const id of [...truth.ids(PERSON)].sort(byId) as AgentId[]) {
        const h = truth.get(PERSON, id)?.household;
        if (h === undefined) continue;
        const at = truth.get(ENTITY, id)?.endedAt;
        if (at === undefined) {
          living.add(h);
          continue;
        }
        const was = last.get(h);
        if (was === undefined || at > was.at) last.set(h, { id, at });
      }
      const homes = new Map<HouseholdId, BuildingId>();
      for (const b of [...truth.ids(BUILDING)].sort(byId) as BuildingId[]) {
        const h = truth.get(BUILDING, b)?.household;
        if (h === undefined || homes.has(h) || truth.get(ENTITY, b)?.endedAt !== undefined)
          continue;
        homes.set(h, b);
      }
      const events: EventDraft[] = [];
      const changes: StateChange[] = [];
      for (const [h, animals] of [...herds].sort((a, b) => byId(a[0], b[0]))) {
        const dead = last.get(h);
        if (living.has(h) || dead === undefined) continue;
        const end = truth.get(ENTITY, dead.id)?.endEventId;
        const heir = heirOf(truth, dead.id, homes);
        const to = heir === undefined ? undefined : truth.get(PERSON, heir)?.household;
        const home = to === undefined ? undefined : homes.get(to);
        if (heir === undefined || to === undefined || home === undefined || end === undefined) {
          continue;
        }
        events.push({
          kind: "living.livestock_inherited",
          actors: [heir],
          place: { kind: "building", building: home },
          data: { from: h, to, dead: dead.id, animals },
          causes: [
            { kind: "event", event: end },
            { kind: "state", entity: dead.id, key: "kin" },
          ],
          emissions: null,
        });
        for (const id of animals) {
          const a = truth.get(ANIMAL, id);
          if (a) changes.push(setComponent(ANIMAL, id, { ...a, owner: to, home }));
        }
      }
      return events.length > 0 ? { events, changes } : {};
    },
  };
}
