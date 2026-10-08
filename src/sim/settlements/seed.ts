// La aldea inicial como edificios y obras (settlements §2, §5, §8; Fase 1): lo que la
// pre-corrida de población dejó (hogares, fundación) y lo que el sitio ofrece (agua, tierra,
// bosque) se vuelve una casa por hogar vivo, un granero comunal, un pozo en la plaza y caminos a
// los campos y al monte. Cada edificio sale de materiales con origen (un evento de recolección
// con causa en el ancla que los dio), con desgaste y defectos ocultos que el dueño no ve, y los
// gramos entran al ledger desde la fuente externa `seed`: lo que hay en la aldea al empezar no
// aparece de la nada, viene declarado (los lotes con origen llegan con el comercio entre asentamientos, Fase 5).
//
// Todo pasa en eventos del pasado (`history`): una casa se levanta cuando el hogar llega a la
// aldea, el granero y el pozo con los fundadores.

import {
  type BuildingId,
  cos,
  type Event,
  type EventId,
  type EventLog,
  exp,
  externalAccount,
  type HolderRef,
  holderAccount,
  type IdAllocator,
  type Ledger,
  type LedgerUnit,
  ledgerUnit,
  type PlaceRef,
  Rng,
  type Seed,
  type SettlementId,
  type SpaceKey,
  sin,
  sqrt,
  type Tick,
  type Transfer,
} from "../../core/index.ts";
import type { VillageSite } from "../../worldgen/index.ts";
import type { VillagePopulation } from "../family/index.ts";
import {
  ENTITY,
  hexPath,
  houseKey,
  type LocalMap,
  nearestHex,
  type SpaceEdge,
  type SpaceNode,
  type WorldTruth,
} from "../world/index.ts";
import type { BuildingDef, MaterialDef, WorkDef } from "./defs.ts";
import {
  BUILDING,
  type BuildingComponent,
  type BuildingGraph,
  DEFECT_KINDS,
  type MaterialLine,
  SETTLEMENT,
  type SettlementAnchorRecord,
  WORK,
} from "./tables.ts";

/** La unidad del ledger de un material (gramos). */
export function materialUnit(id: string): LedgerUnit {
  return ledgerUnit(`material:${id}`);
}

/** La fuente externa de la que sale lo que ya existe al empezar. */
export const SEED_SOURCE = "seed";

export interface SettlementContent {
  readonly materials: readonly MaterialDef[];
  readonly buildings: readonly BuildingDef[];
  readonly works: readonly WorkDef[];
}

export interface SeedSettlementInput {
  readonly seed: Seed;
  readonly pop: VillagePopulation;
  readonly site: VillageSite;
  readonly map: LocalMap;
  readonly content: SettlementContent;
}

/** Ángulo áureo: reparte las casas alrededor de la plaza sin filas. */
const GOLDEN_ANGLE = 2.399963229728653;
const FIRST_RING_M = 45;

/** Llave del espacio de un cuarto: el principal de una vivienda conserva la del hogar. */
function roomKey(building: BuildingId, household: string | undefined, room: string, main: boolean) {
  const base = household === undefined ? building : houseKey(household as never);
  return (main ? base : `${base}/${room}`) as SpaceKey;
}

/** Siembra el asentamiento, sus edificios y sus obras. Solo al empezar la vida. */
export function seedSettlement(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  ledger: Ledger,
  input: SeedSettlementInput,
): void {
  const { pop, site, map, content } = input;
  const settlement = pop.settlement;
  const village: PlaceRef = { kind: "settlement", settlement };
  const root = Rng.root(input.seed);
  const tickOf = new Map<EventId, Tick>(pop.events.map((e) => [e.id, e.tick]));
  const tick = (e: EventId): Tick => {
    const t = tickOf.get(e);
    if (t === undefined) throw new Error(`evento desconocido: ${e}`);
    return t;
  };
  const materials = new Map(content.materials.map((m) => [m.id, m]));
  const material = (id: string): MaterialDef => {
    const m = materials.get(id);
    if (!m) throw new Error(`falta contenido: material ${id}`);
    return m;
  };

  // Las anclas del sitio, tal cual, con la causa que ya traen.
  const anchors: SettlementAnchorRecord[] = [];
  for (const a of site.anchors) {
    if (a.kind === "water") {
      anchors.push({ kind: "water", hexes: [a.hex], detail: a.source, cause: a.cause });
    } else if (a.kind === "farmland") {
      anchors.push({ kind: "farmland", hexes: a.hexes, cause: a.cause });
    } else if (a.kind === "resource") {
      anchors.push({ kind: "wood", hexes: a.hexes, cause: a.cause });
    } else {
      anchors.push({ kind: "harbor", hexes: [a.hex], cause: a.cause });
    }
  }
  truth.set(SETTLEMENT, settlement, { layout: "organic", anchors, foundedBy: site.foundedEvent });

  // Qué materiales hay cerca y qué evento los causó.
  const farmCause = anchors.find((a) => a.kind === "farmland")?.cause ?? site.foundedEvent;
  const waterAnchor = anchors.find((a) => a.kind === "water");
  const sourceCause = {
    forest: site.forest.length > 0 ? site.forestEvent : undefined,
    fields: site.farmland.length > 0 ? farmCause : undefined,
    ground: site.foundedEvent,
  } as const;

  const append = (e: Omit<Event, "id" | "emissions" | "resolution" | "place" | "actors">) => {
    const id = ids.next("event");
    log.append({
      ...e,
      id,
      actors: [],
      place: village,
      emissions: null,
      resolution: "history",
    });
    return id;
  };
  const caused = (...events: readonly EventId[]) =>
    [...new Set(events)].map((event) => ({ kind: "event" as const, event }));

  const lines = (grams: Map<string, number>, origin: EventId): MaterialLine[] =>
    [...grams.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([m, g]) => ({ material: m, grams: g, origin }));
  const transfers = (to: HolderRef, grams: Map<string, number>): Transfer[] =>
    [...grams.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([m, g]) => ({
        unit: materialUnit(m),
        from: externalAccount(SEED_SOURCE),
        to: holderAccount(to),
        amount: g,
      }));

  // --- Edificios: primero lo comunal (con los fundadores), después una casa por hogar. -----------
  const living = pop.people.filter((p) => p.end === null).length;
  const dwellings = content.buildings
    .filter((b) => b.tenure === "household")
    .sort((a, b) => (a.minMembers ?? 1) - (b.minMembers ?? 1));
  const plans: {
    def: BuildingDef;
    at: Tick;
    owner: HolderRef;
    household?: (typeof pop.households)[number];
    cause: EventId;
  }[] = [];
  const foundersAt = tick(pop.foundersEvent);
  for (const def of content.buildings.filter((b) => b.tenure === "community")) {
    const n = Math.max(1, Math.ceil(living / (def.perPeople ?? 1)));
    for (let i = 0; i < n; i++) {
      plans.push({ def, at: foundersAt, owner: village, cause: pop.foundersEvent });
    }
  }
  for (const h of pop.households.filter((x) => x.end === null)) {
    const fits = dwellings.filter((d) => (d.minMembers ?? 1) <= h.members.length);
    const def = fits[fits.length - 1] ?? dwellings[0];
    if (!def) throw new Error("falta contenido: ningún edificio de vivienda");
    plans.push({ def, at: h.since, owner: h.id, household: h, cause: h.origin });
  }

  plans.forEach((plan, index) => {
    const { def, household } = plan;
    const id = ids.next("building");
    const r = root.fork("settlement", "building", id).stream();

    // Los componentes: de qué está hecho cada uno, con lo que hay cerca.
    const grams = new Map<string, number>();
    const origins: EventId[] = [];
    const picked = def.components.map((c) => {
      const near = c.materials.filter(
        (m) => sourceCause[material(m.material).source] !== undefined,
      );
      const options = near.length > 0 ? near : c.materials;
      const choice = options[r.weighted(options.map((m) => m.weight))] as (typeof options)[number];
      const mat = material(choice.material);
      origins.push(sourceCause[mat.source] ?? site.foundedEvent);
      const g = Math.round(c.area * mat.gramsPerM2);
      grams.set(mat.id, (grams.get(mat.id) ?? 0) + g);
      return { c, mat, grams: g };
    });

    const gathered = append({
      tick: plan.at,
      kind: "settlement.materials_gathered",
      data: { building: id, materials: [...grams.keys()].sort() },
      causes: caused(...origins, plan.cause),
    });
    const built = append({
      tick: plan.at,
      kind: "settlement.built",
      data: { building: id, type: def.id },
      causes: caused(gathered, plan.cause),
    });

    const components: BuildingComponent[] = picked.map(({ c, mat, grams: g }) => {
      const years = r.float() * def.repairYears;
      const defects = r.chance(0.2)
        ? [{ kind: r.pick(DEFECT_KINDS), severity: Math.round(r.float() * 40) / 100 }]
        : [];
      return {
        part: c.part,
        area: c.area,
        materials: [{ material: mat.id, grams: g, origin: gathered }],
        condition: Math.round(exp(-mat.decayPerYear * years) * 1000) / 1000,
        quality: Math.round((0.5 + 0.5 * r.float()) * 100) / 100,
        defects,
      };
    });

    // Dónde: anillos alrededor de la plaza, con un poco de desorden.
    const angle = index * GOLDEN_ANGLE + (r.float() - 0.5) * 0.4;
    const radius = FIRST_RING_M + 14 * sqrt(index) + r.float() * 10;
    const at = { x: Math.round(radius * cos(angle)), y: Math.round(radius * sin(angle)) };

    // Los espacios: el cuarto principal conserva la llave del hogar; hacia la plaza se sale por el
    // patio si hay, si no por el cuarto principal.
    const nodes: SpaceNode[] = def.rooms.map((room, i) => ({
      key: roomKey(id, household?.id, room.id, i === 0),
      kind: room.kind,
      hex: site.hex,
      area: room.area,
      indoor: room.kind !== "yard",
      daylight: room.daylight,
      lamp: room.lamp,
      noise: room.noise,
      clearSight: 1,
      ...(household ? { household: household.id } : {}),
    }));
    const [main, ...rest] = nodes as [SpaceNode, ...SpaceNode[]];
    const edges: SpaceEdge[] = rest.map((n) => ({ a: main.key, b: n.key, barrier: "doorway" }));
    const yard = rest.find((n) => n.kind === "yard");
    const graph: BuildingGraph = {
      spaces: nodes,
      edges,
      entrance: (yard ?? main).key,
      door: household ? "doorway" : "door_closed",
    };

    truth.set(ENTITY, id, { id, originEventId: built, createdAt: plan.at });
    truth.set(BUILDING, id, {
      type: def.id,
      settlement,
      hex: site.hex,
      at,
      owner: plan.owner,
      maintainer: plan.owner,
      ...(household ? { household: household.id } : {}),
      graph,
      components,
      builtBy: built,
    });
    ledger.post({
      tick: plan.at,
      eventId: built,
      transfers: transfers({ kind: "building", building: id }, grams),
    });
  });

  // --- Obras: el pozo en la plaza y los caminos que el uso abrió. --------------------------------
  const well = content.works.find((w) => w.kind === "well");
  if (well?.kind === "well") {
    const id = ids.next("work");
    const cause = waterAnchor?.cause ?? site.foundedEvent;
    const built = append({
      tick: foundersAt,
      kind: "settlement.built",
      data: { work: id, type: well.id },
      causes: caused(cause, pop.foundersEvent),
    });
    const grams = new Map([[well.material, well.grams]]);
    const r = root.fork("settlement", "work", id).stream();
    truth.set(ENTITY, id, { id, originEventId: built, createdAt: foundersAt });
    truth.set(WORK, id, {
      type: well.id,
      kind: "well",
      settlement,
      hexes: [site.hex],
      capacity: well.litersPerDay,
      source: "groundwater",
      condition: Math.round(exp(-well.decayPerYear * r.float() * well.repairYears) * 1000) / 1000,
      owner: village,
      maintainer: village,
      materials: lines(grams, built),
      builtBy: built,
    });
    ledger.post({ tick: foundersAt, eventId: built, transfers: transfers(village, grams) });
  }

  const road = content.works.find((w) => w.kind === "road");
  if (road?.kind === "road") {
    const targets: { hex: number; cause: EventId }[] = [];
    if (site.forest.length > 0) {
      targets.push({ hex: nearestHex(map, site.hex, site.forest), cause: site.forestEvent });
    }
    if (site.farmland.length > 0) {
      targets.push({ hex: nearestHex(map, site.hex, site.farmland), cause: farmCause });
    }
    const done = new Set<number>([site.hex]);
    for (const t of targets) {
      if (done.has(t.hex)) continue;
      done.add(t.hex);
      const id = ids.next("work");
      const built = append({
        tick: foundersAt,
        kind: "settlement.path_worn",
        data: { work: id, type: road.id },
        causes: caused(t.cause, pop.foundersEvent),
      });
      const r = root.fork("settlement", "work", id).stream();
      truth.set(ENTITY, id, { id, originEventId: built, createdAt: foundersAt });
      truth.set(WORK, id, {
        type: road.id,
        kind: "road",
        settlement,
        hexes: [site.hex, ...hexPath(map, site.hex, t.hex)],
        capacity: 0,
        condition: Math.round(exp(-road.decayPerYear * r.float() * road.repairYears) * 1000) / 1000,
        owner: village,
        maintainer: village,
        materials: [],
        builtBy: built,
      });
    }
  }
}

/** Qué unidades del ledger salen de la fuente `seed` por los edificios y obras. */
export function settlementUnits(materials: readonly MaterialDef[]): LedgerUnit[] {
  return materials.map((m) => materialUnit(m.id));
}

export type { SettlementId };
