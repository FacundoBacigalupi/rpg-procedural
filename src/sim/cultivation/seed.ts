// La siembra del cultivo en una vida nueva (novel-cult-law): la ley del seed en la fila del plano,
// con su evento de origen (`cultivation.law`, condición del seed), y el talento de cada persona que
// ya existe, heredado de sus padres cuando están (los mayores primero) o del fondo de la población.
// Con la ley va la fuerza del Cielo (`HEAVEN_LAW`, novel2-trib-heaven). Solo con el cultivo
// encendido; apagado no se escribe nada.

import {
  type AgentId,
  compareStrings,
  type EntityRef,
  type EventId,
  type EventLog,
  type IdAllocator,
  type PlaceRef,
  Rng,
  type Seed,
  type Tick,
} from "../../core/index.ts";
import { PERSON, type Trait } from "../family/index.ts";
import { generateHeavenLaw, HEAVEN_LAW, HEAVEN_LAW_EVENT } from "../heaven/index.ts";
import { ENTITY, type WorldTruth } from "../world/index.ts";
import { QI_TAKEN } from "./absorb.ts";
import { CULTIVATION_LAW, type CultivationLaw, generateCultivationLaw } from "./law.ts";
import { PLACE_QI, type PlaceQi } from "./meditation.ts";
import { generateSchool, type SchoolNames, SECT_SCHOOL } from "./school.ts";
import {
  generateSect,
  SECT,
  SECT_FOUNDED_EVENT,
  SECT_LORE,
  type Sect,
  type SectSeat,
  sectLoreOf,
} from "./sect.ts";
import { TALENT, type TalentRecord, talentOf } from "./talent.ts";

export const CULTIVATION_LAW_EVENT = "cultivation.law";

/**
 * Hace cuántos años rige la ley al sembrarla: es del mundo, más vieja que cualquier cosa que se
 * siembre después citándola (la secta se funda hasta 400 años antes).
 */
export const LAW_SINCE_YEARS = 1000;

export interface SeedCultivationOptions {
  readonly seed: Seed;
  readonly now: Tick;
  /** Ticks por año, para fechar la ley `LAW_SINCE_YEARS` antes de `now`. */
  readonly yearTicks: number;
  readonly place: PlaceRef;
  readonly elementSystem: { readonly id: string; readonly elements: readonly string[] };
  readonly talents: readonly Trait[];
  /** El qi de la celda de la aldea (novel-cult-meditate); sin él, un lugar común. */
  readonly qi?: PlaceQi;
}

/** El rng del talento de una persona: el mismo al sembrar y al nacer. */
export const talentRng = (seed: Seed, who: AgentId): Rng => Rng.root(seed).fork("talent", who);

/** Escribe la ley y el talento de la gente. Devuelve la ley. */
export function seedCultivation(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  o: SeedCultivationOptions,
): CultivationLaw {
  const event = ids.next("event") as EventId;
  const plane = ids.next("plane");
  const law = generateCultivationLaw(
    Rng.root(o.seed).fork("cultivation", "law"),
    o.elementSystem,
    event,
  );
  const since = o.now - LAW_SINCE_YEARS * o.yearTicks;
  log.append({
    id: event,
    tick: since,
    kind: CULTIVATION_LAW_EVENT,
    actors: [],
    place: o.place,
    data: { plane, thresholds: law.paths[0]?.thresholds.length ?? 0 },
    emissions: {},
    causes: [{ kind: "seed" }],
    resolution: "world",
  });
  truth.set(ENTITY, plane, { id: plane, originEventId: event, createdAt: since });
  truth.set(CULTIVATION_LAW, plane, law);
  // La fuerza del Cielo (novel2-trib-heaven): también del seed y tan vieja como la ley.
  const heavenEvent = ids.next("event") as EventId;
  log.append({
    id: heavenEvent,
    tick: since,
    kind: HEAVEN_LAW_EVENT,
    actors: [],
    place: o.place,
    data: { plane },
    emissions: {},
    causes: [{ kind: "seed" }],
    resolution: "world",
  });
  truth.set(
    HEAVEN_LAW,
    plane,
    generateHeavenLaw(Rng.root(o.seed).fork("heaven", "law"), heavenEvent),
  );
  if (o.qi) {
    truth.set(PLACE_QI, plane, o.qi);
    truth.set(QI_TAKEN, plane, { taken: 0, drawn: 0, at: o.now });
  }
  const people = truth
    .ids(PERSON)
    .map((id) => id as AgentId)
    .sort(
      (a, b) =>
        (truth.get(PERSON, a)?.born ?? 0) - (truth.get(PERSON, b)?.born ?? 0) ||
        compareStrings(a, b),
    );
  const done = new Map<AgentId, TalentRecord>();
  for (const who of people) {
    const p = truth.get(PERSON, who);
    if (!p) continue;
    const m = p.mother ? done.get(p.mother) : undefined;
    const f = p.father ? done.get(p.father) : undefined;
    const origin = truth.get(ENTITY, who)?.originEventId ?? event;
    const t = talentOf(
      o.talents,
      p.sex,
      m && f && p.mother && p.father
        ? {
            mother: { id: p.mother, genome: m.genome },
            father: { id: p.father, genome: f.genome },
          }
        : undefined,
      talentRng(o.seed, who),
      origin,
    );
    done.set(who, t);
    truth.set(TALENT, who, t);
  }
  return law;
}

export interface SeedSectOptions {
  readonly seed: Seed;
  readonly now: Tick;
  readonly yearTicks: number;
  /** Dónde ocurre el evento: la aldea (es lo que la aldea sabe de la fundación). */
  readonly place: PlaceRef;
  readonly talents: readonly Trait[];
  readonly seat: SectSeat;
  /** El día del año en que baja a la aldea (`sectVisitDay`); sin él, no baja. */
  readonly visitDay?: number;
  /** Los nombres de la familia del mundo (`content/schools/`); sin ellos, la secta no tiene escuela. */
  readonly school?: SchoolNames;
}

/**
 * Funda la secta cercana (novel-cult-sect-place) generaciones antes de ahora, en la sede con más qi
 * al alcance, con un lugar para su sede (al que quien siembra le pone nombre). Causas: la ley (sin
 * ella no hay cultivadores) y el qi de la sede (del planeta: el seed), que es por qué está ahí. Devuelve la secta y su id.
 */
export function seedSect(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  o: SeedSectOptions,
): { org: EntityRef; sect: Sect } | undefined {
  const plane = truth.ids(CULTIVATION_LAW)[0];
  const law = plane ? truth.get(CULTIVATION_LAW, plane) : undefined;
  if (!plane || !law) return undefined;
  const rng = Rng.root(o.seed).fork("cultivation", "sect");
  const foundedYearsAgo = rng.fork("founded").int(80, 400);
  const event = ids.next("event") as EventId;
  const org = ids.next("org");
  const seatPlace = ids.next("place");
  const generated = generateSect({
    rng: rng.fork("slots"),
    law,
    talents: o.talents,
    seat: o.seat,
    seatPlace,
    now: o.now,
    yearTicks: o.yearTicks,
    originEventId: event,
    foundedYearsAgo,
  });
  const sect: Sect = o.visitDay === undefined ? generated : { ...generated, visitDay: o.visitDay };
  log.append({
    id: event,
    tick: sect.founded,
    kind: SECT_FOUNDED_EVENT,
    actors: [],
    place: o.place,
    data: {
      org,
      seat: o.seat.cell,
      hops: o.seat.hops,
      km: o.seat.km,
      level: o.seat.qi.level,
      slots: sect.slots.length,
    },
    emissions: {},
    causes: [
      { kind: "state", entity: plane, key: CULTIVATION_LAW.name },
      // El qi de la sede es del planeta: condición del seed, en `data.level`.
      { kind: "seed" },
    ],
    resolution: "world",
  });
  truth.set(ENTITY, org, { id: org, originEventId: event, createdAt: sect.founded });
  truth.set(ENTITY, seatPlace, { id: seatPlace, originEventId: event, createdAt: sect.founded });
  truth.set(SECT, org, sect);
  // La escuela (novel-cult-school): sus reinos sobre los umbrales y la técnica de entrada.
  if (o.school) truth.set(SECT_SCHOOL, org, generateSchool(rng.fork("school"), law, o.school));
  return { org, sect };
}

/** Desde qué edad se sabe de la secta, y con qué probabilidad un adulto y un chico. */
const LORE_ADULT_YEARS = 14;
const LORE_CHILD_YEARS = 7;
const LORE_ADULT_CHANCE = 0.85;
const LORE_CHILD_CHANCE = 0.4;

export interface SeedSectLoreOptions {
  readonly seed: Seed;
  readonly now: Tick;
  readonly yearTicks: number;
  readonly org: EntityRef;
  readonly sect: Sect;
  /** Quienes viven en la aldea (los muertos no aprenden). */
  readonly people: readonly AgentId[];
}

/**
 * Lo que la aldea sabe de la secta (novel-cult-sect-known): casi todos los adultos y algunos chicos
 * la tienen oída, cada uno con su error. Los más chicos no saben nada todavía.
 */
export function seedSectLore(truth: WorldTruth, o: SeedSectLoreOptions): number {
  const root = Rng.root(o.seed).fork("cultivation", "sect", "lore");
  let n = 0;
  for (const id of [...o.people].sort(compareStrings)) {
    const p = truth.get(PERSON, id);
    if (!p) continue;
    const age = (o.now - p.born) / o.yearTicks;
    const chance =
      age >= LORE_ADULT_YEARS ? LORE_ADULT_CHANCE : age >= LORE_CHILD_YEARS ? LORE_CHILD_CHANCE : 0;
    const rng = root.fork(id);
    if (!rng.fork("knows").chance(chance)) continue;
    truth.set(SECT_LORE, id, sectLoreOf(rng, o.org, o.sect, o.now));
    n++;
  }
  return n;
}
