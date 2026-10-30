import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, holderAccount, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  ANIMAL,
  BUILDING,
  COPPER,
  checkInvariants,
  ENTITY,
  GOODS,
  LIVESTOCK,
  LOCATION,
  PERSON,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { FULL_PROFILE } from "./profile.ts";
import { animalPrice, animalSaleOf, LIVE_FACTOR } from "./slaughter.ts";

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
const SEED = 3;

const plan = (actor: string, other: string, what: string): ActionPlan => ({
  actor: actor as never,
  source: "player",
  root: {
    kind: "do",
    verb: "trade",
    args: [
      { role: "with", entity: other as never },
      { role: "what", text: what },
    ],
    manner: [],
  },
  manner: [],
  causes: [{ kind: "state", entity: actor as never, key: "intent" }],
});

/**
 * El personaje y alguien vivo de un hogar ajeno con dos o más de `species` se paran al lado de uno de
 * ellos; devuelve el vendedor, su hogar y el animal.
 */
function besideSeller(l: Life, species: string): { seller: string; owner: string; goat: string } {
  const t = l.world.truth;
  const mine = t.get(PERSON, l.player)?.household;
  const alive = (id: string) => t.get(ENTITY, id as never)?.endedAt === undefined;
  const goats = (t.ids(ANIMAL) as string[]).sort().filter((id) => {
    const a = t.get(ANIMAL, id as never);
    return a?.species === species && a.owner !== mine && alive(id);
  });
  const count = (h: string) => goats.filter((g) => t.get(ANIMAL, g as never)?.owner === h).length;
  const goat = goats.find((g) => count(t.get(ANIMAL, g as never)?.owner as string) >= 2);
  const owner = goat === undefined ? undefined : t.get(ANIMAL, goat as never)?.owner;
  const seller = (t.ids(PERSON) as string[])
    .sort()
    .find((p) => t.get(PERSON, p as never)?.household === owner && alive(p));
  const hex = goat === undefined ? undefined : t.get(LOCATION, goat as never)?.hex;
  if (goat === undefined || owner === undefined || seller === undefined || hex === undefined) {
    throw new Error("sin animales de sobra");
  }
  const housed = new Set(t.ids(BUILDING).map((b) => t.get(BUILDING, b)?.household));
  if (!housed.has(mine)) throw new Error("sin casa");
  t.set(LOCATION, l.player, { hex });
  t.set(LOCATION, seller as never, { hex });
  return { seller, owner, goat };
}

describe("vender y comprar un animal (livestock-tenure-sell)", () => {
  it("pura: el precio sale del cuerpo por el recargo de vivo", () => {
    const goat = content.all(LIVESTOCK).find((s) => s.id === "goat");
    if (goat === undefined) throw new Error("sin cabra");
    const goods = content.all(GOODS);
    const adult = animalPrice(goat, 3, goods);
    expect(adult).toBeGreaterThan(animalPrice(goat, 0.1, goods));
    const meat = goods.find((g) => g.id === goat.carcass?.meat)?.priceCopperPerKg ?? 0;
    const hide = goods.find((g) => g.id === goat.carcass?.hide)?.priceCopperPerKg ?? 0;
    const kg = goat.massKg;
    const c = goat.carcass;
    expect(adult).toBe(
      Math.round((kg * (c?.meatShare ?? 0) * meat + kg * (c?.hideShare ?? 0) * hide) * LIVE_FACTOR),
    );
  });

  it("pura: compra de la casa del otro, a la casa propia; la especie tiene que estar dicha", () => {
    const l = Life.create(SEED, content, {
      frequency: 8,
      villageLivestock: true,
      livestockDairy: true,
    });
    const { seller, owner } = besideSeller(l, "goat");
    const t = l.world.truth;
    const o = { species: content.all(LIVESTOCK), year: l.world.clock.year };
    const goods = content.all(GOODS);
    const got = animalSaleOf(t, l.player, seller, "su cabra", l.now, goods, o);
    expect(got?.direction).toBe("buy");
    expect(t.get(ANIMAL, got?.animal as never)?.owner).toBe(owner);
    expect(got?.household).toBe(t.get(PERSON, l.player)?.household);
    expect(got?.spare).toBe(true);
    expect(animalSaleOf(t, l.player, seller, undefined, l.now, goods, o)).toBeUndefined();
    expect(animalSaleOf(t, l.player, l.player, "su cabra", l.now, goods, o)).toBeUndefined();
  }, 300_000);

  it("encendido: la gallina pasa a su casa y el cobre al vendedor; apagado, no; determinista", () => {
    const run = (sell: boolean) => {
      const l = Life.create(SEED, content, {
        frequency: 8,
        villageLivestock: true,
        livestockDairy: true,
        livestockLife: true,
        livestockSlaughter: true,
        livestockSell: sell,
      });
      const { seller, owner, goat } = besideSeller(l, "hen");
      const w = l.world;
      const purse = () => w.ledger.balance(holderAccount(seller as never), COPPER);
      // Que le alcance: el cobre de la bolsa más llena de la aldea (otro que el vendedor) pasa a la suya.
      const coins = (p: string) => w.ledger.balance(holderAccount(p as never), COPPER);
      const rich = (w.truth.ids(PERSON) as string[])
        .filter((p) => p !== seller && p !== l.player)
        .sort((a, b) => coins(b) - coins(a) || (a < b ? -1 : 1))[0];
      const last = w.log.all().at(-1);
      if (rich === undefined || last === undefined) throw new Error("sin cobre");
      w.ledger.post({
        tick: last.tick,
        eventId: last.id,
        transfers: [
          {
            unit: COPPER,
            from: holderAccount(rich as never),
            to: holderAccount(l.player as never),
            amount: Math.floor(coins(rich)),
          },
        ],
      });
      const before = purse();
      const from = w.log.all().length;
      l.turn(plan(l.player, seller, "su gallina"), 1);
      return { l, owner, goat, from, paid: purse() - before };
    };
    const on = run(true);
    const t = on.l.world.truth;
    const mine = t.get(PERSON, on.l.player)?.household;
    const traded = on.l.world.log
      .all()
      .slice(on.from)
      .find((e) => e.kind === "action.trade");
    const eff = (traded?.data as { effect?: { animal?: string; deal?: boolean; coins?: number } })
      ?.effect;
    expect(eff?.animal).toBeDefined();
    expect(eff?.deal).toBe(true);
    expect(t.get(ANIMAL, eff?.animal as never)?.owner).toBe(mine);
    expect(on.paid).toBe(eff?.coins);
    expect(on.paid).toBeGreaterThan(0);
    const w = on.l.world;
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(run(true).l.hash().total).toBe(on.l.hash().total);
    const off = run(false);
    expect(off.l.world.truth.get(ANIMAL, off.goat as never)?.owner).toBe(off.owner);
    expect(FULL_PROFILE).toMatchObject({ livestockSell: true });
  }, 600_000);
});
