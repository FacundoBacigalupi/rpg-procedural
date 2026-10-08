// Pedir fiado por hambre (causality §9): la descarga real de la presión de hambre de un hogar.
// Una vez por día, si la despensa de un hogar está mal, la probabilidad sale de la curva de la
// presión y, si toca, alguien del hogar le pide comida a un vecino que le sobra, que no lo tiene
// por mal pagador y al que no le debe ya el tope. El vecino le pasa la comida de su despensa a la
// del hogar (conservación) y el evento cita la presión; de ahí el `creditProcess` abre la deuda.
// Cuando el hogar vuelve a tener de sobra, devuelve (`repayProcess`): el pago es el evento que
// descuenta la deuda y, si no devuelve, el vencimiento y la fama hacen el resto (credit.ts).

import {
  type AgentId,
  type EntityRef,
  type HolderRef,
  holderAccount,
  type LedgerUnit,
  type PlaceRef,
} from "../../core/index.ts";
import {
  CREDIT_LIMIT_GRAMS,
  citePressure,
  draftEvent,
  ENTITY,
  type FoodDef,
  GIFT_GRAMS,
  KNOWN_DEEDS,
  PERSON,
  PRESSURE,
  type PressureCurve,
  type ProcessDef,
  RESERVE_GRAMS_PER_MEMBER,
  type ReadonlyLedger,
  type ReadonlyWorldTruth,
  readPressures,
  withHazards,
  worstDeed,
} from "../../sim/index.ts";
import { creditRows, debtsTo } from "./credit.ts";
import { BORROW_PROCESS, householdHungerSource } from "./pressures.ts";
import { householdsOf } from "./spoilage.ts";

export { BORROW_PROCESS };
export const REPAY_PROCESS = "life.repay";

/** Con menos hambre que esto el hogar devuelve lo que debe (lo que le sobra alcanza). */
const REPAY_BELOW = 0.3;

export interface BorrowOptions {
  readonly foods: readonly FoodDef[];
  readonly curves: readonly PressureCurve[];
  /** El hogar del jugador queda afuera: lo que hace su personaje lo decide él. */
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

function membersOf(truth: ReadonlyWorldTruth, home: string): AgentId[] {
  return truth
    .ids(PERSON)
    .filter(
      (id) =>
        truth.get(PERSON, id)?.household === home && truth.get(ENTITY, id)?.endedAt === undefined,
    )
    .sort() as AgentId[];
}

/** El gramo de cada comida que guarda la despensa del hogar, de más a menos. */
function stock(
  ledger: ReadonlyLedger,
  home: string,
  kcal: ReadonlyMap<LedgerUnit, number>,
): { unit: LedgerUnit; grams: number }[] {
  return ledger
    .holdings(holderAccount(home as unknown as HolderRef))
    .filter((h) => (kcal.get(h.unit) ?? 0) > 0 && h.amount > 0)
    .map((h) => ({ unit: h.unit, grams: h.amount }))
    .sort((a, b) => b.grams - a.grams || (a.unit < b.unit ? -1 : 1));
}

export function borrowProcess(o: BorrowOptions): ProcessDef {
  const kcal = new Map<LedgerUnit, number>(
    o.foods.map((f) => [`good:${f.id}` as LedgerUnit, f.kcalPerGram]),
  );
  return {
    id: BORROW_PROCESS,
    system: "life",
    scope: "household",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "act",
    reads: [PERSON.name, ENTITY.name, PRESSURE.name, KNOWN_DEEDS.name],
    writes: [ENTITY.name, PRESSURE.name],
    run(ctx) {
      const ledger = ctx.ledger;
      const home = ctx.scope as string;
      const mine = membersOf(ctx.truth, home);
      const borrower = mine[0];
      if (!ledger || !borrower || mine.includes(o.player)) return {};
      const reading = withHazards(
        readPressures(
          [householdHungerSource(o.foods)],
          { truth: ctx.truth, ledger, now: ctx.now },
          {},
        ).filter((p) => p.scope.ref === (ctx.scope as unknown as EntityRef)),
        o.curves,
        { truth: ctx.truth, now: ctx.now },
      )[0];
      const hazard = reading?.discharges.find((d) => d.process === BORROW_PROCESS)?.hazard ?? 0;
      if (!reading || hazard <= 0 || !ctx.rng.chance(hazard)) return {};

      // El vecino: de otro hogar, con de sobra, sin deuda al tope ni mala fama del que pide.
      const lenders = householdsOf(ctx.truth)
        .map((h) => h as unknown as string)
        .filter((h) => h !== home)
        .flatMap((h) => {
          const people = membersOf(ctx.truth, h);
          const lender = people.find((p) => p !== o.player);
          if (!lender || people.includes(o.player)) return [];
          if (worstDeed(ctx.truth.get(KNOWN_DEEDS, lender), borrower) !== null) return [];
          const owed = [...debtsTo(ctx.truth, borrower, lender).values()].reduce(
            (a, b) => a + b,
            0,
          );
          if (owed + GIFT_GRAMS > CREDIT_LIMIT_GRAMS) return [];
          const spare = stock(ledger, h, kcal).map((s) => ({
            ...s,
            grams: s.grams - people.length * RESERVE_GRAMS_PER_MEMBER,
          }));
          const best = spare.find((s) => s.grams >= GIFT_GRAMS);
          return best ? [{ home: h, lender, unit: best.unit, spare: best.grams }] : [];
        })
        .sort((a, b) => b.spare - a.spare || (a.lender < b.lender ? -1 : 1));
      const pick = lenders[0];
      if (!pick) return {};

      const asked = draftEvent(0);
      const cite = citePressure(
        ctx,
        { kind: "hunger", scope: reading.scope, value: reading.value },
        asked,
      );
      return {
        events: [
          {
            kind: "household.borrowed",
            actors: [pick.lender, borrower],
            place: o.placeOf(ctx.truth, borrower),
            data: { credit: { unit: pick.unit, grams: GIFT_GRAMS }, from: pick.home, to: home },
            emissions: { sight: 0.2 },
            causes: [cite.cause, { kind: "state", entity: borrower, key: "larder" }],
          },
        ],
        changes: cite.changes,
        postings: [
          {
            event: asked,
            transfers: [
              {
                unit: pick.unit,
                from: holderAccount(pick.home as unknown as HolderRef),
                to: holderAccount(home as unknown as HolderRef),
                amount: GIFT_GRAMS,
              },
            ],
          },
        ],
      };
    },
  };
}

export interface RepayOptions {
  readonly foods: readonly FoodDef[];
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Los hogares que salieron del apuro devuelven en especie lo que deben, de su despensa a la del vecino. */
export function repayProcess(o: RepayOptions): ProcessDef {
  const kcal = new Map<LedgerUnit, number>(
    o.foods.map((f) => [`good:${f.id}` as LedgerUnit, f.kcalPerGram]),
  );
  return {
    id: REPAY_PROCESS,
    system: "life",
    scope: "household",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "act",
    reads: [PERSON.name, ENTITY.name],
    writes: [],
    run(ctx) {
      const ledger = ctx.ledger;
      const home = ctx.scope as string;
      const mine = membersOf(ctx.truth, home);
      if (!ledger || mine.length === 0 || mine.includes(o.player)) return {};
      const reading = readPressures([householdHungerSource(o.foods)], {
        truth: ctx.truth,
        ledger,
        now: ctx.now,
      }).find((p) => p.scope.ref === (ctx.scope as unknown as EntityRef));
      if (!reading || reading.value >= REPAY_BELOW) return {};
      const due = creditRows(ctx.truth)
        .filter(
          (r) =>
            mine.includes(r.credit.debtor) &&
            r.credit.status !== "settled" &&
            r.credit.owed > 0 &&
            ctx.truth.get(ENTITY, r.credit.creditor)?.endedAt === undefined,
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const row = due[0];
      if (!row) return {};
      const creditorHome = ctx.truth.get(PERSON, row.credit.creditor)?.household;
      if (creditorHome === undefined) return {};
      const held = stock(ledger, home, kcal).find((s) => s.unit === row.credit.unit);
      const grams = Math.min(row.credit.owed, Math.floor(held?.grams ?? 0));
      if (grams <= 0) return {};
      const paid = draftEvent(0);
      return {
        events: [
          {
            kind: "household.repaid",
            actors: [row.credit.debtor, row.credit.creditor],
            place: o.placeOf(ctx.truth, row.credit.debtor),
            data: { payment: { unit: row.credit.unit, grams, credit: row.id } },
            emissions: { sight: 0.2 },
            causes: [{ kind: "state", entity: row.id as never, key: "owed" }],
          },
        ],
        postings: [
          {
            event: paid,
            transfers: [
              {
                unit: row.credit.unit,
                from: holderAccount(home as unknown as HolderRef),
                to: holderAccount(creditorHome as unknown as HolderRef),
                amount: grams,
              },
            ],
          },
        ],
      };
    },
  };
}
