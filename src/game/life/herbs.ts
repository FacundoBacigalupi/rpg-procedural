// Las hierbas espirituales día a día (novel2-pills-herbs): en cada lugar de monte o en la sede, lo que
// hay en pie de cada hierba vive en la cuenta del lugar en el libro mayor (fuente `herb`) y de ahí lo
// toma `gather` cuando se nombra («junto hierbas espirituales»). Cada día rebrota hacia el techo que
// da el qi del lugar (`herbCapacity`): la reserva propia si la tiene (la sede), si no la del plano.
// Lo juntado ya no está; si se deja, vuelve.

import {
  type EntityRef,
  externalAccount,
  holderAccount,
  ledgerUnit,
  type PlaceId,
} from "../../core/index.ts";
import {
  CULTIVATION_LAW,
  draftEvent,
  HERB_STAND,
  type HerbDef,
  herbCapacity,
  PLACE,
  PLACE_QI,
  type ProcessDef,
  type ProcessResult,
  regrowHerb,
  setComponent,
} from "../../sim/index.ts";

export const HERBS_PROCESS = "cultivation.herbs";
/** Fuente del ledger de las hierbas espirituales (lo que crece del qi del lugar). */
export const HERB_SOURCE = "herb";
export const HERBS_GREW_EVENT = "cultivation.herbs_grew";

/** Dónde crecen: el monte y la sede. */
const HERB_PLACES: ReadonlySet<string> = new Set(["forest", "sect"]);

type Transfer = NonNullable<ProcessResult["postings"]>[number]["transfers"][number];
type Change = NonNullable<ProcessResult["changes"]>[number];
type Draft = NonNullable<ProcessResult["events"]>[number];

export function herbsProcess(o: {
  readonly dayTicks: number;
  readonly herbs: readonly HerbDef[];
}): ProcessDef {
  return {
    id: HERBS_PROCESS,
    system: "cultivation",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [CULTIVATION_LAW.name, PLACE.name, PLACE_QI.name, HERB_STAND.name],
    writes: [HERB_STAND.name],
    run(ctx) {
      const plane = ctx.truth.ids(CULTIVATION_LAW)[0];
      if (plane === undefined || !ctx.ledger || o.herbs.length === 0) return {};
      const days = Math.max(1, ctx.window) / o.dayTicks;
      const changes: Change[] = [];
      const events: Draft[] = [];
      const postings: NonNullable<ProcessResult["postings"]>[number][] = [];
      const places = ctx.truth
        .ids(PLACE)
        .filter((p) => HERB_PLACES.has(ctx.truth.get(PLACE, p)?.kind ?? ""))
        .sort();
      for (const p of places) {
        const own = ctx.truth.get(PLACE_QI, p);
        const pool = own ? p : plane;
        const qi = own ?? ctx.truth.get(PLACE_QI, plane);
        if (!qi) continue;
        const account = holderAccount({ kind: "place", place: p as unknown as PlaceId });
        const prev = ctx.truth.get(HERB_STAND, p);
        const standing: Record<string, number> = {};
        const transfers: Transfer[] = [];
        const grew: Record<string, number> = {};
        for (const herb of o.herbs) {
          const unit = ledgerUnit(`good:${herb.good}`);
          const cap = herbCapacity(herb, qi);
          const held = Math.floor(ctx.ledger.balance(account, unit));
          // Lo que había, menos lo que se juntó desde ayer (la cuenta bajó); la primera vez, el techo.
          const was = prev?.standing[herb.id];
          const now =
            was === undefined
              ? cap
              : regrowHerb(herb, Math.max(0, was - (Math.floor(was) - held)), cap, days);
          if (now <= 0 && held <= 0) continue;
          standing[herb.id] = now;
          const delta = Math.floor(now) - held;
          if (delta === 0) continue;
          grew[herb.id] = delta;
          transfers.push(
            delta > 0
              ? { unit, from: externalAccount(HERB_SOURCE), to: account, amount: delta }
              : { unit, from: account, to: externalAccount(HERB_SOURCE), amount: -delta },
          );
        }
        if (Object.keys(standing).length === 0 && !prev) continue;
        changes.push(setComponent(HERB_STAND, p, { standing, day: ctx.now }));
        if (transfers.length === 0) continue;
        const i = events.length;
        events.push({
          kind: HERBS_GREW_EVENT,
          actors: [],
          place: { kind: "place", place: p as unknown as PlaceId },
          data: { grew },
          emissions: {},
          causes: [{ kind: "state", entity: pool as EntityRef, key: PLACE_QI.name }],
        });
        postings.push({ event: draftEvent(i), transfers });
      }
      return {
        ...(changes.length > 0 ? { changes } : {}),
        ...(events.length > 0 ? { events, postings } : {}),
      };
    },
  };
}
