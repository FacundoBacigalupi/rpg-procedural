// Bestias que bajan del monte (novel3-beasts-materialize, combat §15): un carnívoro de los que
// asaltan (`LineageDef.raid`) sale de la población del monte de un lugar (`WILDS`) como individuo
// con cuerpo, cerca de ese lugar, con chance por día `cuenta · raid.perDay · hambre`
// (`predatorHunger`: con presas de sobra no baja). Solo bajan los linajes que tienen cuerpo en
// `content/body-plans` (el plan con el mismo id). La población baja en uno; si sigue vivo al cabo
// de `BEAST_STAY_DAYS`, vuelve al monte (la población sube en uno y la entidad termina); si muere,
// queda su cuerpo donde cayó y la población no lo recupera. Un solo individuo por lugar a la vez.

import type { EntityRef, PlaceId, Tick } from "../../core/index.ts";
import { BODY_STATE, type BodyPlanDef, newBody } from "../body/index.ts";
import {
  createEntity,
  deleteComponent,
  draftEvent,
  type EventDraft,
  endEntity,
  type ProcessDef,
  type StateChange,
  setComponent,
} from "../scheduler/index.ts";

import { ENTITY, LOCATION, PLACE, type ReadonlyWorldTruth, table } from "../world/index.ts";
import { type LineageDef, lineageOf, WILDS } from "./ecology.ts";
import { predatorHunger } from "./predation.ts";
import type { CellEcology } from "./trophic.ts";

/** Una bestia que bajó: de qué linaje, de qué monte salió y hasta cuándo se queda. */
export interface Beast {
  readonly lineage: string;
  /** El lugar con `WILDS` de donde salió (y adonde vuelve). */
  readonly home: EntityRef;
  readonly until: Tick;
}

export const BEAST = table<Beast>("living.beast");

export const BEAST_PROCESS = "living.beasts";
export const BEAST_DESCENDED_EVENT = "living.beast_descended";
export const BEAST_RETURNED_EVENT = "living.beast_returned";

/** Días que se queda cerca antes de volver al monte (calibración abierta). */
export const BEAST_STAY_DAYS = 2;

/** Pura: la chance de que baje uno hoy de una población de `count` con ese hambre. */
export function descentChance(count: number, perDay: number, hunger: number, days: number): number {
  if (count < 1) return 0;
  return Math.min(1, Math.max(0, count * perDay * hunger * days));
}

export interface BeastOptions {
  readonly lineages: readonly LineageDef[];
  readonly bodyPlans: readonly BodyPlanDef[];
  /** Ticks por día. */
  readonly day: number;
}

/** Si la bestia sigue viva y en el mundo. */
function roaming(truth: ReadonlyWorldTruth, id: EntityRef): boolean {
  return (
    truth.get(ENTITY, id)?.endedAt === undefined &&
    (truth.get(BODY_STATE, id)?.death ?? null) === null
  );
}

export function beastProcess(o: BeastOptions): ProcessDef {
  const lineages = Object.fromEntries(o.lineages.map((d) => [d.id, lineageOf(d)]));
  const plans = new Map(o.bodyPlans.map((p) => [p.id, p]));
  const raiders = o.lineages
    .filter((d) => d.raid !== undefined && plans.has(d.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    id: BEAST_PROCESS,
    system: "living",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [WILDS.name, PLACE.name, BEAST.name, ENTITY.name, BODY_STATE.name],
    writes: [WILDS.name, BEAST.name, ENTITY.name, LOCATION.name, BODY_STATE.name],
    scopeGuard: (truth) => raiders.length > 0 && truth.ids(WILDS).length > 0,
    run(ctx) {
      const truth = ctx.truth;
      const days = (ctx.window > 0 ? ctx.window : 1) / o.day;
      const events: EventDraft[] = [];
      const changes: StateChange[] = [];
      const counts = new Map<EntityRef, CellEcology>();
      const wildsOf = (home: EntityRef) => counts.get(home) ?? truth.get(WILDS, home);
      const busy = new Set<EntityRef>();
      // Los que están abajo: se quedan, vuelven o quedan muertos donde cayeron.
      for (const id of [...truth.ids(BEAST)].sort() as EntityRef[]) {
        const b = truth.get(BEAST, id);
        const base = truth.get(ENTITY, id);
        if (!b || !base || !roaming(truth, id)) continue;
        if (ctx.now < b.until) {
          busy.add(b.home);
          continue;
        }
        const wilds = wildsOf(b.home);
        if (!wilds) continue;
        const end = draftEvent(events.length);
        events.push({
          kind: BEAST_RETURNED_EVENT,
          actors: [],
          place: { kind: "place", place: b.home as unknown as PlaceId },
          data: { beast: id, lineage: b.lineage },
          causes: [{ kind: "state", entity: id, key: BEAST.name }],
          emissions: null,
        });
        counts.set(b.home, bump(wilds, b.lineage, 1));
        changes.push(endEntity(base, end, ctx.now), deleteComponent(LOCATION, id));
      }
      for (const home of [...truth.ids(WILDS)].sort() as EntityRef[]) {
        if (busy.has(home)) continue;
        const hex = truth.get(PLACE, home)?.hexes[0];
        const wilds = wildsOf(home);
        if (hex === undefined || !wilds) continue;
        const rng = ctx.rng.fork("beast", home);
        for (const d of raiders) {
          const l = lineages[d.id];
          const plan = plans.get(d.id);
          const count = wilds.populations.find((p) => p.lineage === d.id)?.count ?? 0;
          if (!l || !plan || !d.raid) continue;
          const hunger = predatorHunger(l, wilds, lineages);
          const chance = descentChance(count, d.raid.perDay, hunger, days);
          if (!rng.fork(d.id).chance(chance)) continue;
          const born = draftEvent(events.length);
          const id = ctx.newId("animal");
          events.push({
            kind: BEAST_DESCENDED_EVENT,
            actors: [],
            place: { kind: "place", place: home as unknown as PlaceId },
            data: { beast: id, lineage: d.id, hunger, left: count - 1 },
            causes: [{ kind: "state", entity: home, key: WILDS.name }],
            emissions: null,
          });
          counts.set(home, bump(wilds, d.id, -1));
          changes.push(
            createEntity(id, born, ctx.now),
            setComponent(BEAST, id, {
              lineage: d.id,
              home,
              until: ctx.now + BEAST_STAY_DAYS * o.day,
            }),
            setComponent(BODY_STATE, id, newBody(plan, d.bodyMass, ctx.now)),
            setComponent(LOCATION, id, { hex }),
          );
          break;
        }
      }
      for (const [home, cell] of counts) changes.push(setComponent(WILDS, home, cell));
      return events.length === 0 ? {} : { events, changes };
    },
  };
}

function bump(cell: CellEcology, lineage: string, by: number): CellEcology {
  return {
    ...cell,
    populations: cell.populations.map((p) =>
      p.lineage === lineage ? { ...p, count: Math.max(0, p.count + by) } : p,
    ),
  };
}
