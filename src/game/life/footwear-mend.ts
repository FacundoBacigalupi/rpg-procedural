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
      const inVillage = (who: AgentId): boolean =>
        ctx.truth.get(PERSON, who) !== undefined &&
        ctx.truth.get(ENTITY, who)?.endedAt === undefined &&
        ctx.truth.get(LOCATION, who)?.space !== undefined;
      // El zapatero: el que ya lo es y sigue en la aldea, o (si no hay) el adulto de menor tirada.
      let cobbler: AgentId | undefined;
      let level = 0;
      if (o.cobbler) {
        for (const id of [...ctx.truth.ids(COBBLER)].sort()) {
          const c = id as AgentId;
          if (c !== o.player && inVillage(c)) {
            cobbler = c;
            level = ctx.truth.get(COBBLER, c)?.level ?? 0;
            break;
          }
        }
        if (cobbler === undefined) {
          let best = Number.POSITIVE_INFINITY;
          for (const id of [...ctx.truth.ids(PERSON)].sort()) {
            const c = id as AgentId;
            if (c === o.player || !inVillage(c)) continue;
            const p = ctx.truth.get(PERSON, c);
            if (!p || (ctx.now - p.born) / o.cobbler.clock.year < COBBLER_MIN_AGE) continue;
            const u = ctx.rng.fork("cobbler", c).stream().float();
            if (u < best) {
              best = u;
              cobbler = c;
            }
          }
          if (cobbler !== undefined) {
            level = startLevel(best);
            events.push({
              kind: COBBLER_CHOSEN,
              actors: [cobbler],
              place: o.placeOf(ctx.truth, cobbler),
              data: { level },
              emissions: {},
              causes: [
                { kind: "state", entity: cobbler as unknown as EntityRef, key: PERSON.name },
              ],
            });
            changes.push(setComponent(COBBLER, cobbler, { level }));
          }
        }
      }
      const shop =
        cobbler === undefined ? undefined : holderAccount(cobbler as unknown as HolderRef);
      // El cuero del zapatero a medida que se asientan los arreglos de hoy.
      let leather = shop === undefined ? 0 : ledger.balance(shop, LEATHER_UNIT);
      for (const id of [...ctx.truth.ids(FOOTWEAR)].sort()) {
        const who = id as AgentId;
        if (who === o.player) continue;
        if (ctx.truth.get(PERSON, who) === undefined) continue;
        if (ctx.truth.get(ENTITY, who)?.endedAt !== undefined) continue;
        // Solo se arregla en la aldea (un espacio del sitio), no a campo traviesa.
        if (ctx.truth.get(LOCATION, who)?.space === undefined) continue;
        const wear = ctx.truth.get(FOOTWEAR, who)?.wear ?? 0;
        const job = mendJob(wear);
        if (!job) continue;
        if (!ctx.rng.fork("mend", who).stream().chance(MEND_CHANCE)) continue;
        const account = holderAccount(who as unknown as HolderRef);
        if (Math.floor(ledger.balance(account, COPPER)) < job.cost) continue;
        const transfers: PostingDraft["transfers"][number][] = [];
        let keeps = MEND_KEEPS;
        const self = cobbler !== undefined && who === cobbler;
        if (cobbler !== undefined && shop !== undefined) {
          const need = leatherFor(job.kind);
          const fetch = leatherToFetch(leather, need);
          if (fetch > 0) {
            events.push({
              kind: LEATHER_FETCHED,
              actors: [cobbler],
              place: o.placeOf(ctx.truth, cobbler),
              data: { grams: fetch },
              emissions: {},
              causes: [
                { kind: "state", entity: cobbler as unknown as EntityRef, key: COBBLER.name },
              ],
            });
            postings.push({
              event: draftEvent(events.length - 1),
              transfers: [
                {
                  unit: LEATHER_UNIT,
                  from: externalAccount(HIDES_SOURCE),
                  to: shop,
                  amount: fetch,
                },
              ],
            });
            leather += fetch;
          }
          leather -= need;
          keeps = mendKeeps(level);
          transfers.push({
            unit: LEATHER_UNIT,
            from: shop,
            to: externalAccount(LEATHER_SCRAP),
            amount: need,
          });
          // El zapatero se arregla lo suyo sin cobrarse.
          if (!self) transfers.push({ unit: COPPER, from: account, to: shop, amount: job.cost });
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
          actors: cobbler !== undefined && !self ? [who, cobbler] : [who],
          place: o.placeOf(ctx.truth, who),
          data: {
            job: job.kind,
            from: wear,
            to: after,
            paid: self ? 0 : job.cost,
            ...(cobbler !== undefined ? { cobbler, level, leather: leatherFor(job.kind) } : {}),
          },
          emissions: {},
          causes: [{ kind: "state", entity: who as unknown as EntityRef, key: FOOTWEAR.name }],
        });
        postings.push({ event: draftEvent(events.length - 1), transfers });
        changes.push(setComponent(FOOTWEAR, who, { wear: after }));
        if (cobbler !== undefined) {
          level = levelAfterJob(level);
          changes.push(setComponent(COBBLER, cobbler, { level }));
        }
      }
      return events.length === 0 ? {} : { events, postings, changes };
    },
  };
}
