// Las ofrendas de la aldea como lotes con destino (spirits §6, §11; economy). Cada tanto los hogares
// que practican ponen parte de su despensa de grano en un lote: la ración a la tablilla
// (`offering` con `everyDays`) y la fiesta (`festival`, a la que va quien pertenece). El lote se
// reparte entre quemado (ceniza: sumidero `OFFERING_ASH`), enterrado (queda en el lugar), dado al hogar
// más necesitado y lo que la familia come después (no se mueve). Todo sale por el ledger con el
// evento `offering.made` como causa: nada desaparece sin pasar a una cuenta de destino. Opt-in
// (`LifeParts.offerings`): apagado no hay proceso, RNG ni eventos. No dice nada de quién la recibe
// del otro lado (casi nunca nadie, spirits §6) ni de la devoción en qi: eso es de otro ítem.

import {
  type AgentId,
  type EntityRef,
  externalAccount,
  type HolderRef,
  holderAccount,
  type LedgerAccount,
  type PlaceRef,
} from "../../core/index.ts";
import {
  type Affiliation,
  affiliationOf,
  draftEvent,
  ENTITY,
  type EventDraft,
  FESTIVAL_MIX,
  FESTIVAL_SHARE,
  type GoodDef,
  goodUnit,
  HEARTH_MIX,
  HEARTH_SHARE,
  OFFERING_ASH,
  type OfferingMix,
  offeredAmount,
  offeringLot,
  PERSON,
  type PostingDraft,
  type PracticeDef,
  type ProcessDef,
  poorestHousehold,
  practicesOfKind,
  RELIGIOUS_IDENTITY,
  type ReadonlyWorldTruth,
  villageReligion,
} from "../../sim/index.ts";
import { festivalOf } from "./festival.ts";

export const OFFERINGS_PROCESS = "life.offerings";
export const OFFERING_MADE = "offering.made";

export interface OfferingsOptions {
  readonly clock: { readonly day: number };
  readonly goods: readonly GoodDef[];
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Si a la ración le toca en el día `day` (cada `everyDays`, nunca el día 0). Puro. */
export function offeringDue(practice: PracticeDef, day: number): boolean {
  if (practice.kind !== "offering" || practice.everyDays === undefined) return false;
  const every = Math.max(1, Math.round(practice.everyDays));
  return day > 0 && day % every === 0;
}

/** La sinceridad del hogar: el cumplimiento medio de quienes lo componen (0 si ninguno practica). Puro. */
export function householdSincerity(affs: readonly (Affiliation | undefined)[]): number {
  const known = affs.filter((a): a is Affiliation => a !== undefined);
  if (known.length === 0) return 0;
  return known.reduce((s, a) => s + a.practice, 0) / known.length;
}

export function offeringsProcess(o: OfferingsOptions): ProcessDef {
  return {
    id: OFFERINGS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [PERSON.name, ENTITY.name, RELIGIOUS_IDENTITY.name],
    writes: [],
    run(ctx) {
      const ledger = ctx.ledger;
      const community = villageReligion(ctx.truth);
      if (!ledger || !community) return {};
      const day = Math.floor(ctx.now / o.clock.day);
      const offerings = practicesOfKind(community, "offering").filter(
        (p) => p.goods.length > 0 && offeringDue(p, day),
      );
      const festivals = practicesOfKind(community, "festival").filter(
        (p) =>
          p.goods.length > 0 &&
          p.everyDays !== undefined &&
          day > 0 &&
          day % Math.max(1, Math.round(p.everyDays)) === 0,
      );
      if (offerings.length === 0 && festivals.length === 0) return {};

      // Los hogares con sus miembros vivos, en orden canónico.
      const members = new Map<string, AgentId[]>();
      for (const id of [...ctx.truth.ids(PERSON)].sort()) {
        if (ctx.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        const p = ctx.truth.get(PERSON, id);
        if (!p) continue;
        const list = members.get(p.household) ?? [];
        list.push(id as AgentId);
        members.set(p.household, list);
      }
      const affOf = (who: AgentId) =>
        affiliationOf(ctx.truth.get(RELIGIOUS_IDENTITY, who), community.religion);

      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const make = (
        practice: PracticeDef,
        household: string,
        sincerity: number,
        share: number,
        mix: OfferingMix,
      ) => {
        const speaker = (members.get(household) as AgentId[])[0] as AgentId;
        for (const goodId of practice.goods) {
          const good = o.goods.find((g) => g.id === goodId);
          if (!good) continue;
          const unit = goodUnit(good);
          const stocks = new Map<string, number>();
          for (const h of members.keys()) {
            stocks.set(h, ledger.balance(holderAccount(h as unknown as HolderRef), unit));
          }
          const from = holderAccount(household as unknown as HolderRef);
          const total = offeredAmount(stocks.get(household) ?? 0, share, sincerity);
          if (total <= 0) continue;
          const poor = poorestHousehold(stocks, household);
          const place = o.placeOf(ctx.truth, speaker);
          const lot = offeringLot(unit, total, mix, {
            from,
            ash: externalAccount(OFFERING_ASH),
            buried: holderAccount(place as HolderRef),
            ...(poor !== undefined
              ? { poor: holderAccount(poor as unknown as HolderRef) as LedgerAccount }
              : {}),
          });
          const k = events.length;
          events.push({
            kind: OFFERING_MADE,
            actors: [speaker],
            place,
            data: {
              practice: practice.id,
              household,
              good: goodId,
              total: lot.total,
              parts: lot.parts,
              sincerity: Math.round(sincerity * 1000) / 1000,
            },
            emissions: {},
            causes: [
              {
                kind: "state",
                entity: household as unknown as EntityRef,
                key: `practice:${practice.id}`,
              },
            ],
          });
          if (lot.transfers.length > 0) {
            postings.push({ event: draftEvent(k), transfers: lot.transfers });
          }
        }
      };

      for (const practice of offerings) {
        for (const household of [...members.keys()].sort()) {
          const sincerity = householdSincerity((members.get(household) as AgentId[]).map(affOf));
          make(practice, household, sincerity, HEARTH_SHARE, HEARTH_MIX);
        }
      }
      for (const practice of festivals) {
        const people = [...members.values()].flat().map((id) => ({ id, aff: affOf(id) }));
        const fest = festivalOf(practice, day, people, ctx.rng);
        if (!fest) continue;
        const going = new Set(fest.attendees);
        for (const household of [...members.keys()].sort()) {
          const here = (members.get(household) as AgentId[]).filter((m) => going.has(m));
          if (here.length === 0) continue;
          make(
            practice,
            household,
            householdSincerity(here.map(affOf)),
            FESTIVAL_SHARE,
            FESTIVAL_MIX,
          );
        }
      }
      return events.length === 0 ? {} : { events, postings };
    },
  };
}
