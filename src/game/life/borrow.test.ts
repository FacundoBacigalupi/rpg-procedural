import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  externalAccount,
  type HolderRef,
  holderAccount,
  loadContent,
} from "../../core/index.ts";
import { checkInvariants, ENTITY, HARVEST, PERSON, PRESSURE, ROTTED } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { creditRows } from "./credit.ts";
import { Life } from "./life.ts";
import { householdsOf } from "./spoilage.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

/** Un mundo en el que una casa ajena al jugador se quedó sin nada en la despensa. */
function starved(seed: number) {
  const life = Life.create(seed, content);
  const w = life.world;
  const mine = w.truth.get(PERSON, life.player)?.household;
  const home = householdsOf(w.truth)
    .map((h) => h as unknown as string)
    .find((h) => h !== mine) as string;
  const larder = holderAccount(home as unknown as HolderRef);
  const first = w.log.all()[0];
  const rows = w.ledger.holdings(larder).filter((h) => h.amount > 0);
  if (first && rows.length > 0) {
    w.ledger.post({
      tick: (first as NonNullable<typeof first>).tick,
      eventId: first.id,
      transfers: rows.map((h) => ({
        unit: h.unit,
        from: larder,
        to: externalAccount(ROTTED),
        amount: h.amount,
      })),
    });
  }
  return { life, w, home };
}

describe("fiado por hambre", () => {
  it("un hogar sin comida le pide a un vecino: cita la presión, mueve la comida y abre la deuda", () => {
    const { life, w, home } = starved(1);
    life.advanceTo(life.now + 70 * w.clock.day);
    const asked = w.log.all().filter((e) => e.kind === "household.borrowed");
    expect(asked.length).toBeGreaterThan(0);
    const first = asked[0];
    const pressure = first?.causes.find((c) => c.kind === "pressure");
    expect(pressure).toBeDefined();
    const id = (pressure as { pressure: string }).pressure;
    expect(w.truth.get(PRESSURE, id as never)).toMatchObject({ kind: "hunger", scope: home });
    expect(w.truth.get(PRESSURE, id as never)?.discharges).toBeGreaterThan(0);
    const [borrower] = first?.actors.slice(1) ?? [];
    expect(
      creditRows(w.truth).some(
        (r) => r.credit.debtor === borrower && w.truth.get(ENTITY, r.id as never)?.originEventId,
      ),
    ).toBe(true);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants(w)).toEqual([]);
  }, 240_000);

  it("el hogar que salió del apuro devuelve en especie y la deuda se salda", () => {
    const { life, w, home } = starved(1);
    life.advanceTo(life.now + 70 * w.clock.day);
    const [row] = creditRows(w.truth).filter(
      (r) => w.truth.get(PERSON, r.credit.debtor)?.household === home,
    );
    expect(row).toBeDefined();
    const larder = holderAccount(home as unknown as HolderRef);
    const first = w.log.all()[0];
    w.ledger.post({
      tick: (first as NonNullable<typeof first>).tick,
      eventId: (first as NonNullable<typeof first>).id,
      transfers: [
        {
          unit: row?.credit.unit as never,
          from: externalAccount(HARVEST),
          to: larder,
          amount: 2_000_000,
        },
      ],
    });
    life.advanceTo(life.now + 3 * w.clock.day);
    expect(w.log.all().some((e) => e.kind === "household.repaid")).toBe(true);
    expect(creditRows(w.truth).find((r) => r.id === row?.id)?.credit).toMatchObject({
      status: "settled",
      owed: 0,
    });
    expect(w.ledger.audit()).toEqual([]);
  }, 400_000);

  it("es determinista", () => {
    const run = () => {
      const { life, w } = starved(1);
      life.advanceTo(life.now + 70 * w.clock.day);
      return life.hash();
    };
    expect(run()).toEqual(run());
  }, 400_000);
});
