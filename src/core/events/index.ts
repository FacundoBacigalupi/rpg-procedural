// El registro de eventos (causality §1, ley 5; ARCHITECTURE §4.3): de solo agregado, en orden de
// id. Al entrar, cada evento se valida contra lo que ya está: tiene causas, las causas que son
// eventos ya existen y no son posteriores. Como un evento solo puede citar eventos anteriores, el
// grafo causal no tiene ciclos por construcción.
//
// Las causas que no son eventos (presiones, creencias, estado) las valida la sim, que conoce esas
// tablas (`sim/world`, invariantes). La compactación de eventos viejos llega con la historia
// (causality §8, deep-history).

import { type EventId, parseId } from "../ids/index.ts";
import type { CauseRef, Event, ZoneResolution } from "../types/index.ts";

export class EventLogError extends Error {
  override name = "EventLogError";
}

const RESOLUTIONS: ReadonlySet<ZoneResolution> = new Set([
  "scene",
  "local",
  "regional",
  "world",
  "history",
]);

export class EventLog {
  readonly #events: Event[] = [];
  readonly #byId = new Map<EventId, Event>();
  readonly #effects = new Map<EventId, EventId[]>();
  #last = 0;

  /** Rehace un registro guardado, validando todo de nuevo. */
  static from(events: Iterable<Event>): EventLog {
    const log = new EventLog();
    for (const e of events) log.append(e);
    return log;
  }

  get size(): number {
    return this.#events.length;
  }

  /** El número del último id: los nuevos tienen que ser mayores. */
  get lastNumber(): number {
    return this.#last;
  }

  has(id: EventId): boolean {
    return this.#byId.has(id);
  }

  get(id: EventId): Event | undefined {
    return this.#byId.get(id);
  }

  /** Todos, en orden de id (que es el orden en que pasaron a la verdad). */
  all(): readonly Event[] {
    return this.#events;
  }

  append(event: Event): void {
    const problem = this.#check(event);
    if (problem) throw new EventLogError(`${event.id}: ${problem}`);
    const frozen = Object.freeze({ ...event, causes: Object.freeze([...event.causes]) });
    this.#events.push(frozen);
    this.#byId.set(event.id, frozen);
    this.#last = parseId(event.id)?.n as number;
    for (const c of event.causes) {
      if (c.kind !== "event") continue;
      const list = this.#effects.get(c.event);
      if (list) {
        if (list.at(-1) !== event.id) list.push(event.id);
      } else this.#effects.set(c.event, [event.id]);
    }
  }

  /** Los eventos que citan a `id` como causa, en orden. */
  effectsOf(id: EventId): readonly EventId[] {
    return this.#effects.get(id) ?? [];
  }

  /** Los eventos que `id` cita como causa. */
  causesOf(id: EventId): EventId[] {
    const e = this.#byId.get(id);
    if (!e) throw new EventLogError(`evento desconocido: ${id}`);
    return eventCauses(e);
  }

  /**
   * El cono causal hacia atrás (`why` del inspector): todos los eventos de los que `id` depende,
   * hasta `depth` saltos, sin repetir, en orden de id.
   */
  ancestors(id: EventId, depth = Number.POSITIVE_INFINITY): EventId[] {
    return this.#walk(id, depth, (e) => this.causesOf(e));
  }

  /** El cono hacia adelante (`effects` del inspector). */
  descendants(id: EventId, depth = Number.POSITIVE_INFINITY): EventId[] {
    return this.#walk(id, depth, (e) => this.effectsOf(e));
  }

  #walk(id: EventId, depth: number, next: (id: EventId) => readonly EventId[]): EventId[] {
    if (!this.#byId.has(id)) throw new EventLogError(`evento desconocido: ${id}`);
    const seen = new Set<EventId>();
    let frontier = [id];
    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const nextFrontier: EventId[] = [];
      for (const e of frontier) {
        for (const n of next(e)) {
          if (seen.has(n)) continue;
          seen.add(n);
          nextFrontier.push(n);
        }
      }
      frontier = nextFrontier;
    }
    return [...seen].sort(byNumber);
  }

  #check(e: Event): string | undefined {
    const parsed = parseId(e.id);
    if (parsed?.kind !== "event") return "no es un id de evento";
    if (parsed.n <= this.#last) return `id fuera de orden (el último es event:${this.#last})`;
    if (!Number.isSafeInteger(e.tick)) return `tick inválido: ${e.tick}`;
    if (typeof e.kind !== "string" || e.kind.length === 0) return "sin tipo";
    if (!RESOLUTIONS.has(e.resolution)) return `resolución desconocida: ${e.resolution}`;
    for (const a of e.actors) if (!parseId(a)) return `actor mal formado: ${a}`;
    if (e.causes.length === 0) return "sin causas (las condiciones iniciales citan { kind: seed })";
    for (const c of e.causes) {
      const p = checkCause(c);
      if (p) return p;
      if (c.kind !== "event") continue;
      const cause = this.#byId.get(c.event);
      if (!cause) return `cita a ${c.event}, que no está en el registro`;
      if (cause.tick > e.tick) return `cita a ${c.event}, posterior (${cause.tick} > ${e.tick})`;
    }
    return undefined;
  }
}

function checkCause(c: CauseRef): string | undefined {
  if (
    c.kind !== "seed" &&
    c.weight !== undefined &&
    !(Number.isFinite(c.weight) && c.weight >= 0)
  ) {
    return `peso de causa inválido: ${c.weight}`;
  }
  switch (c.kind) {
    case "event":
      return parseId(c.event)?.kind === "event"
        ? undefined
        : `causa de evento mal formada: ${c.event}`;
    case "pressure":
      return parseId(c.pressure)?.kind === "pressure"
        ? undefined
        : `presión mal formada: ${c.pressure}`;
    case "belief":
      return parseId(c.belief)?.kind === "belief" && parseId(c.holder)
        ? undefined
        : `creencia mal formada: ${c.belief} de ${c.holder}`;
    case "state":
      return parseId(c.entity) && c.key.length > 0 ? undefined : `estado mal formado: ${c.entity}`;
    case "seed":
      return undefined;
    default:
      return `tipo de causa desconocido: ${(c as { kind: string }).kind}`;
  }
}

/** Las causas de un evento que son eventos, sin repetir, en el orden en que las cita. */
export function eventCauses(e: Event): EventId[] {
  const out: EventId[] = [];
  for (const c of e.causes) if (c.kind === "event" && !out.includes(c.event)) out.push(c.event);
  return out;
}

function byNumber(a: EventId, b: EventId): number {
  return (parseId(a)?.n as number) - (parseId(b)?.n as number);
}
