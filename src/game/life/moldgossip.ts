// Chisme de otros moldes (information §4): lo que se cuenta de precios y de dónde hay cosas. Cada
// hora, quien comparte hex con otro puede contarle un rumor de molde (`price`, `location`) que
// cree; sale deformado de su boca (`distortMold`, con lo que recuerda y los lugares que conoce) y
// el oyente lo guarda con menos confianza (`MOLD_RUMORS`, tabla propia: no toca `RUMORS`). Lo que
// cada uno sabe de primera mano entra por `seeds` (quién vio qué precio o dónde hay qué): nada
// aparece de la nada. Opt-in. Sin eventos todavía; constantes sin calibrar.

import type {
  AgentId,
  CauseRef,
  EventId,
  PlaceId,
  PlaceRef,
  PlanetClock,
  Tick,
} from "../../core/index.ts";
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
  PLACE,
  PRICE_BELIEFS,
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
import { glanceAcuity, lookAcuity } from "./looking.ts";
import { NEIGHBOR_STANDING, type NeighborStandings } from "./neighbors.ts";
import { TRADE_VIEW } from "./tradeview.ts";

export const MOLD_GOSSIP_PROCESS = "life.gossip_molds";

/** Cuánto de lo que no recuerda se infla un "apretado" a "en la ruina" al contarlo (sin calibrar). */
export const STANDING_INFLATE = 0.5;

/** El apuro de un hogar vecino como rumor `attr` (`standing`: "tight" | "broke"). */
export function standingRumor(home: string, standing: "tight" | "broke"): MoldRumor {
  return { mold: "attr", about: home, attr: "standing", value: standing };
}

/** Los rumores de apuro que `book` (lo que vio de primera mano) aporta, en orden por hogar (puro). */
export function standingRumorsOf(book: NeighborStandings | undefined): readonly MoldRumor[] {
  const out: MoldRumor[] = [];
  for (const home of Object.keys(book?.homes ?? {}).sort()) {
    const v = book?.homes[home];
    if (v) out.push(standingRumor(home, v.standing));
  }
  return out;
}

/**
 * Deforma al contarlo (puro): quien recuerda poco infla un apuro "tight" a "broke" si `roll`
 * (0-1) cae bajo `STANDING_INFLATE * (1 - memory)`. Cualquier otro rumor pasa igual.
 */
export function distortStanding(r: MoldRumor, memory: number, roll: number): MoldRumor {
  if (r.mold !== "attr" || r.attr !== "standing" || r.value !== "tight") return r;
  return roll < STANDING_INFLATE * (1 - memory) ? { ...r, value: "broke" } : r;
}

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
  /**
   * Opt-in: lo que cada uno vio del apuro de un hogar vecino (`NEIGHBOR_STANDING`) entra como
   * rumor `attr` `standing` de primera mano, y al contarlo se puede inflar (`distortStanding`).
   * Apagado: sin lectura de esa tabla ni cambios.
   */
  readonly neighborStanding?: boolean;
  /** Probabilidad por hora de que alguien cuente algo a un vecino (sin calibrar). */
  readonly tellChance?: number;
  /**
   * Lo que cada uno oy� en conversaci�n (`HEARD`: vive/muri�) entra como rumor `attr` de o�das
   * (confianza `HEARD_CONFIDENCE`, un salto desde quien se lo dijo). Apagado por defecto.
   */
  readonly fromHeard?: boolean;
  /**
   * Opt-in: el oficio que cada uno vio de otros hogares (`TRADE_VIEW`) entra como rumor `attr`
   * `trade` de primera mano (`about` = `household:<id>`), y al contarse puede confundirse con otro
   * oficio que el que cuenta conoce. Apagado: no lee `TRADE_VIEW`.
   */
  readonly fromTradeView?: { readonly clock: PlanetClock };
  /**
   * Opt-in: el precio que cada uno vio en el mercado (`PRICE_BELIEFS`, corrido por cada trato
   * visto) entra como rumor `price` de primera mano, con `market` donde lo vio (`marketOf`;
   * `undefined` = no se sabe dónde, no entra). Apagado: no lee `PRICE_BELIEFS`.
   */
  readonly fromPriceBeliefs?: {
    readonly clock: PlanetClock;
    readonly marketOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef | undefined;
  };
  /**
   * Opt-in: lo que alguien ve al mirar (`look`, evento con `lookAcuity`) entra como rumor
   * `location` de primera mano, con el evento como causa; si la agudeza no llega a `vagueBelow`
   * (0.5 por defecto) el lugar queda vago. `siteOf` dice qué sitio vio (`undefined` = ninguno).
   * Apagado: no mira eventos ni escribe nada.
   */
  readonly fromLooking?: {
    /** Sin `siteOf`, la vida real pone `lookSiteOf(aldea)`; el proceso solo no ve nada. */
    readonly siteOf?: (
      truth: ReadonlyWorldTruth,
      who: AgentId,
    ) => { readonly what: string; readonly where: PlaceRef } | undefined;
    readonly vagueBelow?: number;
  };
}

const LOOK_ORDER = ["water", "fields", "forest", "village"];

/**
 * Qué sitio ve quien mira desde donde está: dentro de un espacio (casa), la aldea; al aire libre,
 * el lugar (`PLACE`) que cubre su hex, con prioridad agua, campos, bosque, aldea. `undefined` si
 * ninguno lo cubre. Puro sobre la verdad.
 */
export function lookSiteOf(village: PlaceRef) {
  return (
    truth: ReadonlyWorldTruth,
    who: AgentId,
  ): { readonly what: string; readonly where: PlaceRef } | undefined => {
    const at = truth.get(LOCATION, who);
    if (!at) return undefined;
    if (at.space !== undefined) return { what: "village", where: village };
    let best: { what: string; rank: number; id: string } | undefined;
    for (const id of truth.ids(PLACE).sort()) {
      const p = truth.get(PLACE, id);
      if (!p || !(p.hexes as readonly number[]).includes(at.hex)) continue;
      const rank = LOOK_ORDER.indexOf(p.kind);
      if (rank < 0 || (best && best.rank <= rank)) continue;
      best = { what: p.kind, rank, id };
    }
    return best
      ? { what: best.what, where: { kind: "place", place: best.id as PlaceId } }
      : undefined;
  };
}

/** Cómo se nombra el hogar en un rumor de oficio. */
export const tradeAbout = (home: string): string => `household:${home}`;

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
      ...(o.fromLooking ? [PLACE.name] : []),
      ...(o.fromTradeView ? [TRADE_VIEW.name] : []),
      ...(o.fromPriceBeliefs ? [PRICE_BELIEFS.name] : []),
      ...(o.neighborStanding ? [NEIGHBOR_STANDING.name] : []),
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
      if (o.neighborStanding) {
        for (const id of truth.ids(PERSON).sort() as AgentId[]) {
          for (const rumor of standingRumorsOf(truth.get(NEIGHBOR_STANDING, id))) {
            const b = bookOf(id);
            const prev = b?.items.find((x) => moldKey(x.rumor) === moldKey(rumor));
            if (prev && prev.hops === 0 && JSON.stringify(prev.rumor) === JSON.stringify(rumor)) {
              continue;
            }
            const rest: MoldBook | undefined = b && {
              items: b.items.filter((x) => moldKey(x.rumor) !== moldKey(rumor)),
              told: b.told,
            };
            books.set(
              id,
              keepMold(rest, { rumor, confidence: 1, hops: 0, heardAt: ctx.now, teller: null }),
            );
            dirty.add(id);
          }
        }
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
      if (o.fromTradeView) {
        for (const id of truth.ids(PERSON).sort() as AgentId[]) {
          const view = truth.get(TRADE_VIEW, id);
          if (!view) continue;
          for (const home of Object.keys(view.homes).sort()) {
            const seen = view.homes[home];
            if (!seen) continue;
            const rumor: MoldRumor = {
              mold: "attr",
              about: tradeAbout(home),
              attr: "trade",
              value: seen.recipe,
            };
            const b = bookOf(id);
            const at = seen.day * o.fromTradeView.clock.day;
            const prev = b?.items.find((x) => moldKey(x.rumor) === moldKey(rumor));
            if (prev && prev.heardAt >= at && prev.hops === 0) continue;
            const rest: MoldBook | undefined = b && {
              items: b.items.filter((x) => moldKey(x.rumor) !== moldKey(rumor)),
              told: b.told,
            };
            books.set(
              id,
              keepMold(rest, { rumor, confidence: 1, hops: 0, heardAt: at, teller: null }),
            );
            dirty.add(id);
          }
        }
      }
      if (o.fromPriceBeliefs) {
        for (const id of truth.ids(PERSON).sort() as AgentId[]) {
          const beliefs = truth.get(PRICE_BELIEFS, id);
          if (!beliefs) continue;
          const market = o.fromPriceBeliefs.marketOf(truth, id);
          if (!market) continue;
          for (const unit of Object.keys(beliefs).sort()) {
            const seen = beliefs[unit];
            if (!seen) continue;
            const rumor: MoldRumor = {
              mold: "price",
              good: unit.startsWith("good:") ? unit.slice(5) : unit,
              market,
              amount: Math.round(seen.perKg * 1e6) / 1e6,
            };
            const b = bookOf(id);
            const at = seen.lastSeenDay * o.fromPriceBeliefs.clock.day;
            const prev = b?.items.find((x) => moldKey(x.rumor) === moldKey(rumor));
            if (prev && prev.heardAt >= at && prev.hops === 0) continue;
            const rest: MoldBook | undefined = b && {
              items: b.items.filter((x) => moldKey(x.rumor) !== moldKey(rumor)),
              told: b.told,
            };
            books.set(
              id,
              keepMold(rest, { rumor, confidence: 1, hops: 0, heardAt: at, teller: null }),
            );
            dirty.add(id);
          }
        }
      }
      if (o.fromLooking) {
        for (const e of ctx.recent) {
          const acuity = lookAcuity(e.data) ?? glanceAcuity(e.data);
          const who = e.actors[0] as AgentId | undefined;
          if (acuity === undefined || !who || !truth.get(PERSON, who)) continue;
          const site = o.fromLooking.siteOf?.(truth, who);
          if (!site) continue;
          const rumor: MoldRumor = {
            mold: "location",
            what: site.what,
            where: site.where,
            vague: acuity < (o.fromLooking.vagueBelow ?? 0.5),
          };
          const b = bookOf(who);
          const rest: MoldBook | undefined = b && {
            items: b.items.filter((x) => moldKey(x.rumor) !== moldKey(rumor)),
            told: b.told,
          };
          books.set(
            who,
            keepMold(rest, {
              rumor,
              confidence: 1,
              hops: 0,
              heardAt: e.tick,
              teller: null,
              cause: e.id as EventId,
            }),
          );
          dirty.add(who);
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
          const memory = 0.4 + 0.6 * h.confidence;
          const out = distortMold(
            h.rumor,
            {
              memory,
              drama: 0.5,
              hurry: 0,
              nearby,
              ...(o.fromTradeView
                ? {
                    trades: mine.items.flatMap((x) =>
                      x.rumor.mold === "attr" && x.rumor.attr === "trade"
                        ? [String(x.rumor.value)]
                        : [],
                    ),
                  }
                : {}),
            },
            rng.fork("distort"),
          );
          const said = o.neighborStanding
            ? distortStanding(out.rumor, memory, rng.fork("standing").float())
            : out.rumor;
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
              rumor: said,
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
                mold: said.mold,
                key: moldKey(said),
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
  /**
   * Opt-in: un bien oído más barato que lo creído se ofrece como candidata `trade` de compra aunque
   * no esté en la despensa (`moldBuyGoods`). Exige `believedPerKg`.
   */
  readonly buyCandidates?: boolean;
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

/**
 * Bienes (nombre del catálogo) que el NPC oyó baratos frente a lo que cree (puro): candidatos a
 * comprar aunque no los tenga en la despensa. Exige `buyCandidates`, `believedPerKg` y `priced`;
 * sin ellos, nada. Orden fijo por nombre, sin repetir.
 */
export function moldBuyGoods(
  book: MoldBook | undefined,
  o: MoldHintOptions,
  priced: { readonly beliefs: PriceBeliefs | undefined; readonly day: number } | undefined,
): string[] {
  if (!o.buyCandidates || !o.believedPerKg || !priced) return [];
  const out = new Set<string>();
  for (const h of book?.items ?? []) {
    const r = h.rumor;
    if (r.mold !== "price") continue;
    const believed = o.believedPerKg(priced.beliefs, r.good, priced.day);
    if (believed === undefined) continue;
    if (moldPriceEdge(r.amount, believed).side === "buy")
      out.add(o.goodName ? o.goodName(r.good) : r.good);
  }
  return [...out].sort();
}
