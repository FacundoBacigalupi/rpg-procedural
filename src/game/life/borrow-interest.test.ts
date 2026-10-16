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
import { checkInvariants, HARVEST, PERSON, ROTTED } from "../../sim/index.ts";
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

/** Un hogar ajeno al jugador se queda sin comida, pide fiado y después recibe de sobra y devuelve. */
function repaid(householdInterest?: number) {
  const life = Life.create(1, content, householdInterest ? { householdInterest } : {});
  const w = life.world;
  const mine = w.truth.get(PERSON, life.player)?.household;
  const home = householdsOf(w.truth)
    .map((h) => h as unknown as string)
    .find((h) => h !== mine) as string;
  const larder = holderAccount(home as unknown as HolderRef);
  const first = w.log.all()[0] as NonNullable<ReturnType<typeof w.log.all>[number]>;
  const rows = w.ledger.holdings(larder).filter((h) => h.amount > 0);
  w.ledger.post({
    tick: first.tick,
    eventId: first.id,
    transfers: rows.map((h) => ({
      unit: h.unit,
      from: larder,
      to: externalAccount(ROTTED),
      amount: h.amount,
    })),
  });
  life.advanceTo(life.now + 70 * w.clock.day);
  const row = creditRows(w.truth).find(
    (r) => w.truth.get(PERSON, r.credit.debtor)?.household === home,
  );
  if (!row) throw new Error("sin deuda");
  w.ledger.post({
    tick: first.tick,
    eventId: first.id,
    transfers: [
      { unit: row.credit.unit, from: externalAccount(HARVEST), to: larder, amount: 2_000_000 },
    ],
  });
  life.advanceTo(life.now + 3 * w.clock.day);
  return { life, w, row };
}

type Repaid = { data: { payment: { grams: number; interest?: number } } };

describe("interés en especie del fiado entre hogares", () => {
  it("encendido, al saldar suma el interés del mismo bien y el ledger conserva", () => {
    const { w, row } = repaid(0.1);
    const ev = w.log.all().filter((e) => e.kind === "household.repaid") as unknown as Repaid[];
    const last = ev[ev.length - 1];
    expect(last?.data.payment.interest).toBe(Math.ceil(row.credit.principal * 0.1));
    expect(creditRows(w.truth).find((r) => r.id === row.id)?.credit.status).toBe("settled");
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants(w)).toEqual([]);
  }, 400_000);

  it("apagado no anota interés ni cambia el hash", () => {
    const off = repaid();
    const ev = off.w.log.all().filter((e) => e.kind === "household.repaid") as unknown as Repaid[];
    expect(ev.every((e) => e.data.payment.interest === undefined)).toBe(true);
    expect(repaid(0).life.hash()).toEqual(off.life.hash());
  }, 800_000);

  it("es determinista", () => {
    expect(repaid(0.1).life.hash()).toEqual(repaid(0.1).life.hash());
  }, 800_000);
});
