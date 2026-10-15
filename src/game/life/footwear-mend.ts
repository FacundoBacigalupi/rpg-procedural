// Remendar o cambiar el calzado gastado (npc-b2b3b2b, crafts, economy): quien tiene el calzado
// gastado más allá de `WORN_AT` y está en la aldea lo hace arreglar un día de estos, pagando de su
// bolsa: remendar (barato, quita parte del desgaste) o, si ya está destrozado, comprar par nuevo
// (desgaste 0). Sin zapatero el pago sale por el ledger como cobre a `WAGES_SINK` (el cuero y el
// trabajo de uno de fuera de la simulación); con `npcCobbler` (npc-b2b3b2b3a) lo cobra el zapatero
// de la aldea (`cobbler.ts`): pone cuero del ledger con origen y la calidad del remiendo sale de su
// oficio, que mejora con cada arreglo. Quien no tiene con qué pagar sigue con el calzado como está.
// Opt-in (`LifeParts.npcFootwearMend`, con `npcFootwear`): apagado no hay proceso, RNG ni eventos.
// No toca al jugador (él decide lo suyo). Único escritor de `FOOTWEAR` fuera de `life.act`.

import {
  type AgentId,
  type EntityRef,
  externalAccount,
  type HolderRef,
  holderAccount,
  type PlaceRef,
  type PlanetClock,
} from "../../core/index.ts";
import {
  COPPER,
  draftEvent,
  ENTITY,
  type EventDraft,
  LOCATION,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  WAGES_SINK,
} from "../../sim/index.ts";
import {
  COBBLER,
  COBBLER_MIN_AGE,
  HIDES_SOURCE,
  LEATHER_SCRAP,
  LEATHER_UNIT,
  leatherFor,
  leatherToFetch,
  levelAfterJob,
  mendKeeps,
  startLevel,
} from "./cobbler.ts";
import { FOOTWEAR, WORN_AT } from "./footwear.ts";

export const FOOTWEAR_MEND_PROCESS = "life.footwear_mend";
export const FOOTWEAR_MENDED = "footwear.mended";
export const COBBLER_CHOSEN = "cobbler.chosen";
export const LEATHER_FETCHED = "cobbler.leather_fetched";

/** Chance diaria de que quien tiene el calzado gastado vaya a arreglarlo (sin calibrar). */
export const MEND_CHANCE = 0.3;
/** Desde qué desgaste ya no vale remendar: se compra par nuevo. */
export const REPLACE_AT = 0.9;
/** Cobre de un remiendo y de un par nuevo (con 40 monedas por persona al nacer la aldea; sin calibrar). */
export const MEND_COST = 2;
export const NEW_PAIR_COST = 8;
/** Qué parte del desgaste queda tras remendar (sin zapatero). */
export const MEND_KEEPS = 0.35;

/** Qué se hace con ese desgaste y cuánto cuesta, o null si todavía no hace falta. Puro. */
export function mendJob(wear: number): { kind: "mend" | "replace"; cost: number } | null {
  if (!(wear >= WORN_AT)) return null;
  return wear >= REPLACE_AT
    ? { kind: "replace", cost: NEW_PAIR_COST }
    : { kind: "mend", cost: MEND_COST };
}

/** El desgaste que queda tras el arreglo (con `keeps` la parte que deja un remiendo). Puro. */
export function wearAfterMend(
  wear: number,
  kind: "mend" | "replace",
  keeps: number = MEND_KEEPS,
): number {
  return kind === "replace" ? 0 : Math.round(wear * keeps * 1e6) / 1e6;
}

export interface FootwearMendOptions {
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Con `npcCobbler`: un zapatero de la aldea cobra, con su oficio y su cuero (en vez del sumidero). */
  readonly cobbler?: { readonly clock: PlanetClock };
}

export function footwearMendProcess(o: FootwearMendOptions): ProcessDef {
  return {
    id: FOOTWEAR_MEND_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: o.cobbler
      ? [FOOTWEAR.name, PERSON.name, ENTITY.name, LOCATION.name, COBBLER.name]
      : [FOOTWEAR.name, PERSON.name, ENTITY.name, LOCATION.name],
    writes: o.cobbler ? [FOOTWEAR.name, COBBLER.name] : [FOOTWEAR.name],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger) return {};
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const changes: StateChange[] = [];
      const alive = (who: AgentId): boolean =>
        ctx.truth.get(PERSON, who) !== undefined &&
        ctx.truth.get(ENTITY, who)?.endedAt === undefined;
      const inVillage = (who: AgentId): boolean =>
        alive(who) && ctx.truth.get(LOCATION, who)?.space !== undefined;
      // El zapatero se busca solo cuando alguien va a arreglar: el que ya lo es mientras viva (si
      // hoy no está en la aldea, nadie arregla nada hoy), o, si no hay ninguno vivo, el adulto de
      // menor tirada. `null`: no hay quién (sin la opción, o nadie en edad), y paga al sumidero.
      let shop: Shop | null | undefined;
      const findShop = (): Shop | null => {
        if (!o.cobbler) return null;
        for (const id of [...ctx.truth.ids(COBBLER)].sort()) {
          const c = id as AgentId;
          if (c === o.player || !alive(c)) continue;
          return {
            who: c,
            account: holderAccount(c as unknown as HolderRef),
            level: ctx.truth.get(COBBLER, c)?.level ?? 0,
            leather: ledger.balance(holderAccount(c as unknown as HolderRef), LEATHER_UNIT),
            present: inVillage(c),
          };
        }
        let best = Number.POSITIVE_INFINITY;
        let chosen: AgentId | undefined;
        for (const id of [...ctx.truth.ids(PERSON)].sort()) {
          const c = id as AgentId;
          if (c === o.player || !inVillage(c)) continue;
          const p = ctx.truth.get(PERSON, c);
          if (!p || (ctx.now - p.born) / o.cobbler.clock.year < COBBLER_MIN_AGE) continue;
          const u = ctx.rng.fork("cobbler", c).stream().float();
          if (u < best) {
            best = u;
            chosen = c;
          }
        }
        if (chosen === undefined) return null;
        const level = startLevel(best);
        events.push({
          kind: COBBLER_CHOSEN,
          actors: [chosen],
          place: o.placeOf(ctx.truth, chosen),
          data: { level },
          emissions: {},
          causes: [{ kind: "state", entity: chosen as unknown as EntityRef, key: PERSON.name }],
        });
        changes.push(setComponent(COBBLER, chosen, { level }));
        const account = holderAccount(chosen as unknown as HolderRef);
        return {
          who: chosen,
          account,
          level,
          leather: ledger.balance(account, LEATHER_UNIT),
          present: true,
        };
      };
      for (const id of [...ctx.truth.ids(FOOTWEAR)].sort()) {
        const who = id as AgentId;
        if (who === o.player) continue;
        // Solo se arregla en la aldea (un espacio del sitio), no a campo traviesa.
        if (!inVillage(who)) continue;
        const wear = ctx.truth.get(FOOTWEAR, who)?.wear ?? 0;
        const job = mendJob(wear);
        if (!job) continue;
        if (!ctx.rng.fork("mend", who).stream().chance(MEND_CHANCE)) continue;
        const account = holderAccount(who as unknown as HolderRef);
        if (Math.floor(ledger.balance(account, COPPER)) < job.cost) continue;
        if (shop === undefined) shop = findShop();
        if (shop !== null && !shop.present) continue;
        const transfers: PostingDraft["transfers"][number][] = [];
        let keeps = MEND_KEEPS;
        const self = shop !== null && who === shop.who;
        const need = leatherFor(job.kind);
        if (shop !== null) {
          const fetch = leatherToFetch(shop.leather, need);
          if (fetch > 0) {
            events.push({
              kind: LEATHER_FETCHED,
              actors: [shop.who],
              place: o.placeOf(ctx.truth, shop.who),
              data: { grams: fetch },
              emissions: {},
              causes: [
                { kind: "state", entity: shop.who as unknown as EntityRef, key: COBBLER.name },
              ],
            });
            postings.push({
              event: draftEvent(events.length - 1),
              transfers: [
                {
                  unit: LEATHER_UNIT,
                  from: externalAccount(HIDES_SOURCE),
                  to: shop.account,
                  amount: fetch,
                },
              ],
            });
            shop.leather += fetch;
          }
          shop.leather -= need;
          keeps = mendKeeps(shop.level);
          transfers.push({
            unit: LEATHER_UNIT,
            from: shop.account,
            to: externalAccount(LEATHER_SCRAP),
            amount: need,
          });
          // El zapatero se arregla lo suyo sin cobrarse.
          if (!self) {
            transfers.push({ unit: COPPER, from: account, to: shop.account, amount: job.cost });
          }
        } else {
          transfers.push({
            unit: COPPER,
            from: account,
            to: externalAccount(WAGES_SINK),
            amount: job.cost,
          });
        }
        const after = wearAfterMend(wear, job.kind, keeps);
        events.push({
          kind: FOOTWEAR_MENDED,
          actors: shop !== null && !self ? [who, shop.who] : [who],
          place: o.placeOf(ctx.truth, who),
          data: {
            job: job.kind,
            from: wear,
            to: after,
            paid: self ? 0 : job.cost,
            ...(shop !== null ? { cobbler: shop.who, level: shop.level, leather: need } : {}),
          },
          emissions: {},
          causes: [{ kind: "state", entity: who as unknown as EntityRef, key: FOOTWEAR.name }],
        });
        postings.push({ event: draftEvent(events.length - 1), transfers });
        changes.push(setComponent(FOOTWEAR, who, { wear: after }));
        if (shop !== null) {
          shop.level = levelAfterJob(shop.level);
          changes.push(setComponent(COBBLER, shop.who, { level: shop.level }));
        }
      }
      return events.length === 0 ? {} : { events, postings, changes };
    },
  };
}

/** El zapatero del día mientras se asientan los arreglos (cuero y oficio aún sin asentar). */
interface Shop {
  readonly who: AgentId;
  readonly account: ReturnType<typeof holderAccount>;
  level: number;
  leather: number;
  readonly present: boolean;
}
