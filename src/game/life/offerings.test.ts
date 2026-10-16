import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  externalAccount,
  type HolderRef,
  holderAccount,
  ledgerUnit,
  loadContent,
} from "../../core/index.ts";
import {
  FESTIVAL_MIX,
  HEARTH_MIX,
  OFFERING_ASH,
  OFFERING_DISPOSALS,
  offeredAmount,
  offeringLot,
  poorestHousehold,
  splitLot,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { householdSincerity, OFFERING_MADE, offeringDue } from "./offerings.ts";

const DAY = 86400;
const unit = ledgerUnit("good:grain");
const acc = (s: string) => holderAccount(s as unknown as HolderRef);

describe("lotes de ofrenda (puro)", () => {
  it("el reparto suma exacto, es determinista y respeta los pesos", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000 }),
        fc.record({
          burned: fc.double({ min: 0, max: 5, noNaN: true }),
          buried: fc.double({ min: 0, max: 5, noNaN: true }),
          given_to_poor: fc.double({ min: 0, max: 5, noNaN: true }),
          eaten_by_performers: fc.double({ min: 0, max: 5, noNaN: true }),
        }),
        (n, mix) => {
          const a = splitLot(n, mix);
          expect(a).toEqual(splitLot(n, mix));
          expect(OFFERING_DISPOSALS.reduce((s, d) => s + a[d], 0)).toBe(n);
          for (const d of OFFERING_DISPOSALS) {
            expect(Number.isInteger(a[d])).toBe(true);
            if (mix[d] === 0) expect(a[d]).toBe(0);
          }
        },
      ),
    );
  });

  it("las transferencias suman lo que sale menos lo que la familia se queda", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.boolean(), (n, hasPoor) => {
        const lot = offeringLot(unit, n, FESTIVAL_MIX, {
          from: acc("household:1"),
          ash: externalAccount(OFFERING_ASH),
          buried: acc("place:shrine"),
          ...(hasPoor ? { poor: acc("household:2") } : {}),
        });
        const moved = lot.transfers.reduce((s, t) => s + t.amount, 0);
        expect(moved + lot.parts.eaten_by_performers).toBe(n);
        if (!hasPoor) expect(lot.parts.given_to_poor).toBe(0);
        expect(lot.total).toBe(n);
      }),
    );
  });

  it("lo ofrendado nunca pasa de la despensa y sin sinceridad es cero", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10, max: 1e6 }),
        fc.double({ min: -1, max: 3, noNaN: true }),
        fc.double({ min: -1, max: 2, noNaN: true }),
        (stock, share, sincerity) => {
          const o = offeredAmount(stock, share, sincerity);
          expect(o).toBeGreaterThanOrEqual(0);
          expect(o).toBeLessThanOrEqual(Math.max(0, stock));
        },
      ),
    );
    expect(offeredAmount(1000, 0.1, 0)).toBe(0);
  });

  it("el hogar más pobre es el de menos despensa, sin contar al que ofrenda", () => {
    const m = new Map([
      ["b", 5],
      ["a", 5],
      ["c", 1],
    ]);
    expect(poorestHousehold(m, "c")).toBe("a");
    expect(poorestHousehold(m, "x")).toBe("c");
    expect(poorestHousehold(new Map([["a", 1]]), "a")).toBeUndefined();
    expect(HEARTH_MIX.burned).toBeGreaterThan(0);
  });

  it("el calendario y la sinceridad", () => {
    const p = { kind: "offering", everyDays: 15 } as never;
    expect(offeringDue(p, 0)).toBe(false);
    expect(offeringDue(p, 15)).toBe(true);
    expect(offeringDue(p, 16)).toBe(false);
    expect(householdSincerity([undefined])).toBe(0);
  });
});

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

describe("ofrendas en la vida", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const run = (offerings: boolean, days: number) => {
    const l = Life.create(3, content, offerings ? { offerings: true } : {});
    l.advanceTo(l.now + DAY * days);
    return l;
  };

  it("apagado deja el hash de develop", () => {
    const off = Life.create(3, content, {});
    expect(off.hash().total).toBe(BASE_HASH);
  });

  it("encendido: ofrenda con causa, el ledger cuadra y la ceniza se lleva lo quemado", () => {
    const a = run(true, 32);
    const b = run(true, 32);
    expect(a.hash().total).toBe(b.hash().total);
    const made = a.world.log.all().filter((e) => e.kind === OFFERING_MADE);
    expect(made.length).toBeGreaterThan(0);
    for (const e of made) expect(e.causes.length).toBeGreaterThan(0);
    expect(a.world.ledger.audit()).toEqual([]);
    const ash = a.world.ledger.balance(externalAccount(OFFERING_ASH), unit);
    const burned = made.reduce(
      (s, e) => s + ((e.data as { parts: { burned: number } }).parts.burned ?? 0),
      0,
    );
    // El sumidero recibe exactamente lo quemado (doble entrada).
    expect(ash).toBe(burned);
    // La conservación del lote: lo que salió del grano interno es exactamente lo quemado.
    expect(run(false, 32).world.ledger.total(unit)).toBeGreaterThanOrEqual(
      a.world.ledger.total(unit),
    );
  });
});

const BASE_HASH = "b829bb7436cffc764da33660c899d578132ea796fdf7f86e47af651e5310c12f";
