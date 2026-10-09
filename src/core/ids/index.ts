// Ids de entidades (ARCHITECTURE §4.1): "agent:1042", con el tipo en el prefijo.
// No salen del RNG: son contadores por tipo, en el orden en que el scheduler crea las entidades,
// así agregar un sistema no corre los ids de otro.

export const ENTITY_KINDS = [
  "agent",
  "org",
  "household",
  "item",
  "lot",
  "place",
  "building",
  "work",
  "parcel",
  "settlement",
  "cell",
  "zone",
  "plane",
  "realm",
  "spirit",
  "text",
  "commitment",
  "case",
  "pressure",
  "belief",
  "memory",
  "event",
  "journey",
  "force",
  "scheme",
  "lineage",
  "trace",
  "pathogen",
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

declare const kindBrand: unique symbol;

/** Id de una entidad de tipo `K`. El número es un contador determinista por tipo, desde 1. */
export type Id<K extends EntityKind> = `${K}:${number}` & { readonly [kindBrand]: K };

export type AgentId = Id<"agent">; // toda persona, también el jugador; bestias y espíritus que deciden
export type OrgId = Id<"org">; // familias extensas, clanes, sectas, gremios, estados, bandas
export type HouseholdId = Id<"household">;
export type ItemId = Id<"item">; // objeto único con identidad
export type LotId = Id<"lot">; // bien a granel
export type PlaceId = Id<"place">; // lugar con nombre: claro, cueva, cruce, tramo de camino
export type BuildingId = Id<"building">;
export type WorkId = Id<"work">; // infraestructura: pozo, camino, puente, dique (settlements §8)
export type ParcelId = Id<"parcel">; // terreno con límites y derechos (property §3)
export type SettlementId = Id<"settlement">;
export type CellId = Id<"cell">; // celda hex de planet-gen
export type ZoneId = Id<"zone">;
export type PlaneId = Id<"plane">;
export type RealmId = Id<"realm">;
export type SpiritId = Id<"spirit">;
export type TextId = Id<"text">;
export type CommitmentId = Id<"commitment">;
export type CaseId = Id<"case">;
export type PressureId = Id<"pressure">;
export type BeliefId = Id<"belief">;
export type MemoryId = Id<"memory">;
export type EventId = Id<"event">;
export type JourneyId = Id<"journey">;
export type ForceId = Id<"force">;
export type SchemeId = Id<"scheme">;
export type LineageId = Id<"lineage">;
export type TraceId = Id<"trace">;
export type PathogenId = Id<"pathogen">; // un patógeno concreto, con origen (body-health §6)

/** Cualquier entidad; el tipo se lee del prefijo. */
export type EntityRef = Id<EntityKind>;

const kindSet: ReadonlySet<string> = new Set(ENTITY_KINDS);

export function isEntityKind(value: string): value is EntityKind {
  return kindSet.has(value);
}

export function makeId<K extends EntityKind>(kind: K, n: number): Id<K> {
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new RangeError(`número de id inválido para ${kind}: ${n}`);
  }
  return `${kind}:${n}` as Id<K>;
}

export interface ParsedId<K extends EntityKind = EntityKind> {
  readonly kind: K;
  readonly n: number;
}

/** Lee un id con forma canónica (`tipo:n`, sin ceros a la izquierda). Devuelve undefined si no lo es. */
export function parseId(value: string): ParsedId | undefined {
  const colon = value.indexOf(":");
  if (colon <= 0) return undefined;
  const kind = value.slice(0, colon);
  const digits = value.slice(colon + 1);
  if (!isEntityKind(kind) || !/^[1-9][0-9]*$/.test(digits)) return undefined;
  const n = Number(digits);
  if (!Number.isSafeInteger(n)) return undefined;
  return { kind, n };
}

export function isId<K extends EntityKind>(kind: K, value: string): value is Id<K> {
  return parseId(value)?.kind === kind;
}

export function kindOf<K extends EntityKind>(id: Id<K>): K {
  const parsed = parseId(id);
  if (!parsed) throw new TypeError(`id mal formado: ${id}`);
  return parsed.kind as K;
}

/** Orden canónico: por tipo (orden de código de los caracteres) y después por número. */
export function compareIds(a: EntityRef, b: EntityRef): number {
  const pa = parseId(a);
  const pb = parseId(b);
  if (!pa || !pb) throw new TypeError(`id mal formado: ${pa ? b : a}`);
  if (pa.kind !== pb.kind) return pa.kind < pb.kind ? -1 : 1;
  return pa.n - pb.n;
}

/** Comparación de strings por unidades de código, sin locale: igual en cualquier máquina. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Estado serializable de los contadores: el próximo número de cada tipo usado. */
export type IdCounterState = Partial<Record<EntityKind, number>>;

export class IdAllocator {
  readonly #next = new Map<EntityKind, number>();

  constructor(state: IdCounterState = {}) {
    for (const [kind, next] of Object.entries(state)) {
      if (!isEntityKind(kind)) throw new TypeError(`tipo de entidad desconocido: ${kind}`);
      if (!Number.isSafeInteger(next) || next < 1) {
        throw new RangeError(`contador inválido para ${kind}: ${next}`);
      }
      this.#next.set(kind, next);
    }
  }

  next<K extends EntityKind>(kind: K): Id<K> {
    const n = this.#next.get(kind) ?? 1;
    this.#next.set(kind, n + 1);
    return makeId(kind, n);
  }

  /**
   * Reparte ids a entidades creadas en paralelo (workers) en la fase de asentar: se ordenan las
   * claves de creación y se numera en ese orden, así el resultado no depende de qué worker terminó
   * primero (ARCHITECTURE §7.4). Las claves tienen que ser únicas y deterministas.
   */
  assignInOrder<K extends EntityKind>(kind: K, keys: readonly string[]): Map<string, Id<K>> {
    const sorted = [...keys].sort(compareStrings);
    const out = new Map<string, Id<K>>();
    for (const key of sorted) {
      if (out.has(key)) throw new Error(`clave de creación repetida: ${key}`);
      out.set(key, this.next(kind));
    }
    return out;
  }

  /** Copia ordenada por tipo para guardar y hashear. */
  state(): IdCounterState {
    const out: IdCounterState = {};
    for (const kind of [...this.#next.keys()].sort(compareStrings)) {
      out[kind] = this.#next.get(kind) as number;
    }
    return out;
  }
}
