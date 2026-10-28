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
  BUILDING,
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
  hideBuy,
  hidePrice,
  LEATHER_SCRAP,
  LEATHER_UNIT,
  leatherFor,
  leatherToFetch,
  levelAfterJob,
  localLeatherBuys,
  mendKeeps,
  startLevel,
} from "./cobbler.ts";
import { FOOTWEAR, WORN_AT } from "./footwear.ts";

export const FOOTWEAR_MEND_PROCESS = "life.footwear_mend";
export const FOOTWEAR_MENDED = "footwear.mended";
export const COBBLER_CHOSEN = "cobbler.chosen";
export const LEATHER_FETCHED = "cobbler.leather_fetched";
export const LEATHER_BOUGHT = "cobbler.leather_bought";

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
  readonly cobbler?: {
    readonly clock: PlanetClock;
    /** Con `npcCobblerHides`: la piel que junta la paga con su cobre (al sumidero) y sin cobre no arregla. */
    readonly hideCost?: boolean;
    /**
     * Con `npcCobblerLocalLeather` (livestock-hide-tan-sell): antes de traer cuero de fuera se lo
     * compra a las casas de la aldea que lo curtieron, con su cobre.
     */
    readonly localLeather?: boolean;
  };
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
      ? [
          FOOTWEAR.name,
          PERSON.name,
          ENTITY.name,
          LOCATION.name,
          COBBLER.name,
          ...(o.cobbler.localLeather ? [BUILDING.name] : []),
        ]
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
      // Lo que ya vendió cada casa hoy (el ledger no se mueve hasta el final del proceso).
      const sold = new Map<HolderRef, number>();
      const leatherOffers = (): { holder: HolderRef; grams: number }[] => {
        const seen = new Set<HolderRef>();
        const out: { holder: HolderRef; grams: number }[] = [];
        for (const id of [...ctx.truth.ids(BUILDING)].sort()) {
          const h = ctx.truth.get(BUILDING, id)?.household as HolderRef | undefined;
          if (h === undefined || seen.has(h) || ctx.truth.get(ENTITY, id)?.endedAt !== undefined) {
            continue;
          }
          seen.add(h);
          const grams =
            Math.floor(ledger.balance(holderAccount(h), LEATHER_UNIT)) - (sold.get(h) ?? 0);
          if (grams > 0) out.push({ holder: h, grams });
        }
        return out;
      };
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
            copper: Math.floor(ledger.balance(holderAccount(c as unknown as HolderRef), COPPER)),
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
          copper: Math.floor(ledger.balance(account, COPPER)),
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
          let fetch = leatherToFetch(shop.leather, need);
          let hideCopper = 0;
          if (o.cobbler?.hideCost) {
            const buy = hideBuy(shop.leather, need, shop.copper);
            // Sin cobre para la piel que falta, el zapatero no arregla hoy.
            if (buy === null) continue;
            fetch = buy.grams;
            hideCopper = buy.cost;
          }
          // Lo que tienen curtido las casas, primero; de fuera, solo lo que falta.
          const bought =
            fetch > 0 && o.cobbler?.localLeather
              ? localLeatherBuys(leatherOffers(), fetch, shop.copper)
              : [];
          if (bought.length > 0) {
            const local = bought.reduce((s, b) => s + b.grams, 0);
            const paid = bought.reduce((s, b) => s + b.cost, 0);
            let outside = fetch - local;
            if (o.cobbler?.hideCost && outside > 0) {
              // La compra en partes puede redondear un cobre de más: trae solo lo que falta.
              const purse = shop.copper - paid;
              if (hidePrice(outside) > purse) {
                const missing = Math.max(0, need - shop.leather - local);
                if (hidePrice(missing) > purse) continue;
                outside = missing;
              }
              hideCopper = hidePrice(outside);
            }
            for (const b of bought) {
              events.push({
                kind: LEATHER_BOUGHT,
                actors: [shop.who],
                place: o.placeOf(ctx.truth, shop.who),
                data: { from: b.holder, grams: b.grams, paid: b.cost },
                emissions: {},
                causes: [
                  { kind: "state", entity: shop.who as unknown as EntityRef, key: COBBLER.name },
                  { kind: "state", entity: b.holder as unknown as EntityRef, key: "leather" },
                ],
              });
              postings.push({
                event: draftEvent(events.length - 1),
                transfers: [
                  {
                    unit: LEATHER_UNIT,
                    from: holderAccount(b.holder),
                    to: shop.account,
                    amount: b.grams,
                  },
                  ...(b.cost > 0
                    ? [
                        {
                          unit: COPPER,
                          from: shop.account,
                          to: holderAccount(b.holder),
                          amount: b.cost,
                        },
                      ]
                    : []),
                ],
              });
              sold.set(b.holder, (sold.get(b.holder) ?? 0) + b.grams);
            }
            shop.leather += local;
            shop.copper -= paid;
            fetch = outside;
          }
          if (fetch > 0) {
            events.push({
              kind: LEATHER_FETCHED,
              actors: [shop.who],
              place: o.placeOf(ctx.truth, shop.who),
              data: { grams: fetch, ...(o.cobbler?.hideCost ? { paid: hideCopper } : {}) },
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
                ...(hideCopper > 0
                  ? [
                      {
                        unit: COPPER,
                        from: shop.account,
                        to: externalAccount(WAGES_SINK),
                        amount: hideCopper,
                      },
                    ]
                  : []),
              ],
            });
            shop.leather += fetch;
            shop.copper -= hideCopper;
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
  /** Cobre que tenía al empezar el día (sin contar lo que cobra hoy). */
  copper: number;
  readonly present: boolean;
}
