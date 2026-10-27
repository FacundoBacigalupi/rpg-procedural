import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, externalAccount, loadContent } from "../../core/index.ts";
import {
  EATEN,
  EXCRETED,
  EXCRETED_FRACTION,
  FED_SINK,
  FIELD_MANURE,
  MANURE_QUALITY,
  MANURE_QUALITY_MAX,
  MANURE_UNIT,
  manureQualityOf,
  PARCEL_SOIL,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { FIELD_MANURED_EVENT } from "./soil.ts";

const DAY = 86400;

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

// Hash de develop (el mismo de offerings.test.ts): apagado no debe moverlo.
const BASE_HASH = "b218098c25ac14a61ca65cbd61b1324438ae2a400978faa2e6bfd7efa9b29f26";

describe("abono de los campos (fieldManure)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const run = (fieldManure: boolean, days: number) => {
    const l = Life.create(3, content, fieldManure ? { fieldManure: true } : {});
    l.advanceTo(l.now + DAY * days);
    return l;
  };

  it("apagado deja el hash de develop y no declara fuentes ni sumideros", () => {
    const off = Life.create(3, content, {});
    expect(off.hash().total).toBe(BASE_HASH);
    expect(off.world.ledger.config.externals[EXCRETED]).toBeUndefined();
    expect(off.world.ledger.config.externals[FIELD_MANURE]).toBeUndefined();
  });

  it("encendido: determinista, el ledger cuadra y el desecho es una fracción de lo comido", () => {
    const a = run(true, 20);
    const b = run(true, 20);
    expect(a.hash().total).toBe(b.hash().total);
    expect(a.world.ledger.audit()).toEqual([]);
    const events = a.world.log.all().filter((e) => e.kind === FIELD_MANURED_EVENT);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.causes.length).toBeGreaterThan(0);
    const l = a.world.ledger;
    const eaten = l.holdings(externalAccount(EATEN)).reduce((n, h) => n + h.amount, 0);
    const made = -l.balance(externalAccount(EXCRETED), MANURE_UNIT);
    expect(made).toBeGreaterThan(0);
    expect(made).toBeLessThanOrEqual(eaten * EXCRETED_FRACTION);
    // Doble entrada: lo producido está en la aldea (esperando) o ya volvió al campo.
    const returned = l.balance(externalAccount(FIELD_MANURE), MANURE_UNIT);
    expect(returned).toBeGreaterThan(0);
    expect(l.total(MANURE_UNIT)).toBe(made - returned);
  });

  it("la calidad del abono sale de la dieta: más proteína, mejor abono; sin comida, la constante", () => {
    expect(manureQualityOf([])).toBe(MANURE_QUALITY);
    const grain = manureQualityOf([{ grams: 1000, proteinPerGram: 0.07 }]);
    const meat = manureQualityOf([{ grams: 1000, proteinPerGram: 0.2 }]);
    expect(meat).toBeGreaterThan(grain);
    expect(meat).toBeLessThanOrEqual(MANURE_QUALITY_MAX);
    const mix = manureQualityOf([
      { grams: 1000, proteinPerGram: 0.07 },
      { grams: 1000, proteinPerGram: 0.2 },
    ]);
    expect(mix).toBeGreaterThan(grain);
    expect(mix).toBeLessThan(meat);
  });

  it("fieldManureDiet: sin fieldManure se ignora; encendido es determinista, cuadra y cambia el campo", () => {
    const go = (o: { fieldManure?: boolean; fieldManureDiet?: boolean }) => {
      const l = Life.create(3, content, o);
      l.advanceTo(l.now + DAY * 40);
      return l;
    };
    expect(go({ fieldManureDiet: true }).hash().total).toBe(go({}).hash().total);
    const a = go({ fieldManure: true, fieldManureDiet: true });
    const b = go({ fieldManure: true, fieldManureDiet: true });
    expect(a.hash().total).toBe(b.hash().total);
    expect(a.world.ledger.audit()).toEqual([]);
    expect(a.hash().total).not.toBe(go({ fieldManure: true }).hash().total);
  });

  it("livestockManure: lo que come el ganado de la casa también deja abono (livestock-yield-manure)", () => {
    const herd = { villageLivestock: true, livestockFeed: true } as const;
    const go = (o: { fieldManure?: boolean; livestockManure?: boolean }) => {
      const l = Life.create(3, content, { ...herd, ...o });
      l.advanceTo(l.now + DAY * 20);
      return l;
    };
    // Sin fieldManure se ignora.
    expect(go({ livestockManure: true }).hash().total).toBe(go({}).hash().total);
    const on = go({ fieldManure: true, livestockManure: true });
    const plain = go({ fieldManure: true });
    expect(on.world.ledger.audit()).toEqual([]);
    const total = (l: Life, sink: string) =>
      l.world.ledger.holdings(externalAccount(sink)).reduce((n, h) => n + h.amount, 0);
    const made = (l: Life) => -l.world.ledger.balance(externalAccount(EXCRETED), MANURE_UNIT);
    expect(total(on, FED_SINK)).toBeGreaterThan(0);
    expect(made(on)).toBeGreaterThan(made(plain));
    expect(made(on)).toBeLessThanOrEqual(
      (total(on, EATEN) + total(on, FED_SINK)) * EXCRETED_FRACTION,
    );
  }, 300_000);

  it("el abono sube la fertilidad del campo frente a no abonar", () => {
    const on = run(true, 120);
    const off = run(false, 120);
    const f = (l: Life) => {
      const [id] = l.world.truth.ids(PARCEL_SOIL);
      return l.world.truth.get(PARCEL_SOIL, id as never)?.soil.fertility.n ?? 0;
    };
    expect(f(on)).toBeGreaterThan(f(off));
  });
});
