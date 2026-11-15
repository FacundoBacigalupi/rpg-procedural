// El torneo entre sectas (novel4-tournament, organizations §10 y §14): dos sectas rivales se miden
// cada tanto con duelos a rendirse en la plataforma de una de ellas, ante los ancianos de las dos.
// Convocarlo es una decisión de las dos (novel4-tournament-call): cada una lo acepta si no le guarda
// demasiado rencor a la otra (con mucho rencor la cuenta se salda de otro modo) ni le tiene demasiado
// miedo (no se expone ante una que cree mucho más fuerte). La primera vez lo pone la más vieja; después,
// la otra. Si llega el día y no se hace, se pierde y se puede volver a convocar.
//
// Puro: sin IO. Lo convoca y lo vence `life.sect_tournament`.

import type { AgentId, EntityRef, EventId, Tick } from "../../core/index.ts";
import type { OrgTie } from "../org/index.ts";
import { table } from "../world/index.ts";

export const ORG_TOURNAMENT_CALLED_EVENT = "org.tournament_called";
export const ORG_TOURNAMENT_LAPSED_EVENT = "org.tournament_lapsed";
/** Se hizo: los duelos en la plataforma de la que lo pone (novel4-tournament-bouts). */
export const ORG_TOURNAMENT_HELD_EVENT = "org.tournament_held";

/** Cada cuántos días, desde el último, se puede convocar otro (sin calibrar). */
export const TOURNAMENT_EVERY_DAYS = 180;
/** Cuántos días de aviso: lo que tarda la visitante en llegar de sede a sede a pie (sin calibrar). */
export const TOURNAMENT_NOTICE_DAYS = 45;
/** Cuántos días después del convocado se pierde si no se hizo. */
export const TOURNAMENT_LATE_DAYS = 2;
/** Cuántos manda la visitante (novel4-tournament-delegation): un anciano primero, si hay. */
export const TOURNAMENT_DELEGATES = 3;
/** Cuántos días antes del torneo sale la delegación: apenas la nombran (el aviso es el viaje). */
export const TOURNAMENT_SETOFF_DAYS = TOURNAMENT_NOTICE_DAYS;
/** Cuántos días después del cierre la delegación sigue volviendo (el mismo viaje); pasado eso, ya no es delegación. */
export const TOURNAMENT_RETURN_DAYS = TOURNAMENT_NOTICE_DAYS;
/** Con este rencor o más, la secta no se mide en torneo (sin calibrar). */
export const TOURNAMENT_MAX_RESENTMENT = 0.6;
/** Con este miedo o más, no se expone (sin calibrar). */
export const TOURNAMENT_MAX_FEAR = 0.6;

export type TournamentStatus = "called" | "held" | "lapsed";

/** Un torneo entre dos sectas: el último convocado. */
export interface TournamentRecord {
  /** La que lo pone (su plataforma, sus ancianos de dueños de casa). */
  readonly host: EntityRef;
  /** El tick del día en que se hace. */
  readonly at: Tick;
  /** `org.tournament_called`. */
  readonly called: EventId;
  readonly status: TournamentStatus;
  /** Cuándo se hizo o se perdió. */
  readonly closed?: Tick;
  /** El evento que lo cerró (hecho o perdido). */
  readonly closedBy?: EventId;
  /** Los que manda la visitante de cuerpo (novel4-tournament-delegation). */
  readonly delegates?: readonly AgentId[];
}

/**
 * Los torneos de una secta con cada otra (clave: la otra). Se guarda en la de id menor del par
 * (`tournamentKeeper`), para que haya uno solo por par.
 */
export interface SectTournaments {
  readonly with: Readonly<Record<string, TournamentRecord>>;
}

export const SECT_TOURNAMENT = table<SectTournaments>("cultivation.sect_tournament");

/** La secta del par que guarda el registro: la de id menor. */
export function tournamentKeeper(a: EntityRef, b: EntityRef): [EntityRef, EntityRef] {
  return a < b ? [a, b] : [b, a];
}

/** Si la secta acepta medirse con la otra, por lo que siente de ella. */
export function acceptsTournament(tie: OrgTie | undefined): boolean {
  if (!tie?.formal.includes("rival")) return false;
  return (
    tie.sentiment.resentment < TOURNAMENT_MAX_RESENTMENT && tie.sentiment.fear < TOURNAMENT_MAX_FEAR
  );
}

/** Si toca convocar: nunca hubo, o el último se cerró hace `TOURNAMENT_EVERY_DAYS`. */
export function tournamentDue(
  rec: TournamentRecord | undefined,
  now: Tick,
  dayTicks: number,
): boolean {
  if (!rec) return true;
  if (rec.status === "called") return false;
  return now - (rec.closed ?? rec.at) >= TOURNAMENT_EVERY_DAYS * dayTicks;
}

/** Si el convocado ya pasó sin hacerse. */
export function tournamentLate(rec: TournamentRecord, now: Tick, dayTicks: number): boolean {
  return rec.status === "called" && now >= rec.at + TOURNAMENT_LATE_DAYS * dayTicks;
}

/**
 * Quién lo pone: la primera vez la más vieja (`founded`; a igual, la de id menor); después, la que
 * no lo puso la vez anterior.
 */
export function nextHost(
  prev: TournamentRecord | undefined,
  a: { readonly id: EntityRef; readonly founded: Tick },
  b: { readonly id: EntityRef; readonly founded: Tick },
): EntityRef {
  if (prev) return prev.host === a.id ? b.id : a.id;
  if (a.founded !== b.founded) return a.founded < b.founded ? a.id : b.id;
  return a.id < b.id ? a.id : b.id;
}

/**
 * Qué le toca a un delegado (puro, novel4-tournament-delegation): con el torneo convocado, desde
 * `TOURNAMENT_SETOFF_DAYS` antes, estar en la sede que lo pone (`host`); cerrado, hasta
 * `TOURNAMENT_RETURN_DAYS` después, volver a la suya (`home`). Fuera de eso, nada.
 */
export function delegateLeg(
  rec: TournamentRecord,
  now: Tick,
  dayTicks: number,
): "host" | "home" | undefined {
  if (rec.status === "called") {
    return now >= rec.at - TOURNAMENT_SETOFF_DAYS * dayTicks ? "host" : undefined;
  }
  return now < (rec.closed ?? rec.at) + TOURNAMENT_RETURN_DAYS * dayTicks ? "home" : undefined;
}
