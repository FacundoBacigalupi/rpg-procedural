import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { makeId } from "../ids/index.ts";
import {
  externalAccount,
  holderAccount,
  Ledger,
  type LedgerAccount,
  type LedgerConfig,
  LedgerError,
  ledgerUnit,
  type Posting,
  type Transfer,
} from "./index.ts";

const config: LedgerConfig = {
  externals: { harvest: ["rice"], mint: ["copper"], decay: ["rice", "copper"] },
};
const rice = ledgerUnit("rice");
const copper = ledgerUnit("copper");
const units = [rice, copper];
const people = [1, 2, 3, 4].map((i) => holderAccount(makeId("agent", i)));
const granary = holderAccount({
  kind: "building",
  building: makeId("building", 1),
  space: "store",
});
const internal = [...people, granary];
const sources = [externalAccount("harvest"), externalAccount("mint"), externalAccount("decay")];
const accounts = [...internal, ...sources, externalAccount("undeclared")];

const transfer: fc.Arbitrary<Transfer> = fc
  .record({
    unit: fc.constantFrom(...units),
    from: fc.constantFrom(...accounts),
    to: fc.constantFrom(...accounts),
    amount: fc.integer({ min: 1, max: 1000 }),
  })
  .filter((t) => t.from !== t.to);

const posting = (i: number, transfers: Transfer[]): Posting => ({
  tick: i * 60,
  eventId: makeId("event", i + 1),
  transfers,
});

const postings = fc
  .array(fc.array(transfer, { minLength: 1, maxLength: 4 }), { maxLength: 40 })
  .map((ts) => ts.map((t, i) => posting(i, t)));

/** Aplica lo que se pueda; devuelve cuántos asientos pasaron. */
function applyAll(ledger: Ledger, ps: readonly Posting[]): number {
  let ok = 0;
  for (const p of ps) {
    try {
      ledger.post(p);
      ok++;
    } catch (e) {
      if (!(e instanceof LedgerError)) throw e;
    }
  }
  return ok;
}

describe("Ledger: propiedades", () => {
  it("después de cualquier secuencia la auditoría da limpio", () => {
    fc.assert(
      fc.property(postings, (ps) => {
        const ledger = new Ledger(config);
        applyAll(ledger, ps);
        expect(ledger.audit()).toEqual([]);
      }),
    );
  });

  it("cada unidad suma 0 sobre todas las cuentas y lo interno nunca es negativo", () => {
    fc.assert(
      fc.property(postings, (ps) => {
        const ledger = new Ledger(config);
        applyAll(ledger, ps);
        for (const unit of units) {
          let sum = 0;
          for (const a of accounts) sum += ledger.balance(a, unit);
          expect(sum).toBe(0);
          for (const a of internal) expect(ledger.balance(a, unit)).toBeGreaterThanOrEqual(0);
          const outside = sources.reduce((s, a) => s + ledger.balance(a, unit), 0);
          expect(ledger.total(unit) + outside).toBe(0);
        }
      }),
    );
  });

  it("un asiento rechazado no cambia nada", () => {
    fc.assert(
      fc.property(postings, (ps) => {
        const ledger = new Ledger(config);
        for (const p of ps) {
          const before = JSON.stringify(ledger.balances());
          const journalLength = ledger.journal().length;
          try {
            ledger.post(p);
          } catch (e) {
            if (!(e instanceof LedgerError)) throw e;
            expect(JSON.stringify(ledger.balances())).toBe(before);
            expect(ledger.journal().length).toBe(journalLength);
          }
        }
      }),
    );
  });

  it("coincide con un modelo de referencia que aplica transferencia por transferencia", () => {
    fc.assert(
      fc.property(postings, (ps) => {
        const ledger = new Ledger(config);
        const model = new Map<string, number>();
        const key = (a: LedgerAccount, u: string) => `${a}|${u}`;
        for (const p of ps) {
          const next = new Map(model);
          let valid = true;
          for (const t of p.transfers) {
            const ext = (a: LedgerAccount) => a.startsWith("ext:");
            const allowed = (a: LedgerAccount) =>
              !ext(a) || (config.externals[a.slice(4)]?.includes(t.unit) ?? false);
            if (!allowed(t.from) || !allowed(t.to)) valid = false;
            next.set(key(t.from, t.unit), (next.get(key(t.from, t.unit)) ?? 0) - t.amount);
            next.set(key(t.to, t.unit), (next.get(key(t.to, t.unit)) ?? 0) + t.amount);
          }
          for (const [k, v] of next) if (!k.startsWith("ext:") && v < 0) valid = false;
          let posted = true;
          try {
            ledger.post(p);
          } catch (e) {
            if (!(e instanceof LedgerError)) throw e;
            posted = false;
          }
          expect(posted).toBe(valid);
          if (valid) for (const [k, v] of next) model.set(k, v);
        }
        for (const a of accounts) {
          for (const u of units) expect(ledger.balance(a, u)).toBe(model.get(key(a, u)) ?? 0);
        }
      }),
    );
  });

  it("el diario reconstruye exactamente los mismos saldos", () => {
    fc.assert(
      fc.property(postings, (ps) => {
        const ledger = new Ledger(config);
        applyAll(ledger, ps);
        const replayed = Ledger.fromJournal(config, ledger.journal());
        expect(replayed.balances()).toEqual(ledger.balances());
        expect(replayed.journal()).toEqual(ledger.journal());
      }),
    );
  });

  it("asientos que siempre pasan dan el mismo resultado en cualquier orden", () => {
    const income = fc.record({
      unit: fc.constant(rice),
      from: fc.constant(externalAccount("harvest")),
      to: fc.constantFrom(...internal),
      amount: fc.integer({ min: 1, max: 1000 }),
    });
    fc.assert(
      fc.property(
        fc
          .array(income, { maxLength: 30 })
          .chain((ts) =>
            fc.tuple(fc.constant(ts), fc.shuffledSubarray(ts, { minLength: ts.length })),
          ),
        ([ts, shuffled]) => {
          const a = new Ledger(config);
          const b = new Ledger(config);
          expect(
            applyAll(
              a,
              ts.map((t, i) => posting(i, [t])),
            ),
          ).toBe(ts.length);
          expect(
            applyAll(
              b,
              shuffled.map((t, i) => posting(i, [t])),
            ),
          ).toBe(ts.length);
          expect(b.balances()).toEqual(a.balances());
        },
      ),
    );
  });
});

describe("Ledger: casos", () => {
  const harvest = externalAccount("harvest");
  const [ana, bo] = people as [LedgerAccount, LedgerAccount];

  it("mueve, rechaza sobregiros y deja el asiento atómico", () => {
    const ledger = new Ledger(config);
    ledger.post(posting(0, [{ unit: rice, from: harvest, to: ana, amount: 10 }]));
    expect(() =>
      ledger.post(
        posting(1, [
          { unit: rice, from: ana, to: bo, amount: 6 },
          { unit: rice, from: ana, to: granary, amount: 6 },
        ]),
      ),
    ).toThrow(LedgerError);
    expect(ledger.balance(ana, rice)).toBe(10);
    // dentro de un asiento lo que entra puede salir: se valida el neto
    ledger.post(
      posting(2, [
        { unit: rice, from: ana, to: bo, amount: 10 },
        { unit: rice, from: bo, to: granary, amount: 4 },
      ]),
    );
    expect([
      ledger.balance(ana, rice),
      ledger.balance(bo, rice),
      ledger.balance(granary, rice),
    ]).toEqual([0, 6, 4]);
    expect(ledger.total(rice)).toBe(10);
  });

  it("las fuentes solo mueven lo declarado", () => {
    const ledger = new Ledger(config);
    expect(() =>
      ledger.post(posting(0, [{ unit: copper, from: harvest, to: ana, amount: 1 }])),
    ).toThrow(/no puede mover/);
    expect(() =>
      ledger.post(
        posting(0, [{ unit: rice, from: externalAccount("heaven"), to: ana, amount: 1 }]),
      ),
    ).toThrow(/no declarado/);
  });

  it("rechaza montos que no son enteros positivos y desbordes", () => {
    const ledger = new Ledger(config);
    for (const amount of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        ledger.post(posting(0, [{ unit: rice, from: harvest, to: ana, amount }])),
      ).toThrow(LedgerError);
    }
    ledger.post(
      posting(0, [{ unit: rice, from: harvest, to: ana, amount: Number.MAX_SAFE_INTEGER }]),
    );
    expect(() =>
      ledger.post(posting(1, [{ unit: rice, from: harvest, to: bo, amount: 1 }])),
    ).toThrow(/desborde/);
    expect(() => ledger.post(posting(1, []))).toThrow(LedgerError);
  });

  it("totalsBy agrupa lo interno con claves ordenadas", () => {
    const ledger = new Ledger(config);
    ledger.post(
      posting(0, [
        { unit: rice, from: harvest, to: granary, amount: 5 },
        { unit: rice, from: harvest, to: ana, amount: 2 },
        { unit: rice, from: harvest, to: bo, amount: 3 },
      ]),
    );
    const byKind = ledger.totalsBy(rice, (a) => a.split(":")[0] as string);
    expect([...byKind]).toEqual([
      ["agent", 5],
      ["building", 5],
    ]);
  });
});
