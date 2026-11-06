// Una secta cercana (novel-cult-sect-place, cultivation §9 y organizations): la organización de
// cultivadores que la aldea tiene a su alcance. Su sede está en la celda con más qi en tierra a dos
// saltos o menos de la aldea (los cultivadores se instalan donde el qi es denso: esa es la causa de
// que esté ahí), fundada generaciones antes con su evento de origen. Sus cultivadores son ranuras
// con hechos fijados (simulation §materialización): talento sacado con la misma ley y solo con raíz
// (la secta no admite a quien no la tiene), reino, qi bajo la capacidad de su tramo, pureza según
// el qi de la sede y fundamento; todavía sin cuerpo ni lugar, se vuelven personas cuando bajan o
// cuando alguien sube. Las proporciones no están calibradas.

import { atan2, cos, type EntityRef, type EventId, type Rng, type Tick } from "../../core/index.ts";
import type { Sex, Trait } from "../family/index.ts";
import { table } from "../world/index.ts";
import { rootMatch, vesselCapacity } from "./absorb.ts";
import type { CultivationLaw } from "./law.ts";
import type { PlaceQi } from "./meditation.ts";
import { aptitudeOf, type TalentRecord, talentOf } from "./talent.ts";

export const SECT_FOUNDED_EVENT = "cultivation.sect_founded";

/** Una celda candidata a sede: a cuántos saltos de la aldea, su qi y si es tierra firme. */
export interface SeatCandidate {
  readonly cell: number;
  readonly hops: number;
  readonly level: number;
  readonly land: boolean;
}

/** La sede: la celda, qué tan lejos y hacia dónde desde la aldea, y su qi. */
export interface SectSeat {
  readonly cell: number;
  readonly hops: number;
  /** Distancia aproximada en km (saltos × km por salto; en la misma celda, medio salto). */
  readonly km: number;
  /** Rumbo desde la aldea, grados desde el norte en sentido horario. */
  readonly bearingDeg: number;
  readonly qi: PlaceQi;
}

export type SectRank = "master" | "elder" | "disciple";

/** Un cultivador de la secta como hechos fijados: se vuelve persona al materializarse. */
export interface SectSlot {
  readonly slot: number;
  readonly rank: SectRank;
  readonly sex: Sex;
  readonly born: Tick;
  readonly talent: TalentRecord;
  /** Umbrales cruzados del camino del qi. */
  readonly stage: number;
  readonly qi: number;
  readonly purity: number;
  readonly foundation: number;
}

export interface Sect {
  /** La entidad lugar de la sede, con su nombre (`PLACE_NAME`). */
  readonly seatPlace: EntityRef;
  readonly seat: SectSeat;
  readonly founded: Tick;
  readonly originEventId: EventId;
  readonly slots: readonly SectSlot[];
  /**
   * El día del año (día local, 0 = comienzo del año) en que baja a la aldea a buscar discípulos
   * (novel-cult-sect-visit); sin él, no baja.
   */
  readonly visitDay?: number;
}

/** La secta vive en una entidad `org:N` con este componente. */
export const SECT = table<Sect>("cultivation.sect");

/** Cuántos saltos del planeta cuentan como «al alcance»: unas semanas a pie. */
export const SEAT_REACH_HOPS = 2;

/**
 * La sede: la candidata en tierra con más qi; empata la más cercana y después la de menor id.
 * Sin tierra, ninguna.
 */
export function chooseSeat(candidates: readonly SeatCandidate[]): SeatCandidate | undefined {
  let best: SeatCandidate | undefined;
  for (const c of candidates) {
    if (!c.land) continue;
    if (
      !best ||
      c.level > best.level ||
      (c.level === best.level &&
        (c.hops < best.hops || (c.hops === best.hops && c.cell < best.cell)))
    ) {
      best = c;
    }
  }
  return best;
}

const DEG = 180 / Math.PI;

/** Rumbo de `from` a `to` (lat/lon en grados), en grados desde el norte, para distancias cortas. */
export function bearingDeg(
  from: { readonly lat: number; readonly lon: number },
  to: { readonly lat: number; readonly lon: number },
): number {
  let dLon = to.lon - from.lon;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  const east = dLon * cos(from.lat / DEG);
  const north = to.lat - from.lat;
  if (east === 0 && north === 0) return 0;
  const b = atan2(east, north) * DEG;
  return Math.round(((b % 360) + 360) % 360);
}

/** Cuántos de cada rango y en qué tramo están (sin calibrar). */
const RANKS: ReadonlyArray<{
  rank: SectRank;
  count: readonly [number, number];
  stage: readonly [number, number];
  age: readonly [number, number];
}> = [
  { rank: "master", count: [1, 1], stage: [3, 4], age: [90, 160] },
  { rank: "elder", count: [1, 3], stage: [2, 3], age: [45, 110] },
  { rank: "disciple", count: [3, 6], stage: [1, 2], age: [15, 35] },
];

/** Cuántas veces se prueba sacar un talento con raíz para una ranura antes de rendirse. */
const ROOT_TRIES = 200;

export interface GenerateSectInput {
  readonly rng: Rng;
  readonly law: CultivationLaw;
  readonly talents: readonly Trait[];
  readonly seat: SectSeat;
  readonly seatPlace: EntityRef;
  readonly now: Tick;
  readonly yearTicks: number;
  readonly originEventId: EventId;
  /** Hace cuántos años se fundó (lo elige quien siembra, para fechar el evento). */
  readonly foundedYearsAgo: number;
}

/** La secta con sus ranuras: solo gente con raíz, en tramos que la ley permite. */
export function generateSect(i: GenerateSectInput): Sect {
  const thresholds = i.law.paths[0]?.thresholds.length ?? 0;
  const slots: SectSlot[] = [];
  for (const r of RANKS) {
    const n = i.rng.fork("count", r.rank).int(r.count[0], r.count[1]);
    for (let k = 0; k < n; k++) {
      const slot = slots.length;
      const rng = i.rng.fork("slot", slot);
      const sex: Sex = rng.chance(0.5) ? "female" : "male";
      let talent: TalentRecord | undefined;
      for (let t = 0; t < ROOT_TRIES && !talent; t++) {
        const tr = talentOf(i.talents, sex, undefined, rng.fork("talent", t), i.originEventId);
        if (aptitudeOf(i.law, tr.innate).roots.length > 0) talent = tr;
      }
      if (!talent) continue;
      const apt = aptitudeOf(i.law, talent.innate);
      const stage = Math.min(Math.max(0, thresholds - 1), rng.int(r.stage[0], r.stage[1]));
      const capacity = vesselCapacity(i.law, stage);
      const match = rootMatch(apt, i.seat.qi);
      const years = rng.int(r.age[0], r.age[1]);
      slots.push({
        slot,
        rank: r.rank,
        sex,
        born: i.now - years * i.yearTicks,
        talent,
        stage,
        qi: Math.round(capacity * (0.3 + 0.65 * rng.float())),
        purity: Math.round((0.5 * match + 0.5 * apt.rootQuality) * 1000) / 1000,
        foundation: Math.round(stage * (0.4 + 0.4 * rng.float()) * 1000) / 1000,
      });
    }
  }
  return {
    seatPlace: i.seatPlace,
    seat: i.seat,
    founded: i.now - i.foundedYearsAgo * i.yearTicks,
    originEventId: i.originEventId,
    slots,
  };
}

/** Quién manda: la ranura de maestro, si quedó alguna. */
export const sectMaster = (s: Sect): SectSlot | undefined =>
  s.slots.find((x) => x.rank === "master");

// Lo que la aldea sabe de la secta (novel-cult-sect-known, information §1): no es un menú, es una
// creencia de cada uno con errores. Rumbo en ocho puntos y distancia en jornadas a pie, cada una con
// su error de quien lo oyó contar; la confianza decide cómo lo dice («dicen que…», «sabés que…»).

export const COMPASS8 = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type Compass8 = (typeof COMPASS8)[number];

/** Lo que alguien cree de la secta: dónde queda su sede y que ahí viven cultivadores. */
export interface SectLore {
  readonly org: EntityRef;
  readonly seat: EntityRef;
  readonly bearing: Compass8;
  /** Jornadas a pie que cree que hay, al menos una. */
  readonly days: number;
  /** 0-1: qué tan firme lo cree (de oídas en la aldea, casi nunca seguro). */
  readonly confidence: number;
  readonly learnedAt: Tick;
  /** Cuándo cree que baja la próxima vez (lo anunció el heraldo). */
  readonly visitAt?: Tick;
}

/** La creencia sobre la secta, en la entidad de quien cree. */
export const SECT_LORE = table<SectLore>("cultivation.sect_lore");

/** Lo que se camina en una jornada por senderos (sin calibrar). */
export const WALK_KM_PER_DAY = 25;
/** El desvío típico del rumbo que se cuenta, en grados. */
const BEARING_ERROR_SD = 25;

export function compassOf(deg: number): Compass8 {
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return COMPASS8[i] as Compass8;
}

/** La creencia de una persona: rumbo y jornadas con el error de lo oído. */
export function sectLoreOf(rng: Rng, org: EntityRef, sect: Sect, learnedAt: Tick): SectLore {
  const bearing = compassOf(sect.seat.bearingDeg + rng.fork("bearing").normal(0, BEARING_ERROR_SD));
  const spread = 0.7 + 0.6 * rng.fork("days").float();
  const days = Math.max(1, Math.round((sect.seat.km / WALK_KM_PER_DAY) * spread));
  return {
    org,
    seat: sect.seatPlace,
    bearing,
    days,
    confidence: Math.round((0.4 + 0.45 * rng.fork("confidence").float()) * 1000) / 1000,
    learnedAt,
  };
}

// La bajada anual (novel-cult-sect-visit): un día al año la secta manda gente a la plaza de la aldea
// a buscar chicos con raíz. Una semana antes llega el aviso; el día, de media mañana a la tarde.

export const SECT_HERALD_EVENT = "cultivation.sect_herald";
export const SECT_VISIT_EVENT = "cultivation.sect_visit";
/** Con cuántos días de aviso, desde qué hora local y cuántas horas se queda. */
export const SECT_ANNOUNCE_DAYS = 7;
export const SECT_VISIT_FROM_HOUR = 9;
export const SECT_VISIT_HOURS = 8;
/** Cuántos días después del pico de la cosecha baja (con los graneros llenos y los chicos libres). */
export const SECT_VISIT_AFTER_HARVEST_DAYS = 15;

/** Qué año (índice desde el comienzo) ya se anunció y cuál ya bajó, en la entidad de la secta. */
export interface SectVisitState {
  readonly announced: number;
  readonly visited: number;
}
export const SECT_VISIT = table<SectVisitState>("cultivation.sect_visit");

/** El día del año de la bajada: unos días después del pico de la cosecha de `season`. */
export function sectVisitDay(season: (day: number) => number, yearDays: number): number {
  let best = 0;
  let peak = Number.NEGATIVE_INFINITY;
  for (let d = 0; d < yearDays; d++) {
    const f = season(d);
    if (f > peak) {
      peak = f;
      best = d;
    }
  }
  return (best + SECT_VISIT_AFTER_HARVEST_DAYS) % yearDays;
}

/**
 * La bajada que toca a `now`: la de este año si todavía no terminó, si no la del que viene. `offset`
 * son los ticks que suma la longitud del lugar a la hora (hora local).
 */
export function upcomingVisit(
  now: Tick,
  visitDay: number,
  clock: { readonly day: number; readonly year: number },
  offset: number,
): { readonly year: number; readonly start: Tick; readonly end: Tick } {
  const yearDays = Math.round(clock.year / clock.day);
  const localDay = Math.floor((now + offset) / clock.day);
  const at = (year: number) => {
    const start =
      (year * yearDays + visitDay) * clock.day -
      offset +
      Math.round((SECT_VISIT_FROM_HOUR / 24) * clock.day);
    return { year, start, end: start + Math.round((SECT_VISIT_HOURS / 24) * clock.day) };
  };
  const year = Math.floor(localDay / yearDays);
  const here = at(year);
  return now < here.end ? here : at(year + 1);
}
