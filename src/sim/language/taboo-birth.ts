// Tabúes que nacen en juego (language §7): el nombre de un muerto o de un soberano deja de decirse
// en su comunidad. A diferencia de los tabúes de la cultura (contenido fijo), este nace de un
// evento de la verdad (la muerte, la coronación): una fila por sujeto, con el evento de origen, la
// palabra vedada (los conceptos del nombre), el rodeo y cuántas veces se usó el rodeo. Con los
// años el rodeo se vuelve la palabra normal y la vieja se pierde (`lexicalized`); si casi nadie lo
// usó, el tabú se olvida (`lapsed`). Todo puro y determinista: no hay azar, depende de los hechos.

import type {
  EntityRef,
  EventId,
  EventLog,
  IdAllocator,
  PlaceRef,
  SettlementId,
  Tick,
} from "../../core/index.ts";
import { ENTITY, type ReadonlyWorldTruth, table, type WorldTruth } from "../world/index.ts";
import type { Language } from "./language.ts";
import type { TabooDef } from "./register.ts";

export const BORN_TABOO_KINDS = ["dead", "ruler"] as const;
export type BornTabooKind = (typeof BORN_TABOO_KINDS)[number];

export type BornTabooStatus = "active" | "lexicalized" | "lapsed";

export interface BornTaboo {
  /** Quién (el muerto, el soberano) cuyo nombre se veda. */
  readonly subject: EntityRef;
  readonly community: SettlementId;
  readonly language: string;
  readonly kind: BornTabooKind;
  /** La palabra vedada: los conceptos del nombre, en orden de lectura. */
  readonly word: readonly string[];
  /** El rodeo, también como conceptos de la lengua. */
  readonly circumlocution: readonly string[];
  /** 0-1: lo grave al nacer; se apaga con los años (`bornTabooSeverity`). */
  readonly severity: number;
  readonly bornAt: Tick;
  /** Veces que alguien dio el rodeo en vez de la palabra. */
  readonly uses: number;
  readonly status: BornTabooStatus;
  readonly settledAt?: Tick;
  /** El hecho que lo hizo nacer (la muerte) y el evento que lo declaró. */
  readonly causeEvent: EventId;
  readonly originEventId: EventId;
}

export const BORN_TABOO = table<BornTaboo>("language.born_taboo");

const DAY = 86_400;
const YEAR = 365 * DAY;
/** Años desde el nacimiento del tabú a partir de los cuales el rodeo puede volverse la palabra (sin calibrar). */
export const LEXICALIZE_MIN_YEARS = 20;
/** Veces que hay que haber dado el rodeo para que se vuelva palabra normal (sin calibrar). */
export const LEXICALIZE_USES = 40;
/** Años después de los cuales un tabú que casi nadie sostuvo se olvida (sin calibrar). */
export const LAPSE_YEARS = 60;
/** Cuánta severidad queda al llegar a `LAPSE_YEARS` (decae lineal, sin calibrar). */
export const SEVERITY_FLOOR = 0.1;

export interface DeclareBornTabooInput {
  readonly subject: EntityRef;
  readonly community: SettlementId;
  readonly language: string;
  readonly kind: BornTabooKind;
  readonly word: readonly string[];
  readonly circumlocution: readonly string[];
  readonly severity: number;
  readonly now: Tick;
  readonly place: PlaceRef;
  /** El evento que lo causa (la muerte, la coronación). */
  readonly causeEvent: EventId;
}

/** El primer rodeo cuyos conceptos existen todos en la lengua (los candidatos van en orden de preferencia). */
export function pickCircumlocution(
  language: Language,
  candidates: readonly (readonly string[])[],
): readonly string[] | undefined {
  return candidates.find((c) => c.length > 0 && c.every((x) => language.concepts.has(x)));
}

/** Declara el tabú: una fila por sujeto y comunidad, con evento de origen que cuelga del hecho. */
export function declareBornTaboo(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  input: DeclareBornTabooInput,
): BornTaboo {
  if (!truth.has(ENTITY, input.subject)) {
    throw new RangeError(`el tabú nace de alguien sin ficha: ${input.subject}`);
  }
  if (input.word.length === 0 || input.circumlocution.length === 0) {
    throw new RangeError("un tabú necesita palabra y rodeo");
  }
  const existing = truth.get(BORN_TABOO, input.subject);
  if (existing) return existing;
  const event = ids.next("event");
  log.append({
    id: event,
    tick: input.now,
    kind: "language.taboo_born",
    actors: [],
    place: input.place,
    data: { subject: input.subject, kind: input.kind, word: [...input.word] },
    emissions: null,
    causes: [{ kind: "event", event: input.causeEvent }],
    resolution: "local",
  });
  const row: BornTaboo = {
    subject: input.subject,
    community: input.community,
    language: input.language,
    kind: input.kind,
    word: input.word,
    circumlocution: input.circumlocution,
    severity: Math.max(0, Math.min(1, input.severity)),
    bornAt: input.now,
    uses: 0,
    status: "active",
    causeEvent: input.causeEvent,
    originEventId: event,
  };
  truth.set(BORN_TABOO, input.subject, row);
  return row;
}

/** La severidad que le queda con los años: baja lineal hasta `SEVERITY_FLOOR` al llegar a `LAPSE_YEARS`. */
export function bornTabooSeverity(row: BornTaboo, now: Tick): number {
  if (row.status !== "active") return 0;
  const t = Math.min(1, Math.max(0, (now - row.bornAt) / (LAPSE_YEARS * YEAR)));
  return row.severity * (1 - t * (1 - SEVERITY_FLOOR));
}

/** Los tabúes vivos de una comunidad como `TabooDef`, para `speakWord`/`tabooOffense`/`speechForm`. */
export function bornTabooDefs(
  truth: ReadonlyWorldTruth,
  community: SettlementId,
  culture: string,
  now: Tick,
): TabooDef[] {
  const out: TabooDef[] = [];
  for (const id of truth.ids(BORN_TABOO)) {
    const row = truth.get(BORN_TABOO, id);
    if (!row || row.community !== community || row.status !== "active") continue;
    const severity = bornTabooSeverity(row, now);
    if (severity <= 0) continue;
    out.push({
      id: `born.${row.subject}`,
      name: row.kind === "dead" ? "nombre de un muerto" : "nombre de un soberano",
      culture,
      kind: row.kind,
      concepts: [...row.word],
      circumlocution: [...row.circumlocution],
      severity,
      reason: `nació del evento ${row.causeEvent}`,
    });
  }
  return out;
}

/** Alguien dio el rodeo en vez de la palabra: cuenta para que se vuelva normal. */
export function noteCircumlocution(truth: WorldTruth, subject: EntityRef, times = 1): void {
  const row = truth.get(BORN_TABOO, subject);
  if (!row || row.status !== "active" || times <= 0) return;
  truth.set(BORN_TABOO, subject, { ...row, uses: row.uses + Math.floor(times) });
}

/** En qué se vuelve un tabú vivo hoy (`lexicalized`, `lapsed`), o `undefined` si sigue como está. */
export function bornTabooVerdict(row: BornTaboo, now: Tick): BornTabooStatus | undefined {
  if (row.status !== "active") return undefined;
  const age = now - row.bornAt;
  if (age >= LEXICALIZE_MIN_YEARS * YEAR && row.uses >= LEXICALIZE_USES) return "lexicalized";
  if (age >= LAPSE_YEARS * YEAR) return "lapsed";
  return undefined;
}

/**
 * Pasa el tiempo sobre los tabúes nacidos: el que se sostuvo (años y usos del rodeo) se vuelve
 * palabra normal y el viejo nombre se pierde; el que casi nadie sostuvo se olvida. Cada cierre es
 * un evento con causa en el que declaró el tabú. Devuelve los ids de sujeto que cambiaron.
 */
export function settleBornTaboos(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  now: Tick,
  placeOf: (community: SettlementId) => PlaceRef,
): EntityRef[] {
  const changed: EntityRef[] = [];
  for (const id of truth.ids(BORN_TABOO)) {
    const row = truth.get(BORN_TABOO, id);
    if (!row || row.status !== "active") continue;
    const status = bornTabooVerdict(row, now);
    if (!status) continue;
    log.append({
      id: ids.next("event"),
      tick: now,
      kind: status === "lexicalized" ? "language.taboo_lexicalized" : "language.taboo_lapsed",
      actors: [],
      place: placeOf(row.community),
      data: { subject: row.subject, word: [...row.word], circumlocution: [...row.circumlocution] },
      emissions: null,
      causes: [{ kind: "event", event: row.originEventId }],
      resolution: "local",
    });
    truth.set(BORN_TABOO, id, { ...row, status, settledAt: now });
    changed.push(id);
  }
  return changed;
}

export interface CommunityWord {
  readonly text: string;
  /** `lexicalized`: el rodeo ya es la palabra de todos; `plain`: la palabra de siempre. */
  readonly via: "lexicalized" | "plain";
}

/**
 * Cómo dice la comunidad hoy esta palabra: si su rodeo ya se volvió la palabra normal, sale el
 * rodeo (el nombre viejo se perdió); si no, la de siempre. No mide ofensa: los tabúes todavía
 * activos van por `bornTabooDefs` y `speakWord`.
 */
export function communityWord(
  language: Language,
  truth: ReadonlyWorldTruth,
  community: SettlementId,
  concepts: readonly string[],
): CommunityWord {
  for (const id of truth.ids(BORN_TABOO)) {
    const row = truth.get(BORN_TABOO, id);
    if (!row || row.community !== community || row.status !== "lexicalized") continue;
    if (row.word.length === concepts.length && row.word.every((w, i) => w === concepts[i])) {
      return { text: language.compound(row.circumlocution).text, via: "lexicalized" };
    }
  }
  return { text: language.compound(concepts).text, via: "plain" };
}
