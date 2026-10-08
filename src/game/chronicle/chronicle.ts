// La crónica final mínima (chronicle §3-§4, Fase 1): al morir el personaje se arma desde la
// verdad, sin el narrador. Epitafio, causa real de muerte con su cadena de eventos y capítulos
// cortados por los giros de la vida, elegidos por huella causal. Cada afirmación apunta a eventos
// que están en el registro (`sources`). "Lo que nunca supiste", el legado y el epílogo son de
// fases posteriores.

import { type AgentId, type Event, type EventId, parseId, type Tick } from "../../core/index.ts";
import { BODY_STATE, callName, type DeathCause, PERSON, PERSON_NAME } from "../../sim/index.ts";
import type { LifeWorld } from "../life/index.ts";
import { type ImportantPerson, importantPeople, type NeverKnewEntry, neverKnew } from "./people.ts";

/** Eventos del personaje que parten la vida en capítulos. */
const TURNING_KINDS: ReadonlySet<string> = new Set([
  "combat.fight",
  "body.collapsed",
  "body.wound_infected",
  "law.default",
]);

/** Cuántos capítulos como máximo y cuánto separa dos cortes. */
export const MAX_CHAPTERS = 5;
export const MIN_CHAPTER_DAYS = 3;
const MAX_PEOPLE = 3;

export interface ChronicleMarks {
  readonly mode: string;
  /** El jugador miró la verdad con el inspector (player-loop §11). */
  readonly inspected: boolean;
}

export interface DeathRecord {
  readonly cause: DeathCause | "unknown";
  readonly at: Tick;
  readonly event: EventId;
  /** Los eventos de los que depende la muerte, del más viejo al más nuevo. */
  readonly chain: readonly EventId[];
}

export interface ChapterSeed {
  /** Qué cortó el capítulo: el tipo del giro que lo cierra, o `death`. */
  readonly closedBy: string;
  readonly people: readonly AgentId[];
}

export interface ChronicleChapter {
  readonly span: { readonly from: Tick; readonly to: Tick };
  readonly title: ChapterSeed;
  readonly turningPoints: readonly EventId[];
}

export interface Chronicle {
  readonly subject: AgentId;
  readonly name: string;
  readonly born: Tick;
  readonly died: Tick;
  readonly entered: Tick;
  readonly marks: ChronicleMarks;
  readonly death: DeathRecord;
  readonly chapters: readonly ChronicleChapter[];
  /** Quienes más pesaron, por relación y por memoria (§4). */
  readonly people: readonly ImportantPerson[];
  /** Lo que el personaje creyó mal o nunca vio, contra la verdad (§5). */
  readonly neverKnew: readonly NeverKnewEntry[];
  /** Todo lo que la crónica afirma apunta a estos eventos. */
  readonly sources: readonly EventId[];
}

const byNumber = (a: EventId, b: EventId) => (parseId(a)?.n as number) - (parseId(b)?.n as number);

/** Arma la crónica de un personaje muerto. `entered` es el tick en que empezó la partida. */
export function buildChronicle(w: LifeWorld, entered: Tick, marks: ChronicleMarks): Chronicle {
  const me = w.player;
  const body = w.truth.get(BODY_STATE, me);
  const person = w.truth.get(PERSON, me);
  if (!person) throw new Error("el personaje no tiene persona");
  const died = w.log.all().find((e) => e.kind === "body.died" && e.actors.includes(me));
  if (!died) throw new Error("el personaje sigue vivo: no hay crónica todavía");

  const chain = w.log.ancestors(died.id);
  const cause = (died.data as { cause?: DeathCause } | null)?.cause ?? body?.death?.cause;
  const death: DeathRecord = {
    cause: cause ?? "unknown",
    at: died.tick,
    event: died.id,
    chain,
  };

  const mine = w.log.all().filter((e) => e.actors.includes(me) && e.id !== died.id);
  const chapters = chaptersOf(w, me, mine, entered, died);
  const people = importantPeople(w, me, died.tick);
  const unknown = neverKnew(w, me, people, died.tick);
  const cited = new Set<EventId>([
    died.id,
    ...chain,
    ...chapters.flatMap((c) => c.turningPoints),
    ...people.flatMap((p) => p.memories),
    ...unknown.map((u) => u.event),
  ]);
  const nameData = w.truth.get(PERSON_NAME, me);
  return {
    subject: me,
    name: (nameData && callName(nameData)) ?? "Sin nombre",
    born: person.born,
    died: died.tick,
    entered,
    marks,
    death,
    chapters,
    people,
    neverKnew: unknown,
    sources: [...cited].sort(byNumber),
  };
}

function chaptersOf(
  w: LifeWorld,
  me: AgentId,
  mine: readonly Event[],
  entered: Tick,
  died: Event,
): ChronicleChapter[] {
  // Huella causal: cuántos eventos descienden del giro (chronicle §4, §6).
  const weight = (e: Event) => 1 + w.log.descendants(e.id).length;
  const gap = MIN_CHAPTER_DAYS * w.clock.day;
  const candidates = mine
    .filter((e) => TURNING_KINDS.has(e.kind) && e.tick > entered && e.tick < died.tick)
    .map((e) => ({ e, w: weight(e) }))
    .sort((a, b) => b.w - a.w || byNumber(a.e.id, b.e.id));
  const cuts: Event[] = [];
  for (const { e } of candidates) {
    if (cuts.length >= MAX_CHAPTERS - 1) break;
    if (cuts.every((c) => Math.abs(c.tick - e.tick) >= gap)) cuts.push(e);
  }
  cuts.sort((a, b) => a.tick - b.tick || byNumber(a.id, b.id));

  const out: ChronicleChapter[] = [];
  let from = entered;
  const closers = [...cuts, died];
  for (const closer of closers) {
    const span = { from, to: closer.tick };
    const inside = mine.filter((e) => e.tick >= span.from && e.tick <= span.to);
    out.push({
      span,
      title: { closedBy: closer === died ? "death" : closer.kind, people: peopleIn(inside, me) },
      turningPoints: [closer.id],
    });
    from = closer.tick;
  }
  return out;
}

/** Quiénes más aparecieron junto al personaje en el tramo. */
function peopleIn(events: readonly Event[], me: AgentId): AgentId[] {
  const count = new Map<AgentId, number>();
  for (const e of events) {
    for (const a of e.actors) {
      if (a !== me && parseId(a)?.kind === "agent")
        count.set(a as AgentId, (count.get(a as AgentId) ?? 0) + 1);
    }
  }
  return [...count]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, MAX_PEOPLE)
    .map(([id]) => id);
}
