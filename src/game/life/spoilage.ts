// Lo que se pudre en cada casa (economy §1): una vez por día, la despensa del hogar y lo que lleva
// cada uno encima pierden lo que la curva de cada bien dice. Lo podrido sale del ledger hacia el
// sumidero `rotted` con su evento: la comida no desaparece sin rastro, y es lo que obliga a
// cosechar y a comerciar en vez de juntar para siempre.

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
  draftEvent,
  ENTITY,
  type GoodDef,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  ROTTED,
  spoilage,
} from "../../sim/index.ts";

export const SPOILAGE_PROCESS = "life.spoilage";

export interface SpoilageOptions {
  readonly goods: readonly GoodDef[];
  readonly clock: PlanetClock;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Los hogares con alguien vivo: de ahí salen los alcances del proceso. */
export function householdsOf(truth: ReadonlyWorldTruth): EntityRef[] {
  const homes = new Set<string>();
  for (const id of truth.ids(PERSON)) {
    if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const home = truth.get(PERSON, id)?.household;
    if (home !== undefined) homes.add(home);
  }
  return [...homes].sort().map((h) => h as unknown as EntityRef);
}

export function spoilageProcess(o: SpoilageOptions): ProcessDef {
  return {
    id: SPOILAGE_PROCESS,
    system: "life",
    scope: "household",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "physics",
    reads: [PERSON.name, ENTITY.name],
    writes: [],
    run(ctx) {
      const home = ctx.scope as unknown as HolderRef;
      const members = ctx.truth
        .ids(PERSON)
        .filter(
          (id) =>
            ctx.truth.get(PERSON, id)?.household === (ctx.scope as string) &&
            ctx.truth.get(ENTITY, id)?.endedAt === undefined,
        ) as AgentId[];
      const holders: HolderRef[] = [home, ...members.map((m) => m as unknown as HolderRef)];
      const days = Math.max(1, ctx.window) / o.clock.day;
      const transfers = holders.flatMap((h) =>
        spoilage(
          ctx.ledger?.holdings(holderAccount(h)) ?? [],
          o.goods,
          days,
          ctx.rng.fork("rot", holderAccount(h)),
        ).map((r) => ({
          unit: r.unit,
          from: holderAccount(h),
          to: externalAccount(ROTTED),
          amount: r.amount,
        })),
      );
      const first = members[0];
      if (transfers.length === 0 || first === undefined) return {};
      return {
        events: [
          {
            kind: "household.spoiled",
            actors: [],
            place: o.placeOf(ctx.truth, first),
            data: { household: ctx.scope, days },
            emissions: {},
            causes: [{ kind: "state", entity: ctx.scope as EntityRef, key: "spoilage" }],
          },
        ],
        postings: [{ event: draftEvent(0), transfers }],
      };
    },
  };
}
