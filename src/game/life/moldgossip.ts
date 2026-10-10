// Chisme de otros moldes (information §4): lo que se cuenta de precios y de dónde hay cosas. Cada
// hora, quien comparte hex con otro puede contarle un rumor de molde (`price`, `location`) que
// cree; sale deformado de su boca (`distortMold`, con lo que recuerda y los lugares que conoce) y
// el oyente lo guarda con menos confianza (`MOLD_RUMORS`, tabla propia: no toca `RUMORS`). Lo que
// cada uno sabe de primera mano entra por `seeds` (quién vio qué precio o dónde hay qué): nada
// aparece de la nada. Opt-in. Sin eventos todavía; constantes sin calibrar.

import type { AgentId, Tick } from "../../core/index.ts";
import {
  distortMold,
  ENTITY,
  LOCATION,
  HEARD,
  type MoldRumor,
  PERSON,
  type ProcessDef,
  placeKey,
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
}

export interface MoldGossipOptions {
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
export const HEARD_CONFIDENCE = 0.6

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
    ],
    writes: [MOLD_RUMORS.name],
    run(ctx) {
      const truth = ctx.truth;
      const books = new Map<AgentId, MoldBook>();
      const dirty = new Set<AgentId>();
      const bookOf = (id: AgentId) => books.get(id) ?? truth.get(MOLD_RUMORS, id);
      for (const s of o.seeds ?? []) {
        const b = bookOf(s.agent);
        if (b?.items.some((x) => moldKey(x.rumor) === moldKey(s.rumor))) continue;
        books.set(
          s.agent,
          keepMold(b, { rumor: s.rumor, confidence: 1, hops: 0, heardAt: ctx.now, teller: null }),
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
          books.set(
            listener,
            keepMold(bookOf(listener), {
              rumor: out.rumor,
              confidence: Math.round(h.confidence * 0.8 * 1e6) / 1e6,
              hops: h.hops + 1,
              heardAt: ctx.now,
              teller,
            }),
          );
          dirty.add(teller);
          dirty.add(listener);
        }
      }
      const changes: StateChange[] = [];
      for (const id of [...dirty].sort()) {
        const b = books.get(id);
        if (b) changes.push(setComponent(MOLD_RUMORS, id, b));
      }
      return { changes };
    },
  };
}
