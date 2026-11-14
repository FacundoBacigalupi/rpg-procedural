// Las misiones de la secta (novel2-missions-board, organizations §6): un encargo que la secta le da a
// un miembro para algo que de verdad le falta, a cambio de puntos de contribución. No hay misión sin
// necesidad: el tablero sale del estado de la secta.
// - Hierbas: lo que le falta al alquimista para tener las píldoras por cabeza (`endowPerHead`), menos
//   lo que ya hay de esa hierba en el tesoro y lo que ya salieron a juntar otros.
// - Vigilar: una banda viva cerca de la sede; se vigila el lugar donde anda.
// - Cazar (novel3-beasts-mission-ask): una bestia que bajó del monte, que vio alguien de la secta y
//   que sigue viva y abajo; vence cuando vuelve al monte.
// Lo que pide cada misión, el plazo y los puntos son números de acá, sin calibrar.
//
// Puro: recibe lo que la secta sabe (cuántos viven, qué hay en el tesoro, dónde anda la banda) y lo
// que ya está asignado; no lee la verdad.

import type { AgentId, EntityRef, EventId, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { MemberRank } from "./member.ts";
import type { PillDef } from "./pill.ts";

export type MissionKind = "herbs" | "watch" | "hunt";

/** Una necesidad de la secta, antes de volverse encargo. */
export type MissionNeed =
  | { readonly kind: "herbs"; readonly herb: string; readonly grams: number }
  | {
      readonly kind: "watch";
      /** La banda que anda cerca. */
      readonly band: string;
      /** El hex donde se la vio por última vez: ahí se vigila. */
      readonly hex: number;
      /** A cuántos hex de la sede. */
      readonly distance: number;
    }
  | {
      readonly kind: "hunt";
      /** La bestia que vio alguien de la secta. */
      readonly beast: EntityRef;
      /** Donde se la vio por última vez. */
      readonly hex: number;
      /** Cuándo vuelve al monte: el plazo. */
      readonly until: Tick;
    };

/** Un encargo tomado: lo que pide, hasta cuándo y cuánto paga. */
export interface SectMission {
  readonly org: EntityRef;
  readonly kind: MissionKind;
  /** Hierbas: cuál y cuántos gramos. */
  readonly herb?: string;
  readonly grams?: number;
  /** Vigilar: la banda, dónde y cuántas horas. */
  readonly band?: string;
  readonly hex?: number;
  readonly hours?: number;
  /** Cazar: la bestia (y `hex`, donde se la vio). */
  readonly beast?: EntityRef;
  /** Cazar: cuándo vuelve al monte; el plazo es ese. */
  readonly until?: Tick;
  /** Lo que lleva hecho (gramos entregados u horas de guardia). */
  readonly done: number;
  readonly points: number;
  /** Quién lo dio. */
  readonly by: AgentId;
  readonly at: Tick;
  readonly due: Tick;
  /** El evento que lo asignó. */
  readonly cause?: EventId;
}

/** La misión que tiene tomada cada miembro (una a la vez). La escribe `sect-duty`. */
export const SECT_MISSION = table<SectMission>("cultivation.sect_mission");

export const MISSION_ASSIGNED_EVENT = "cultivation.mission_assigned";
export const MISSION_DONE_EVENT = "cultivation.mission_done";
/** Una entrega que no la completa (novel2-missions-herbs): se anotan los puntos de lo entregado. */
export const MISSION_PROGRESS_EVENT = "cultivation.mission_progress";
export const MISSION_LAPSED_EVENT = "cultivation.mission_lapsed";

/** Lo más que pide una misión de hierbas; lo que falta de más queda para otras. */
export const MISSION_HERB_GRAMS = 400;
/** Lo menos que vale salir a juntar: por debajo, el alquimista se arregla. */
export const MISSION_HERB_MIN_GRAMS = 40;
/** Puntos por gramo entregado (una píldora de 20 g vale 10 en el pabellón: el refinado vale la mitad). */
export const MISSION_POINTS_PER_GRAM = 0.25;
/** Horas de guardia que pide una misión de vigilar y cuántos puntos por hora (el doble que barrer). */
export const MISSION_WATCH_HOURS = 8;
export const MISSION_WATCH_POINTS_PER_HOUR = 2;
/** Hasta cuántos hex de la sede una banda es asunto de la secta. */
export const MISSION_WATCH_RADIUS = 3;
/** Lo que paga cazar a una bestia que bajó (o echarla): como un día y medio de guardia. */
export const MISSION_HUNT_POINTS = 24;
/** Días de plazo (cazar vence antes si la bestia vuelve al monte: `until`). */
export const MISSION_DAYS: Readonly<Record<MissionKind, number>> = {
  herbs: 14,
  watch: 7,
  hunt: 2,
};
/** Desde qué rango se da cada clase: vigilar a una banda no es para un externo. */
export const MISSION_MIN_RANK: Readonly<Record<MissionKind, MemberRank>> = {
  herbs: "outer",
  watch: "inner",
  hunt: "outer",
};

const RANK_ORDER: readonly MemberRank[] = ["outer", "inner", "core", "elder", "master"];

/** Si `rank` alcanza para una misión de `kind`. Los ancianos y el maestro no salen a misiones. */
export function missionFits(kind: MissionKind, rank: MemberRank): boolean {
  if (rank === "elder" || rank === "master") return false;
  return RANK_ORDER.indexOf(rank) >= RANK_ORDER.indexOf(MISSION_MIN_RANK[kind]);
}

/** Lo que la secta sabe de su tesoro para la alquimia. */
export interface HerbLedger {
  /** Cuántos viven en la sede. */
  readonly alive: number;
  /** Píldoras en el tesoro, por `PillDef.good`. */
  readonly pills: Readonly<Record<string, number>>;
  /** Gramos de cada hierba en el tesoro, por `HerbDef.id`. */
  readonly herbs: Readonly<Record<string, number>>;
}

/**
 * Los gramos de cada hierba que le faltan al alquimista: por cada píldora con receta, las que faltan
 * para `endowPerHead` por cabeza por los gramos de la receta; se suman por hierba y se resta lo que hay.
 */
export function herbNeeds(pills: readonly PillDef[], at: HerbLedger): MissionNeed[] {
  const want = new Map<string, number>();
  for (const pill of pills) {
    if (!pill.recipe || !pill.endowPerHead) continue;
    const missing = Math.ceil(pill.endowPerHead * at.alive) - (at.pills[pill.good] ?? 0);
    if (missing <= 0) continue;
    const herb = pill.recipe.herb;
    want.set(herb, (want.get(herb) ?? 0) + missing * pill.recipe.grams);
  }
  const out: MissionNeed[] = [];
  for (const [herb, grams] of [...want].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const short = Math.ceil(grams - Math.max(0, at.herbs[herb] ?? 0));
    if (short > 0) out.push({ kind: "herbs", herb, grams: short });
  }
  return out;
}

/**
 * Lo que una secta sabe de una bestia que bajó (novel3-beasts-mission-seen): uno de sus miembros la
 * vio (afuera en su hex, o atacado por ella). Por bestia: la última vez que la vio alguien de esa
 * secta, quién y dónde. Sin testigo, la secta no sabe.
 */
export interface BeastSeen {
  readonly org: EntityRef;
  readonly by: AgentId;
  readonly at: Tick;
  readonly hex: number;
  /** El evento de la vista (la primera vez); las siguientes solo mueven `at`, `by` y `hex`. */
  readonly cause: EventId;
}

export const BEAST_SEEN = table<BeastSeen>("cultivation.beast_seen");
export const BEAST_SEEN_EVENT = "cultivation.beast_seen";

/** Una banda que la secta conoce: dónde anda y a qué distancia de la sede. */
export interface BandSighting {
  readonly band: string;
  readonly hex: number;
  readonly distance: number;
}

/** Las bandas a `MISSION_WATCH_RADIUS` o menos de la sede, la más cercana primero. */
export function watchNeeds(bands: readonly BandSighting[]): MissionNeed[] {
  return bands
    .filter((b) => b.distance <= MISSION_WATCH_RADIUS)
    .sort((a, b) => a.distance - b.distance || (a.band < b.band ? -1 : a.band > b.band ? 1 : 0))
    .map((b) => ({ kind: "watch" as const, band: b.band, hex: b.hex, distance: b.distance }));
}

/** Una bestia que la secta vio: cuál, dónde y hasta cuándo anda abajo. */
export interface BeastSighting {
  readonly beast: EntityRef;
  readonly hex: number;
  readonly until: Tick;
}

/** Las bestias vistas que siguen abajo en `now`, la que se va antes primero. */
export function huntNeeds(beasts: readonly BeastSighting[], now: Tick): MissionNeed[] {
  return beasts
    .filter((b) => b.until > now)
    .sort((a, b) => a.until - b.until || (a.beast < b.beast ? -1 : a.beast > b.beast ? 1 : 0))
    .map((b) => ({ kind: "hunt" as const, beast: b.beast, hex: b.hex, until: b.until }));
}

/** Lo que el que asigna le da a quien pide: el encargo, sin quién ni cuándo. */
export type MissionOffer = Omit<SectMission, "by" | "at" | "due" | "cause" | "done">;

/**
 * El encargo para quien pide: primero cazar (la bestia se va pronto), después vigilar (una banda cerca
 * apura más), después hierbas; una sola misión por bestia y por banda; de cada
 * necesidad se resta lo que ya salieron a hacer otros de la misma secta. Nada si no hay necesidad
 * que su rango pueda tomar.
 */
export function pickMission(
  org: EntityRef,
  rank: MemberRank,
  needs: readonly MissionNeed[],
  assigned: readonly SectMission[],
): MissionOffer | undefined {
  const mine = assigned.filter((m) => m.org === org);
  const ordered = [
    ...needs.filter((n) => n.kind === "hunt"),
    ...needs.filter((n) => n.kind === "watch"),
    ...needs.filter((n) => n.kind === "herbs"),
  ];
  for (const need of ordered) {
    if (!missionFits(need.kind, rank)) continue;
    if (need.kind === "hunt") {
      if (mine.some((m) => m.kind === "hunt" && m.beast === need.beast)) continue;
      return {
        org,
        kind: "hunt",
        beast: need.beast,
        hex: need.hex,
        until: need.until,
        points: MISSION_HUNT_POINTS,
      };
    }
    if (need.kind === "watch") {
      if (mine.some((m) => m.kind === "watch" && m.band === need.band)) continue;
      return {
        org,
        kind: "watch",
        band: need.band,
        hex: need.hex,
        hours: MISSION_WATCH_HOURS,
        points: MISSION_WATCH_HOURS * MISSION_WATCH_POINTS_PER_HOUR,
      };
    }
    const out = mine
      .filter((m) => m.kind === "herbs" && m.herb === need.herb)
      .reduce((s, m) => s + Math.max(0, (m.grams ?? 0) - m.done), 0);
    const grams = Math.min(MISSION_HERB_GRAMS, need.grams - out);
    if (grams < MISSION_HERB_MIN_GRAMS) continue;
    return {
      org,
      kind: "herbs",
      herb: need.herb,
      grams,
      points: Math.round(grams * MISSION_POINTS_PER_GRAM * 100) / 100,
    };
  }
  return undefined;
}

/** El plazo de una misión dada en `now`; la de cazar, a más tardar cuando la bestia vuelve (`until`). */
export const missionDue = (kind: MissionKind, now: Tick, dayTicks: number, until?: Tick): Tick =>
  Math.min(now + MISSION_DAYS[kind] * dayTicks, until ?? Number.POSITIVE_INFINITY);

/** Si la misión ya venció sin cumplirse. */
export const missionLapsed = (m: SectMission, now: Tick): boolean => now > m.due;

/**
 * Lo que vale una entrega de `amount` (gramos u horas) para la misión: cuánto cuenta (hasta lo que
 * falta), los puntos de eso (a prorrata de los de la misión) y si con eso se cumple.
 */
export function missionCredit(
  m: SectMission,
  amount: number,
): { readonly counted: number; readonly points: number; readonly complete: boolean } {
  const total = m.kind === "herbs" ? (m.grams ?? 0) : (m.hours ?? 0);
  const counted = Math.max(0, Math.min(amount, missionLeft(m)));
  const points = total > 0 ? Math.round((counted / total) * m.points * 100) / 100 : 0;
  return { counted, points, complete: total > 0 && m.done + counted >= total };
}

/** Lo que falta para cumplirla (gramos u horas). */
export const missionLeft = (m: SectMission): number =>
  Math.max(0, (m.kind === "herbs" ? (m.grams ?? 0) : (m.hours ?? 0)) - m.done);
