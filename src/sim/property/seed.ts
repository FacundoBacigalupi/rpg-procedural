// Quién tiene qué tierra al empezar (property §3, §4, §12 Fase 1): una parcela de casa por hogar
// vivo, campos según el estatus (el terrateniente tiene tres, los libres uno, el sirviente
// ninguno: trabaja los del terrateniente) y el pastoreo y el monte de todos. Cada parcela sale de
// un evento del pasado con causa (cuando el hogar llegó, o la fundación) y deja constancia: los
// vecinos que estuvieron cuando se acordó. Después cada vecino arma su creencia de a quién
// pertenece cada una: lo que presenció o le toca, y si no, supone que es de quien la ocupa.

import type {
  AgentId,
  EventId,
  EventLog,
  HouseholdId,
  IdAllocator,
  ParcelId,
  Seed,
  Tick,
} from "../../core/index.ts";
import { Rng } from "../../core/index.ts";
import type { VillageSite } from "../../worldgen/index.ts";
import type { VillagePopulation } from "../family/index.ts";
import { BUILDING } from "../settlements/index.ts";
import { STATUS, type StatusDef } from "../social/index.ts";
import { ENTITY, type WorldTruth } from "../world/index.ts";
import {
  type Boundary,
  type Holder,
  type LandUse,
  PARCEL,
  PARCEL_BELIEFS,
  type Parcel,
  type Right,
} from "./parcel.ts";
import type { TenureDef } from "./tenure.ts";

export interface SeedParcelsInput {
  readonly seed: Seed;
  readonly pop: VillagePopulation;
  readonly site: VillageSite;
  readonly tenures: readonly TenureDef[];
  readonly standing: ReadonlyMap<HouseholdId, StatusDef>;
}

const FIELDS_BY_ROLE = { holder: 3, common: 1, dependent: 0 } as const;
const WITNESSES = 3;
const PASTURE_M2 = 30000;
const WOODLAND_M2 = 80000;

/** Siembra las parcelas y lo que cada vecino cree de ellas. Solo al empezar la vida. */
export function seedParcels(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  input: SeedParcelsInput,
): ParcelId[] {
  const { pop, site } = input;
  const settlement = pop.settlement;
  const village = { kind: "settlement", settlement } as const;
  const root = Rng.root(input.seed);
  const tenure = (id: string): TenureDef => {
    const t = input.tenures.find((x) => x.id === id);
    if (!t) throw new Error(`falta contenido: tenencia ${id}`);
    return t;
  };
  const tickOf = new Map<EventId, Tick>(pop.events.map((e) => [e.id, e.tick]));
  const living = pop.households.filter((h) => h.end === null);
  const buildings = new Map(
    truth.ids(BUILDING).flatMap((id) => {
      const b = truth.get(BUILDING, id);
      return b?.household ? [[b.household, b] as const] : [];
    }),
  );
  const created: ParcelId[] = [];

  const witnessesFor = (key: string, not: readonly HouseholdId[]): AgentId[] => {
    const r = root.fork("property", "witnesses", key).stream();
    const pool = living.filter((h) => !not.includes(h.id) && h.members.length > 0);
    const picked: AgentId[] = [];
    while (picked.length < WITNESSES && pool.length > 0) {
      const [h] = pool.splice(r.int(0, pool.length - 1), 1);
      if (h) picked.push(h.members[0] as AgentId);
    }
    return picked.sort();
  };

  const add = (
    id: ParcelId,
    at: Tick,
    cause: EventId,
    parcel: Omit<Parcel, "settlement" | "createdAt">,
  ) => {
    const event = ids.next("event");
    log.append({
      id: event,
      tick: at,
      kind: "property.parcel_set",
      actors: [],
      place: village,
      data: { parcel: id, landUse: parcel.landUse, holders: parcel.rights.map((x) => x.holder) },
      emissions: null,
      causes: [{ kind: "event", event: cause }],
      resolution: "history",
    });
    truth.set(ENTITY, id, { id, originEventId: event, createdAt: at });
    truth.set(PARCEL, id, { ...parcel, settlement, createdAt: at });
    created.push(id);
  };

  // El haz de un derecho bajo una forma de tenencia, con su constancia.
  const right = (
    holder: Holder,
    form: string,
    key: string,
    not: readonly HouseholdId[],
    at: EventId,
  ): Right => {
    const t = tenure(form);
    return {
      holder,
      incidents: t.incidents,
      tenure: t.id,
      basis: t.record === "custom" ? "custom" : "clearing",
      record: {
        kind: t.record,
        witnesses: t.record === "witnesses" ? witnessesFor(key, not) : [],
        event: at,
      },
    };
  };

  // --- Lo comunal: con los fundadores, de todos. -------------------------------------------------
  const foundersAt = tickOf.get(pop.foundersEvent);
  if (foundersAt === undefined) throw new Error("falta el evento de los fundadores");
  const commons: { use: LandUse; hex: number; area: number }[] = [];
  if (site.farmland[0] !== undefined) {
    commons.push({ use: "pasture", hex: site.farmland[0], area: PASTURE_M2 });
  }
  if (site.forest[0] !== undefined) {
    commons.push({ use: "woodland", hex: site.forest[0], area: WOODLAND_M2 });
  }
  for (const c of commons) {
    const id = ids.next("parcel");
    add(id, foundersAt, pop.foundersEvent, {
      hex: c.hex,
      at: null,
      area: c.area,
      landUse: c.use,
      boundaries: [{ with: "waste", marker: "memory" }],
      rights: [right(settlement, "commons", `${id}`, [], pop.foundersEvent)],
      possession: null,
    });
  }

  // --- Por hogar: la casa y los campos. ----------------------------------------------------------
  let fieldIndex = 0;
  let previousField: ParcelId | null = null;
  for (const h of living) {
    const def = input.standing.get(h.id);
    const r = root.fork("property", "household", h.id).stream();
    const building = buildings.get(h.id);
    const first = h.members[0];
    const patron =
      def?.role === "dependent" && first ? (truth.get(STATUS, first)?.patron ?? null) : null;

    // La casa: el hogar es dueño de su solar, salvo el sirviente, que lo usa en tierra de su patrón.
    const plotId = ids.next("parcel");
    const rights: Right[] =
      patron === null
        ? [right(h.id, "freehold", `${plotId}`, [h.id], h.origin)]
        : [
            right(patron, "freehold", `${plotId}`, [h.id, patron], h.origin),
            right(h.id, "tenancy", `${plotId}/use`, [h.id, patron], h.origin),
          ];
    add(plotId, h.since, h.origin, {
      hex: building?.hex ?? site.hex,
      at: building?.at ?? null,
      area: 350 + r.int(0, 350),
      landUse: "house_plot",
      boundaries: [{ with: "road", marker: "hedge" }],
      rights,
      possession: h.id,
    });

    // Los campos, en los hex de cultivo, uno al lado del otro.
    const count = def ? FIELDS_BY_ROLE[def.role] : 0;
    for (let i = 0; i < count && site.farmland.length > 0; i++) {
      const id = ids.next("parcel");
      const hex = site.farmland[fieldIndex % site.farmland.length] as number;
      const bound: Boundary =
        previousField && fieldIndex % site.farmland.length !== 0
          ? { with: previousField, marker: r.chance(0.5) ? "stone" : "ditch" }
          : { with: "road", marker: "memory" };
      add(id, h.since, h.origin, {
        hex,
        at: null,
        area: 4000 + r.int(0, 5000),
        landUse: "field",
        boundaries: [bound],
        rights: [right(h.id, "freehold", `${id}`, [h.id], h.origin)],
        possession: h.id,
      });
      previousField = id;
      fieldIndex++;
    }
  }

  // --- Creencias: cada vecino, sobre cada parcela. -----------------------------------------------
  const parcels = created.map((id) => [id, truth.get(PARCEL, id) as Parcel] as const);
  const homeOf = new Map<AgentId, HouseholdId>();
  for (const h of living) for (const m of h.members) homeOf.set(m, h.id);
  for (const [person, home] of homeOf) {
    const beliefs = parcels.map(([id, p]) => {
      const owner = p.rights.find((x) => x.incidents.includes("alienate"))?.holder ?? settlement;
      const mine = p.rights.some((x) => x.holder === home || x.holder === person);
      const saw = p.rights.some((x) => x.record.witnesses.includes(person));
      const common = p.rights.some((x) => x.tenure === "commons");
      if (mine || common) return { parcel: id, holder: owner, via: "own" as const };
      if (saw) return { parcel: id, holder: owner, via: "witnessed" as const };
      return { parcel: id, holder: p.possession ?? owner, via: "inferred" as const };
    });
    truth.set(PARCEL_BELIEFS, person, { beliefs });
  }
  return created;
}
