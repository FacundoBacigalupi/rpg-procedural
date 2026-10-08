import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  externalAccount,
  type HolderRef,
  holderAccount,
  ledgerUnit,
  loadContent,
} from "../../core/index.ts";
import { type ActionPlan, ENTITY, LOCATION, PERSON, SOIL, SOIL_START } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../index.ts";
import { Life } from "./index.ts";
import { living } from "./world.ts";

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
const grain = ledgerUnit("good:grain");
const copper = ledgerUnit("coin:copper");

describe("economía mínima en la aldea", () => {
  it("cosecha, pudre y conserva: lo que entra y sale pasa por fuentes y sumideros con evento", () => {
    const life = Life.create(7, content);
    const w = life.world;
    const coins = w.ledger.total(copper);
    expect(coins).toBeGreaterThan(0);
    life.advanceTo(life.now + 20 * w.clock.day);
    expect(w.ledger.audit()).toEqual([]);
    // Las monedas no se crean ni se pudren: el cobre del arranque es todo el cobre.
    expect(w.ledger.total(copper)).toBe(coins);
    const kinds = new Set(w.log.all().map((e) => e.kind));
    expect(kinds.has("routine.harvested")).toBe(true);
    expect(kinds.has("household.spoiled")).toBe(true);
    // Lo cosechado y lo podrido se ven como saldos de las cuentas externas.
    expect(w.ledger.balance(externalAccount("harvest"), grain)).toBeLessThan(0);
    expect(w.ledger.balance(externalAccount("rotted"), grain)).toBeGreaterThan(0);
  }, 120_000);

  it("es determinista: la misma semilla da el mismo mundo", () => {
    const run = () => {
      const life = Life.create(7, content);
      life.advanceTo(life.now + 10 * life.world.clock.day);
      return life.hash();
    };
    expect(run()).toEqual(run());
  }, 120_000);
});

describe("tratos entre vecinos", () => {
  it("comprar un kilo a un vecino con la despensa normal cierra, y si no es posible no es por falta de medios", () => {
    const life = Life.create(2, content);
    const w = life.world;
    const me = life.player;
    const home = w.truth.get(PERSON, me)?.household;
    const here = w.truth.get(LOCATION, me);
    let seq = 1;
    let closed = 0;
    for (const n of living(w.truth).filter((id) => w.truth.get(PERSON, id)?.household !== home)) {
      if (here) w.truth.set(LOCATION, n, here);
      const plan: ActionPlan = {
        actor: me,
        source: "player",
        root: {
          kind: "do",
          verb: "trade",
          args: [
            { role: "with", entity: n },
            { role: "what", text: "1 kilo de grano" },
          ],
          manner: [],
        },
        manner: [],
        causes: [{ kind: "state", entity: me, key: "intent" }],
      };
      const ev = life.turn(plan, seq++).events.find((e) => e.kind === "action.trade");
      const d = ev?.data as { effect?: { deal?: boolean; grams?: number } } | undefined;
      if (d?.effect?.deal && (d.effect.grams ?? 0) > 0) closed++;
    }
    expect(closed).toBeGreaterThan(0);
    expect(w.ledger.audit()).toEqual([]);
  }, 120_000);
});

describe("migración de vidas guardadas antes de la economía", () => {
  it("suma las fuentes y sumideros que faltan sin tocar un saldo", async () => {
    const { Ledger } = await import("../../core/index.ts");
    const { withDeclaredExternals } = await import("./create.ts");
    const life = Life.create(7, content);
    const w = life.world;
    const { harvest, rotted, ...old } = w.ledger.config.externals;
    expect(harvest).toBeDefined();
    expect(rotted).toBeDefined();
    const oldLedger = Ledger.fromJournal({ externals: old }, w.ledger.journal());
    expect(() =>
      oldLedger.post({
        tick: 0,
        eventId: "event:99999" as never,
        transfers: [
          { unit: grain, from: externalAccount("harvest"), to: externalAccount("seed"), amount: 1 },
        ],
      }),
    ).toThrow();
    const migrated = withDeclaredExternals(oldLedger, content);
    expect(Object.keys(migrated.config.externals).sort()).toEqual(
      Object.keys(w.ledger.config.externals).sort(),
    );
    expect(migrated.total(copper)).toBe(w.ledger.total(copper));
    expect(migrated.total(grain)).toBe(w.ledger.total(grain));
    expect(migrated.audit()).toEqual([]);
    // Lo que ya declara todo no se rehace.
    expect(withDeclaredExternals(w.ledger, content)).toBe(w.ledger);
  }, 120_000);
});

describe("calibración de despensas y rutina (Hito 1c, paso 3)", () => {
  // Medido en 3 seeds × 1 año (2026-10-08): ningún hogar baja de ~78 kg por boca (unos 100 días
  // de comida), la cosecha rinde 1,1-1,3 veces lo comido y las reservas suben ~50 kg por boca al
  // año sin tope. El tope y la estacionalidad llegan con la cosecha por estación (Economía).
  it("la cosecha de la rutina cubre lo comido sin vaciar ni desbordar las despensas", () => {
    const life = Life.create(3, content);
    const w = life.world;
    const larders = (): number[] => {
      const homes = new Map<string, number>();
      for (const id of w.truth.ids(PERSON)) {
        if (w.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        const h = w.truth.get(PERSON, id)?.household;
        if (h !== undefined) homes.set(h, (homes.get(h) ?? 0) + 1);
      }
      return [...homes].map(
        ([h, n]) => w.ledger.balance(holderAccount(h as unknown as HolderRef), grain) / n,
      );
    };
    const before = larders();
    life.advanceTo(life.now + 40 * w.clock.day);
    const after = larders();
    // Nadie queda con menos de un mes de comida (~0,75 kg por día por boca).
    expect(Math.min(...after)).toBeGreaterThan(30 * 750);
    let harvested = 0;
    let ate = 0;
    for (const e of w.log.all()) {
      const g = (e.data as { grams?: number } | null)?.grams ?? 0;
      if (e.kind === "routine.harvested") harvested += g;
      if (e.kind === "routine.ate") ate += g;
    }
    expect(harvested / ate).toBeGreaterThan(0.9);
    expect(harvested / ate).toBeLessThan(1.6);
    // Las reservas por boca no se vacían ni se disparan en 40 días.
    const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(total(after) / total(before)).toBeGreaterThan(0.8);
    // Y no se disparan: la despensa de arranque es lo justo hasta la próxima cosecha, no un año.
    expect(total(after) / total(before)).toBeLessThan(1.6);
  }, 120_000);

  it("la despensa de arranque aguanta un año entero sin que ningún hogar toque cero", () => {
    const life = Life.create(3, content);
    const w = life.world;
    const perMouth = (): number[] => {
      const homes = new Map<string, number>();
      for (const id of w.truth.ids(PERSON)) {
        if (w.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        const h = w.truth.get(PERSON, id)?.household;
        if (h !== undefined) homes.set(h, (homes.get(h) ?? 0) + 1);
      }
      return [...homes].map(
        ([h, n]) => w.ledger.balance(holderAccount(h as unknown as HolderRef), grain) / n,
      );
    };
    const start = life.now;
    let lowest = Number.POSITIVE_INFINITY;
    for (let m = 1; m <= 12; m++) {
      life.advanceTo(start + Math.round((m * w.clock.year) / 12));
      lowest = Math.min(lowest, ...perMouth());
    }
    // Siempre queda al menos una semana de comida por boca (~0,7 kg por día).
    expect(lowest).toBeGreaterThan(7 * 700);
  }, 300_000);
});

describe("suelo del campo (Hito 1c, cierre PR b)", () => {
  it("en un año de rutina la fertilidad queda cerca de donde empezó y el acumulado cuenta lo cosechado", () => {
    const life = Life.create(3, content);
    const w = life.world;
    const [id] = w.truth.ids(SOIL);
    if (id === undefined) throw new Error("la aldea no tiene suelo");
    const start = w.truth.get(SOIL, id)?.fertility ?? 0;
    expect(start).toBeCloseTo(SOIL_START, 10);
    life.advanceTo(life.now + w.clock.year);
    const soil = w.truth.get(SOIL, id);
    expect(soil?.fertility).toBeGreaterThan(0.6);
    expect(soil?.fertility).toBeLessThanOrEqual(1);
    let harvested = 0;
    for (const e of w.log.all()) {
      if (e.kind === "routine.harvested") harvested += (e.data as { grams?: number }).grams ?? 0;
    }
    // Lo anotado es lo cosechado, salvo el día en curso que todavía no se contó.
    expect(soil?.seen).toBeLessThanOrEqual(harvested);
    expect(soil?.seen).toBeGreaterThan(0.9 * harvested);
  }, 300_000);
});
