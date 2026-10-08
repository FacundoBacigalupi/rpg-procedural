// La gente de la aldea inicial (family-lineage, Fase 1; player-loop §1): la aldea se funda unas
// décadas antes del presente con unos hogares fundadores, y una pre-corrida año por año en modo
// agregado (simulation §5) decide muertes, uniones y nacimientos hasta hoy. Así todo el que vive
// en la aldea nació de alguien que vivió ahí, o llegó con su propio evento, y el jugador es uno de
// esos nacimientos (decisión 2026-10-07).
//
// Lo que no está todavía: atracción, normas culturales del matrimonio, herencia de bienes,
// migraciones por hambre o por guerra (Fase 3 y Fase 7). La tierra pesa como presión simple: con
// la aldea llena, la fecundidad baja.

import {
  type AgentId,
  type CauseRef,
  daysInYear,
  EARTHLIKE_CLOCK,
  type EntityRef,
  type Event,
  type EventId,
  exp,
  firstDayOfYear,
  floorDiv,
  type HouseholdId,
  makeId,
  type PlaceRef,
  type PlanetClock,
  type Random,
  Rng,
  type Seed,
  type SettlementId,
  type Tick,
} from "../../core/index.ts";
import type { VillageSite } from "../../worldgen/index.ts";
import { band, type Demography } from "./demography.ts";
import {
  expressInnate,
  founderGenome,
  type Genome,
  type Innate,
  inheritGenome,
  type Sex,
  type Trait,
} from "./genome.ts";

export interface PersonEnd {
  readonly tick: Tick;
  readonly event: EventId;
  /** Murió, o se fue de la aldea (casarse afuera). */
  readonly how: "died" | "left";
}

export interface Person {
  readonly id: AgentId;
  readonly sex: Sex;
  /** Puede ser antes de la fundación (fundadores y los que llegan de afuera). */
  readonly born: Tick;
  /** El evento que lo trajo a la aldea: su nacimiento, la fundación o su llegada. */
  readonly origin: EventId;
  /** Cuándo empezó a estar en la aldea (el tick de `origin`). */
  readonly since: Tick;
  readonly mother: AgentId | null;
  readonly father: AgentId | null;
  readonly genome: Genome;
  readonly innate: Innate;
  /** El hogar actual, o el último si ya no está. */
  readonly household: HouseholdId;
  /** El cónyuge vivo en la aldea, si hay. */
  readonly spouse: AgentId | null;
  /** La unión vigente o la última. */
  readonly union: EventId | null;
  readonly end: PersonEnd | null;
}

export interface Household {
  readonly id: HouseholdId;
  readonly origin: EventId;
  readonly since: Tick;
  /** Los que viven en el hogar ahora, en orden de id. */
  readonly members: readonly AgentId[];
  readonly end: { readonly tick: Tick; readonly event: EventId } | null;
}

export interface VillagePopulation {
  readonly settlement: SettlementId;
  /** El evento de la fundación (el de `villageSite`) y el de la llegada de los fundadores. */
  readonly foundedEvent: EventId;
  readonly foundersEvent: EventId;
  /** El presente: el comienzo del año en que empieza la partida. */
  readonly now: Tick;
  /** Años entre la fundación y el presente. */
  readonly years: number;
  readonly capacity: number;
  readonly people: readonly Person[];
  readonly households: readonly Household[];
  /** Todos los eventos (los del sitio y los nuevos), numerados en orden. */
  readonly events: readonly Event[];
  readonly player: AgentId;
}

export interface VillagePopulationInput {
  readonly seed: Seed;
  readonly site: VillageSite;
  readonly traits: readonly Trait[];
  readonly demography: Demography;
  readonly clock?: PlanetClock;
  readonly settlement?: SettlementId;
  /** Entre qué edades se elige al jugador (player-loop §2, entrada por edad). */
  readonly playerAge?: { readonly min: number; readonly max: number };
  /**
   * Condiciones duras sobre quién puede ser el jugador (modo novela, game-modes §2.2, paso 1:
   * buscar un nacimiento real). Con ella la edad también es dura: hasta `BIRTH_AGE_SLACK` años
   * de la pedida. Si nadie cumple, tira `NoSuchBirth`.
   */
  readonly playerFits?: (p: Person, aliveHouseholds: readonly Household[]) => boolean;
}

/** Años de diferencia con la edad pedida que todavía se aceptan al buscar un nacimiento. */
export const BIRTH_AGE_SLACK = 2;

/** Nadie de la población cumple lo pedido: el modo novela lo rechaza con esta razón (§2.4). */
export class NoSuchBirth extends Error {
  override name = "NoSuchBirth";
}

type MutablePerson = { -readonly [K in keyof Person]: Person[K] } & { unionAt: Tick };
type MutableHousehold = {
  id: HouseholdId;
  origin: EventId;
  since: Tick;
  members: AgentId[];
  end: { tick: Tick; event: EventId } | null;
};

type Happening =
  | { day: number; order: 0; kind: "union"; wife: AgentId; husband: AgentId }
  | { day: number; order: 0; kind: "bride"; husband: AgentId }
  | { day: number; order: 0; kind: "married-out"; woman: AgentId }
  | { day: number; order: 1; kind: "birth"; mother: AgentId }
  | { day: number; order: 2; kind: "death"; person: AgentId };

export function villagePopulation(input: VillagePopulationInput): VillagePopulation {
  const { seed, site, traits, demography: demo } = input;
  const clock = input.clock ?? EARTHLIKE_CLOCK;
  const settlement = input.settlement ?? makeId("settlement", 1);
  const playerAge = input.playerAge ?? { min: 14, max: 16 };
  const root = Rng.root(seed);
  const place: PlaceRef = { kind: "settlement", settlement };

  const events: Event[] = [...site.events];
  const emit = (
    tick: Tick,
    kind: string,
    actors: readonly EntityRef[],
    causes: readonly CauseRef[],
    data: unknown = {},
  ): EventId => {
    const id = makeId("event", events.length + 1);
    events.push({
      id,
      tick,
      kind,
      actors: [...actors],
      place,
      data,
      emissions: null,
      causes: [...causes],
      resolution: "history",
    });
    return id;
  };
  const because = (...ids: EventId[]): CauseRef[] =>
    [...new Set(ids)].map((event) => ({ kind: "event", event }));

  const people = new Map<AgentId, MutablePerson>();
  const households = new Map<HouseholdId, MutableHousehold>();
  let nextAgent = 1;
  let nextHousehold = 1;
  const person = (id: AgentId) => people.get(id) as MutablePerson;
  const yearStart = (y: number) => firstDayOfYear(clock, y) * clock.day;
  const ageAt = (p: Person, t: Tick) => floorDiv(t - p.born, clock.year);

  // La tierra: cuánta gente sostienen los campos (settlements §2.1: el ancla de cultivo).
  const farm = site.anchors.find((a) => a.kind === "farmland");
  const capacity = Math.max(
    demo.land.minCapacity,
    Math.round((farm?.kind === "farmland" ? farm.yield : 0) * demo.land.peoplePerFarmHex),
  );

  const newPerson = (
    sex: Sex,
    born: Tick,
    origin: EventId,
    since: Tick,
    household: HouseholdId,
    parents: { mother: MutablePerson; father: MutablePerson } | null,
  ): MutablePerson => {
    const id = makeId("agent", nextAgent++);
    const genetics = root.fork("genetics", id);
    const genome = parents
      ? inheritGenome(traits, parents.mother, parents.father, genetics, origin)
      : founderGenome(traits, genetics, origin);
    const p: MutablePerson = {
      id,
      sex,
      born,
      origin,
      since,
      mother: parents?.mother.id ?? null,
      father: parents?.father.id ?? null,
      genome,
      innate: expressInnate(traits, genome, sex, root.fork("development", id)),
      household,
      spouse: null,
      union: null,
      unionAt: 0,
      end: null,
    };
    people.set(id, p);
    (households.get(household) as MutableHousehold).members.push(id);
    return p;
  };

  const newHousehold = (origin: EventId, since: Tick): MutableHousehold => {
    const h: MutableHousehold = {
      id: makeId("household", nextHousehold++),
      origin,
      since,
      members: [],
      end: null,
    };
    households.set(h.id, h);
    return h;
  };

  /** Saca a `p` de su hogar; si el hogar queda vacío, se disuelve por `cause`. */
  const leaveHousehold = (p: MutablePerson, tick: Tick, cause: EventId) => {
    const h = households.get(p.household) as MutableHousehold;
    h.members = h.members.filter((m) => m !== p.id);
    if (h.members.length === 0 && h.end === null) {
      h.end = {
        tick,
        event: emit(tick, "household.dissolved", [], because(cause), { household: h.id }),
      };
    }
  };

  const endPerson = (p: MutablePerson, tick: Tick, event: EventId, how: PersonEnd["how"]) => {
    p.end = { tick, event, how };
    if (p.spouse !== null) {
      person(p.spouse).spouse = null;
      p.spouse = null;
    }
    leaveHousehold(p, tick, event);
  };

  /** Padres y abuelos (y uno mismo): dos que comparten alguno son parientes cercanos. */
  const closeKin = (p: Person): Set<AgentId> => {
    const out = new Set<AgentId>([p.id]);
    for (const parent of [p.mother, p.father]) {
      if (parent === null) continue;
      out.add(parent);
      const pp = person(parent);
      if (pp.mother !== null) out.add(pp.mother);
      if (pp.father !== null) out.add(pp.father);
    }
    return out;
  };
  const related = (a: Person, b: Person) => {
    const ka = closeKin(a);
    for (const k of closeKin(b)) if (ka.has(k)) return true;
    return false;
  };

  /**
   * La pareja vive con los padres de él si en ese hogar no hay otra pareja casada además de
   * ellos (familia troncal: el primer hijo que se casa se queda); si no, arma hogar propio.
   */
  const settleCouple = (
    wife: MutablePerson,
    husband: MutablePerson,
    tick: Tick,
    union: EventId,
  ) => {
    const h = households.get(husband.household) as MutableHousehold;
    const otherCouple = h.members.some((m) => {
      if (m === husband.id || m === husband.father || m === husband.mother) return false;
      const x = person(m);
      return x.sex === "male" && x.spouse !== null && x.spouse !== wife.id;
    });
    let target = h;
    if (otherCouple) {
      target = newHousehold(
        emit(tick, "household.founded", [husband.id, wife.id], because(union)),
        tick,
      );
      leaveHousehold(husband, tick, union);
      husband.household = target.id;
      target.members.push(husband.id);
    }
    if (wife.household !== target.id) {
      leaveHousehold(wife, tick, union);
      wife.household = target.id;
      target.members.push(wife.id);
    }
    target.members.sort();
  };

  const marry = (wife: MutablePerson, husband: MutablePerson, tick: Tick, causes: EventId[]) => {
    const union = emit(tick, "family.union", [wife.id, husband.id], because(...causes));
    wife.spouse = husband.id;
    husband.spouse = wife.id;
    wife.union = husband.union = union;
    wife.unionAt = husband.unionAt = tick;
    settleCouple(wife, husband, tick, union);
  };

  // --- Fundación: los hogares fundadores llegan en el tick 0 con el sitio ya elegido.
  const founding = root.fork("family", "founding").stream();
  const years = founding.int(demo.founding.yearsAgo.min, demo.founding.yearsAgo.max);
  const nHouseholds = founding.int(demo.founding.households.min, demo.founding.households.max);
  const randomBirth = (r: Random, at: Tick, age: number): Tick =>
    at - age * clock.year - r.int(0, daysInYear(clock, 0) - 1) * clock.day;
  // El evento se emite antes de saber los ids: sus actores se completan abajo.
  const foundersEvent = emit(
    0,
    "family.founders_settled",
    [],
    [{ kind: "seed" }, ...because(site.foundedEvent)],
  );
  const founders: AgentId[] = [];
  for (let i = 0; i < nHouseholds; i++) {
    const h = newHousehold(emit(0, "household.founded", [], because(foundersEvent)), 0);
    const husbandAge = founding.int(demo.founding.husbandAge.min, demo.founding.husbandAge.max);
    const wifeAge = founding.int(demo.founding.wifeAge.min, demo.founding.wifeAge.max);
    const husband = newPerson(
      "male",
      randomBirth(founding, 0, husbandAge),
      foundersEvent,
      0,
      h.id,
      null,
    );
    const wife = newPerson(
      "female",
      randomBirth(founding, 0, wifeAge),
      foundersEvent,
      0,
      h.id,
      null,
    );
    husband.spouse = wife.id;
    wife.spouse = husband.id;
    // Llegaron casados: la unión es parte de las condiciones iniciales y su hogar la representa.
    husband.union = wife.union = h.origin;
    founders.push(husband.id, wife.id);
  }
  // Los actores de la fundación y de cada hogar: quienes llegaron.
  patchActors(events, foundersEvent, founders);
  for (const h of households.values()) patchActors(events, h.origin, h.members);

  // --- La pre-corrida: un año por vuelta.
  for (let y = 0; y < years; y++) {
    const start = yearStart(y);
    const days = daysInYear(clock, y);
    const r = root.fork("family", "year", y).stream();
    const living = [...people.values()].filter((p) => p.end === null);
    const happenings: Happening[] = [];

    const deathDay = new Map<AgentId, number>();
    for (const p of living) {
      const q = band(demo.mortality, ageAt(p, start));
      if (q && r.chance(q[p.sex])) {
        const day = r.int(0, days - 1);
        deathDay.set(p.id, day);
        happenings.push({ day, order: 2, kind: "death", person: p.id });
      }
    }
    const aliveOn = (id: AgentId, day: number) => (deathDay.get(id) ?? days) > day;

    // Fecundidad, con la tierra como presión.
    const crowding = living.length / capacity;
    const from = demo.land.crowdingFrom;
    const fertilityFactor =
      crowding <= from ? 1 : Math.max(0, Math.min(1, (1 - crowding) / (1 - from)));
    for (const w of living) {
      if (w.sex !== "female" || w.spouse === null || w.unionAt >= start) continue;
      const rate = (band(demo.fertility, ageAt(w, start))?.rate ?? 0) * fertilityFactor;
      if (!r.chance(rate)) continue;
      const day = r.int(0, days - 1);
      if (aliveOn(w.id, day)) happenings.push({ day, order: 1, kind: "birth", mother: w.id });
    }

    // Uniones entre solteros de la aldea que no son parientes cercanos.
    const u = demo.union;
    const single = (p: MutablePerson, sex: Sex) => {
      const range = sex === "female" ? u.women : u.men;
      const age = ageAt(p, start);
      return p.sex === sex && p.spouse === null && age >= range.from && age <= range.to;
    };
    const women = living.filter((p) => single(p, "female"));
    const men = living.filter((p) => single(p, "male"));
    const taken = new Set<AgentId>();
    for (const w of women) {
      if (!r.chance(u.rate)) continue;
      const day = r.int(0, days - 1);
      if (!aliveOn(w.id, day)) continue;
      const candidates = men.filter(
        (m) => !taken.has(m.id) && aliveOn(m.id, day) && !related(w, m),
      );
      if (candidates.length > 0) {
        const wAge = ageAt(w, start);
        const weights = candidates.map((m) =>
          exp(-Math.abs(ageAt(m, start) - wAge - u.preferredGap) / 4),
        );
        const m = candidates[r.weighted(weights)] as MutablePerson;
        taken.add(m.id);
        happenings.push({ day, order: 0, kind: "union", wife: w.id, husband: m.id });
      } else if (ageAt(w, start) >= u.outsideFrom.women && r.chance(u.outsideRate)) {
        happenings.push({ day, order: 0, kind: "married-out", woman: w.id });
      }
    }
    // Los que no tienen con quién en la aldea traen esposa de afuera.
    for (const m of men) {
      if (taken.has(m.id) || ageAt(m, start) < u.outsideFrom.men) continue;
      if (women.some((w) => !related(w, m))) continue;
      if (!r.chance(u.outsideRate)) continue;
      const day = r.int(0, days - 1);
      if (aliveOn(m.id, day)) happenings.push({ day, order: 0, kind: "bride", husband: m.id });
    }

    happenings.sort((a, b) => a.day - b.day || a.order - b.order || compareHappening(a, b));
    for (const h of happenings) {
      const tick = start + h.day * clock.day;
      switch (h.kind) {
        case "death": {
          const p = person(h.person);
          if (p.end !== null) break;
          const ev = emit(tick, "person.died", [p.id], because(p.origin), {
            age: ageAt(p, tick),
            of: "natural",
          });
          endPerson(p, tick, ev, "died");
          break;
        }
        case "married-out": {
          const w = person(h.woman);
          if (w.end !== null || w.spouse !== null) break;
          const ev = emit(tick, "family.married_out", [w.id], because(w.origin));
          endPerson(w, tick, ev, "left");
          break;
        }
        case "union": {
          const w = person(h.wife);
          const m = person(h.husband);
          if (w.end !== null || m.end !== null || w.spouse !== null || m.spouse !== null) break;
          marry(w, m, tick, [w.origin, m.origin]);
          break;
        }
        case "bride": {
          const m = person(h.husband);
          if (m.end !== null || m.spouse !== null) break;
          const age = r.int(u.women.from, u.outsideFrom.women + 4);
          // Llega por el casamiento: hasta que se arma el hogar, es parte del de él.
          const arrived = emit(
            tick,
            "person.arrived",
            [],
            [{ kind: "seed" }, ...because(m.origin)],
            {
              reason: "marriage",
            },
          );
          const w = newPerson(
            "female",
            randomBirth(r, tick, age),
            arrived,
            tick,
            m.household,
            null,
          );
          patchActors(events, arrived, [w.id]);
          marry(w, m, tick, [arrived, m.origin]);
          break;
        }
        case "birth": {
          const mother = person(h.mother);
          if (mother.end !== null || mother.union === null) break;
          const fatherId = lastHusband(mother);
          if (fatherId === null) break;
          const father = person(fatherId);
          const sex: Sex = r.chance(demo.maleBirthRatio) ? "male" : "female";
          const birth = emit(tick, "family.birth", [], because(mother.union));
          const child = newPerson(sex, tick, birth, tick, mother.household, { mother, father });
          patchActors(events, birth, [child.id, mother.id, father.id]);
          if (r.chance(demo.maternalDeath)) {
            const ev = emit(tick, "person.died", [mother.id], because(birth), {
              age: ageAt(mother, tick),
              of: "childbirth",
            });
            endPerson(mother, tick, ev, "died");
          }
          break;
        }
      }
    }
  }

  // El jugador: un nacimiento real, elegido entre los que hoy tienen la edad de entrada.
  const now = yearStart(years);
  const alive = [...people.values()].filter((p) => p.end === null);
  if (alive.length === 0) throw new RangeError("la aldea se extinguió en la pre-corrida");
  const native = alive.filter((p) => p.mother !== null);
  const pool = native.length > 0 ? native : alive;
  const distance = (p: Person) => {
    const a = ageAt(p, now);
    return a < playerAge.min ? playerAge.min - a : a > playerAge.max ? a - playerAge.max : 0;
  };
  const fits = input.playerFits;
  const aliveHouseholds = [...households.values()].filter((h) => h.end === null);
  const wanted = fits
    ? pool.filter((p) => distance(p) <= BIRTH_AGE_SLACK && fits(p, aliveHouseholds))
    : pool;
  if (wanted.length === 0) {
    throw new NoSuchBirth(
      `nadie de la aldea (${pool.length} nativos) cumple lo pedido a ${playerAge.min}-${playerAge.max} años`,
    );
  }
  const best = Math.min(...wanted.map(distance));
  const player = root.fork("player", "birth").pick(wanted.filter((p) => distance(p) === best)).id;

  const freezeHousehold = (h: MutableHousehold): Household => ({
    ...h,
    members: [...h.members].sort(),
  });
  return {
    settlement,
    foundedEvent: site.foundedEvent,
    foundersEvent,
    now,
    years,
    capacity,
    people: [...people.values()].map(({ unionAt: _, ...p }) => p),
    households: [...households.values()].map(freezeHousehold),
    events,
    player,
  };

  /** El marido de la unión vigente (o el último, si ella enviudó en el año: hijo póstumo). */
  function lastHusband(mother: MutablePerson): AgentId | null {
    if (mother.spouse !== null) return mother.spouse;
    for (const p of people.values()) {
      if (p.sex === "male" && p.union === mother.union) return p.id;
    }
    return null;
  }
}

/** Pone los actores de un evento ya emitido (se crean después del evento que los origina). */
function patchActors(events: Event[], id: EventId, actors: readonly EntityRef[]): void {
  const i = Number(id.slice(6)) - 1;
  const e = events[i];
  if (!e || e.id !== id) throw new Error(`no encuentro ${id}`);
  events[i] = { ...e, actors: [...e.actors, ...actors] };
}

function compareHappening(a: Happening, b: Happening): number {
  const key = (h: Happening) =>
    h.kind === "union"
      ? h.wife
      : h.kind === "bride"
        ? h.husband
        : h.kind === "married-out"
          ? h.woman
          : h.kind === "birth"
            ? h.mother
            : h.person;
  const ka = Number(key(a).slice(6));
  const kb = Number(key(b).slice(6));
  return ka - kb;
}
