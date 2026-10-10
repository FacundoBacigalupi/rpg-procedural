// Chisme de otros moldes (information §4): lo que se cuenta de precios y de dónde hay cosas. Cada
// hora, quien comparte hex con otro puede contarle un rumor de molde (`price`, `location`) que
// cree; sale deformado de su boca (`distortMold`, con lo que recuerda y los lugares que conoce) y
// el oyente lo guarda con menos confianza (`MOLD_RUMORS`, tabla propia: no toca `RUMORS`). Lo que
// cada uno sabe de primera mano entra por `seeds` (quién vio qué precio o dónde hay qué): nada
// aparece de la nada. Opt-in. Sin eventos todavía; constantes sin calibrar.

import type { AgentId, CauseRef, EventId, PlaceRef, Tick } from "../../core/index.ts";
import {
  type BondDef,
  baseFor,
  type DimensionDef,
  distortMold,
  ENTITY,
  type EventDraft,
  type GoodDef,
  goodUnit,
  HEARD,
  LOCATION,
  MIND,
  type MoldRumor,
  moldUsefulness,
  PERSON,
  type PriceBeliefs,
  type ProcessDef,
  placeKey,
  RELATIONS,
  type ReadonlyWorldTruth,
  relationship,
  type StateChange,
  setComponent,
  table,
} from "../../sim/index.ts";

export const MOLD_GOSSIP_PROCESS = "life.gossip_molds";

/** Lo que alguien cree de oídas (o vio) de un molde, y de quién lo oyó. */
export interface HeardMold {
  readonly rumor: MoldRumor;
  /** 0-1: cuánto lo cree. */
  readonly confidence: number;
  /** Saltos desde quien lo vio (0 = lo vio). */
  readonly hops: number;
  readonly heardAt: Tick;
  readonly teller: AgentId | null;
  /** El evento del que viene el rumor (lo que vio el primero); cita de los `rumor.told`. */
  readonly cause?: EventId;
}
export interface MoldBook {
  readonly items: readonly HeardMold[];
  /** `clave|oyente` ya contados. */
  readonly told: readonly string[];
}
export const MOLD_RUMORS = table<MoldBook>("law.mold_rumors");

/** Algo que `agent` sabe de primera mano desde el principio (vio el precio, conoce el sitio). */
export interface MoldSeed {
  readonly agent: AgentId;
  readonly rumor: MoldRumor;
  /** El evento donde lo vio (origen del rumor); sin él, la causa es `seed`. */
  readonly cause?: EventId;
}

/** Cuánto pesa lo que cuenta alguien según la confianza (-1..1) que le tiene el oyente (sin calibrar). */
export function trustScale(trust: number): number {
  return Math.round(Math.min(1, Math.max(0.2, 0.6 + 0.4 * trust)) * 1e6) / 1e6;
}

export interface MoldGossipOptions {
  /**
   * Opt-in: cada molde contado emite un `rumor.told` con causa en el origen del rumor, y el oyente
   * lo cree según su confianza en quien cuenta (`RELATIONS`, `trustScale`). Apagado: sin eventos
   * ni lectura de relaciones.
   */
  readonly told?: {
    readonly dims: readonly DimensionDef[];
    readonly bonds: readonly BondDef[];
    readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  };
  readonly seeds?: readonly MoldSeed[];
  /** Probabilidad por hora de que alguien cuente algo a un vecino (sin calibrar). */
  readonly tellChance?: number;
  /**
   * Lo que cada uno oy� en conversaci�n (`HEARD`: vive/muri�) entra como rumor `attr` de o�das
   * (confianza `HEARD_CONFIDENCE`, un salto desde quien se lo dijo). Apagado por defecto.
   */
  readonly fromHeard?: boolean;
}

/** Cu�nto cree de entrada lo que le dijeron en una conversaci�n (sin calibrar). */
export const HEARD_CONFIDENCE = 0.6;

const KEPT_MOLDS = 24;
const KEPT_MOLD_TOLD = 48;

/** Qué cosa es el rumor (precio de un bien en un mercado, o dónde hay algo), sin el valor. */
export function moldKey(r: MoldRumor): string {
  if (r.mold === "attr") return `attr:${r.about}:${r.attr}`;
  return r.mold === "price" ? `price:${r.good}:${placeKey(r.market)}` : `location:${r.what}`;
}

/** Guarda `h` en el libro: si ya hay de esa cosa, se queda con la más creída (puro). */
export function keepMold(book: MoldBook | undefined, h: HeardMold): MoldBook {
  const key = moldKey(h.rumor);
  const items = [...(book?.items ?? [])];
  const i = items.findIndex((x) => moldKey(x.rumor) === key);
  const prev = i >= 0 ? items[i] : undefined;
  if (prev && prev.confidence > h.confidence) return book ?? { items, told: [] };
  if (i >= 0) items[i] = h;
  else items.push(h);
  return { items: items.slice(-KEPT_MOLDS), told: book?.told ?? [] };
}

export function moldGossipProcess(o: MoldGossipOptions): ProcessDef {
  const chance = o.tellChance ?? 0.25;
  return {
    id: MOLD_GOSSIP_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "decide",
    reads: [
      PERSON.name,
      ENTITY.name,
      LOCATION.name,
      MOLD_RUMORS.name,
      ...(o.fromHeard ? [HEARD.name] : []),
      ...(o.told ? [RELATIONS.name, MIND.name] : []),
    ],
    writes: [MOLD_RUMORS.name],
    run(ctx) {
      const truth = ctx.truth;
      const books = new Map<AgentId, MoldBook>();
      const dirty = new Set<AgentId>();
      const events: EventDraft[] = [];
      const bookOf = (id: AgentId) => books.get(id) ?? truth.get(MOLD_RUMORS, id);
      for (const s of o.seeds ?? []) {
        const b = bookOf(s.agent);
        if (b?.items.some((x) => moldKey(x.rumor) === moldKey(s.rumor))) continue;
        books.set(
          s.agent,
          keepMold(b, {
            rumor: s.rumor,
            confidence: 1,
            hops: 0,
            heardAt: ctx.now,
            teller: null,
            ...(s.cause ? { cause: s.cause } : {}),
          }),
        );
        dirty.add(s.agent);
      }
      if (o.fromHeard) {
        for (const id of truth.ids(PERSON).sort() as AgentId[]) {
          for (const c of truth.get(HEARD, id)?.claims ?? []) {
            const rumor: MoldRumor = {
              mold: "attr",
              about: c.about,
              attr: "alive",
              value: c.claim === "alive",
            };
            const b = bookOf(id);
            const prev = b?.items.find((x) => moldKey(x.rumor) === moldKey(rumor));
            if (prev && prev.heardAt >= c.at) continue;
            const rest: MoldBook | undefined = b && {
              items: b.items.filter((x) => moldKey(x.rumor) !== moldKey(rumor)),
              told: b.told,
            };
            books.set(
              id,
              keepMold(rest, {
                rumor,
                confidence: HEARD_CONFIDENCE,
                hops: 1,
                heardAt: c.at,
                teller: c.from,
              }),
            );
            dirty.add(id);
          }
        }
      }
      const groups = new Map<string, AgentId[]>();
      for (const id of truth.ids(PERSON).sort() as AgentId[]) {
        if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        const at = truth.get(LOCATION, id);
        if (!at) continue;
        const key = `${at.hex}:${at.space ?? ""}`;
        groups.set(key, [...(groups.get(key) ?? []), id]);
      }
      for (const here of groups.values()) {
        if (here.length < 2) continue;
        for (const teller of here) {
          const mine = bookOf(teller);
          if (!mine || mine.items.length === 0) continue;
          const rng = ctx.rng.fork("gossip_mold", teller);
          const listener = here[Math.floor(rng.float() * here.length)] ?? teller;
          if (listener === teller || rng.float() >= chance) continue;
          const fresh = mine.items.filter(
            (x) => !mine.told.includes(`${moldKey(x.rumor)}|${listener}`),
          );
          const h = fresh[Math.floor(rng.float() * fresh.length)];
          if (!h) continue;
          const nearby = mine.items.flatMap((x) =>
            x.rumor.mold === "location"
              ? [x.rumor.where]
              : x.rumor.mold === "price"
                ? [x.rumor.market]
                : [],
          );
          const out = distortMold(
            h.rumor,
            { memory: 0.4 + 0.6 * h.confidence, drama: 0.5, hurry: 0, nearby },
            rng.fork("distort"),
          );
          books.set(teller, {
            items: mine.items,
            told: [...mine.told, `${moldKey(h.rumor)}|${listener}`].slice(-KEPT_MOLD_TOLD),
          });
          const trust = o.told
            ? relationship(truth.get(RELATIONS, listener), teller, ctx.now, {
                dims: o.told.dims,
                bonds: o.told.bonds,
                schemaStrength: (s) => truth.get(MIND, listener)?.schemas[s]?.strength ?? 0,
              }).dims.trust
            : null;
          const confidence =
            Math.round(h.confidence * 0.8 * (trust === null ? 1 : trustScale(trust)) * 1e6) / 1e6;
          books.set(
            listener,
            keepMold(bookOf(listener), {
              rumor: out.rumor,
              confidence,
              hops: h.hops + 1,
              heardAt: ctx.now,
              teller,
              ...(h.cause ? { cause: h.cause } : {}),
            }),
          );
          if (o.told) {
            const causes: CauseRef[] = [
              h.cause ? { kind: "event", event: h.cause } : { kind: "seed" },
            ];
            events.push({
              kind: "rumor.told",
              actors: [teller, listener],
              place: o.told.placeOf(truth, teller),
              data: {
                mold: out.rumor.mold,
                key: moldKey(out.rumor),
                hops: h.hops + 1,
                credit: confidence,
              },
              emissions: {},
              causes,
            });
          }
          dirty.add(teller);
          dirty.add(listener);
        }
      }
      const changes: StateChange[] = [];
      for (const id of [...dirty].sort()) {
        const b = books.get(id);
        if (b) changes.push(setComponent(MOLD_RUMORS, id, b));
      }
      return events.length > 0 ? { changes, events } : { changes };
    },
  };
}

/** Cuánto suma al ánimo de una candidata lo que cree de oídas, por unidad de `moldUsefulness` (sin calibrar). */
export const MOLD_HINT_MOOD = 0.2;

export interface MoldHintOptions {
  /** Nombre con que el catálogo nombra un bien de `price` (por defecto, la clave tal cual). */
  readonly goodName?: (good: string) => string;
  /**
   * Precio creído por kilo (monedas) de un bien de `price` (ya con el nombre del catálogo) para
   * quien decide; `undefined` si no lo sabe. Con él, un `price` solo empuja si difiere de lo creído.
   */
  readonly believedPerKg?: (
    beliefs: PriceBeliefs | undefined,
    good: string,
    day: number,
  ) => number | undefined;
  /**
   * Opt-in: distingue comprar de vender. La candidata `trade` que trae `direction` solo se empuja
   * con un `price` del mismo lado (`buy`: oído más barato que lo creído; `sell`: más caro). Exige
   * `believedPerKg`; sin él, o con precio igual al creído, no filtra.
   */
  readonly bySide?: boolean;
}

/**
 * Valora un precio oído contra el creído (puro): `buy` si el oído es más bajo (conviene comprar
 * allá), `sell` si es más alto; `edge` 0-1 es la diferencia relativa (tope 1). Sin creído, 1.
 */
export function moldPriceEdge(
  heardPerKg: number,
  believedPerKg: number | undefined,
): { readonly side: "buy" | "sell" | "none"; readonly edge: number } {
  if (believedPerKg === undefined || !(believedPerKg > 0)) return { side: "none", edge: 1 };
  const rel = (heardPerKg - believedPerKg) / believedPerKg;
  const edge = Math.round(Math.min(1, Math.abs(rel)) * 1e6) / 1e6;
  return { side: rel < 0 ? "buy" : rel > 0 ? "sell" : "none", edge };
}

/** Opciones de `moldHints` para el catálogo real: `good` por id y creído desde `PRICE_BELIEFS` o la referencia. */
export function catalogMoldHints(goods: readonly GoodDef[]): MoldHintOptions {
  const byName = new Map(goods.map((g) => [g.name, g]));
  const byId = new Map(goods.map((g) => [g.id as string, g]));
  const find = (good: string) => byName.get(good) ?? byId.get(good);
  return {
    goodName: (good) => find(good)?.name ?? good,
    believedPerKg: (beliefs, good, day) => {
      const g = find(good);
      if (!g || g.priceCopperPerKg === undefined) return undefined;
      return baseFor(beliefs, goodUnit(g) as string, g.priceCopperPerKg, day);
    },
  };
}

/**
 * Empuje al ánimo de una candidata desde lo que el NPC cree de oídas (puro): ir (`move`) hacia
 * donde cree que hay algo (`location`, un lugar vago vale la mitad) y comerciar (`trade`) un bien
 * del que oyó el precio. Lo más útil de lo que aplique; 0 si nada.
 */
export function moldHintMood(
  c: {
    readonly verb: string;
    readonly target?: string;
    readonly id: string;
    /** Si la candidata compra o vende (solo la lee `bySide`). */
    readonly direction?: "buy" | "sell";
  },
  book: MoldBook | undefined,
  o: MoldHintOptions = {},
  priced?: { readonly beliefs: PriceBeliefs | undefined; readonly day: number },
): number {
  let best = 0;
  for (const h of book?.items ?? []) {
    const r = h.rumor;
    let hit = false;
    if (c.verb === "move" && r.mold === "location") {
      hit = r.where.kind === "place" && c.target === String(r.where.place);
    } else if (c.verb === "trade" && r.mold === "price") {
      hit = c.id.endsWith(`+${o.goodName ? o.goodName(r.good) : r.good}`);
    }
    if (!hit) continue;
    let use = moldUsefulness(r, h.confidence);
    if (r.mold === "price" && o.believedPerKg && priced) {
      const believed = o.believedPerKg(priced.beliefs, r.good, priced.day);
      const pe = moldPriceEdge(r.amount, believed);
      if (o.bySide && c.direction && pe.side !== "none" && pe.side !== c.direction) continue;
      use = Math.round(use * pe.edge * 1e6) / 1e6;
    }
    best = Math.max(best, use);
  }
  return Math.round(best * MOLD_HINT_MOOD * 1e6) / 1e6;
}
