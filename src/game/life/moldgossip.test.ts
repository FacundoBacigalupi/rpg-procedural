import { describe, expect, it } from "vitest";
import type { PlaceRef } from "../../core/index.ts";
import { Rng } from "../../core/index.ts";
import { PERSON, PRICE_BELIEFS } from "../../sim/index.ts";
import {
  distortStanding,
  keepMold,
  MOLD_HINT_MOOD,
  moldBuyGoods,
  moldGossipProcess,
  moldHintMood,
  moldKey,
  moldPriceEdge,
  standingRumor,
  standingRumorsOf,
  trustScale,
} from "./moldgossip.ts";

const market: PlaceRef = { kind: "settlement", settlement: "s1" } as unknown as PlaceRef;
const price = (amount: number) => ({ mold: "price", good: "rice", market, amount }) as const;
const heard = (amount: number, confidence: number) => ({
  rumor: price(amount),
  confidence,
  hops: 1,
  heardAt: 0,
  teller: null,
});

describe("chisme de moldes", () => {
  it("la confianza en quien cuenta escala lo que se cree, con piso y techo", () => {
    expect(trustScale(1)).toBe(1);
    expect(trustScale(0)).toBe(0.6);
    expect(trustScale(-1)).toBe(0.2);
    expect(trustScale(-5)).toBe(0.2);
  });

  it("la clave no depende del valor, solo de qué cosa es", () => {
    expect(moldKey(price(10))).toBe(moldKey(price(99)));
  });

  it("de una misma cosa se queda con la versión más creída", () => {
    const a = keepMold(undefined, heard(10, 0.8));
    const b = keepMold(a, heard(20, 0.4));
    expect(b.items).toHaveLength(1);
    expect(b.items[0]?.rumor).toEqual(price(10));
    const c = keepMold(b, heard(30, 0.9));
    expect(c.items[0]?.rumor).toEqual(price(30));
  });

  it("un atributo o�do tiene clave por persona y atributo, no por valor", () => {
    const a = { mold: "attr", about: "p1", attr: "alive", value: true } as const;
    const b = { ...a, value: false };
    expect(moldKey(a)).toBe(moldKey(b));
    const book = keepMold(undefined, { ...heard(1, 0.6), rumor: b });
    expect(book.items[0]?.rumor).toEqual(b);
  });
});

describe("la decisión lee lo que cree de oídas", () => {
  const cave = { kind: "place", place: "place:cave" } as unknown as PlaceRef;
  const where = (vague: boolean) =>
    ({ mold: "location", what: "herb", where: cave, vague }) as const;
  const book = (r: ReturnType<typeof where> | ReturnType<typeof price>, confidence: number) => ({
    items: [{ rumor: r, confidence, hops: 1, heardAt: 0, teller: null }],
    told: [],
  });
  const go = { id: "move:place:cave", verb: "move", target: "place:cave" };

  it("ir hacia donde cree que hay algo suma por utilidad; un lugar vago, la mitad", () => {
    expect(moldHintMood(go, book(where(false), 0.8))).toBeCloseTo(0.8 * MOLD_HINT_MOOD, 6);
    expect(moldHintMood(go, book(where(true), 0.8))).toBeCloseTo(0.4 * MOLD_HINT_MOOD, 6);
  });

  it("comerciar el bien con precio oído suma; otro destino o sin libro, nada", () => {
    const buy = { id: "trade:ana+rice", verb: "trade", target: "ana" };
    expect(moldHintMood(buy, book(price(10), 0.5))).toBeCloseTo(0.5 * MOLD_HINT_MOOD, 6);
    expect(moldHintMood(buy, book(price(10), 0.5), { goodName: () => "pan" })).toBe(0);
    expect(moldHintMood({ ...go, target: "place:mill" }, book(where(false), 1))).toBe(0);
    expect(moldHintMood(go, undefined)).toBe(0);
  });

  it("valora el precio oído contra el creído: barato o caro empuja, igual no", () => {
    expect(moldPriceEdge(5, 10)).toEqual({ side: "buy", edge: 0.5 });
    expect(moldPriceEdge(15, 10)).toEqual({ side: "sell", edge: 0.5 });
    expect(moldPriceEdge(10, 10).edge).toBe(0);
    expect(moldPriceEdge(10, undefined)).toEqual({ side: "none", edge: 1 });
    const buy = { id: "trade:ana+rice", verb: "trade", target: "ana" };
    const o = { believedPerKg: () => 10 };
    const at = { beliefs: undefined, day: 0 };
    expect(moldHintMood(buy, book(price(5), 1), o, at)).toBeCloseTo(0.5 * MOLD_HINT_MOOD, 6);
    expect(moldHintMood(buy, book(price(10), 1), o, at)).toBe(0);
  });

  it("con bySide, la candidata que vende no se empuja con un precio oído más barato", () => {
    const sell = { id: "trade:ana+rice", verb: "trade", target: "ana", direction: "sell" as const };
    const at = { beliefs: undefined, day: 0 };
    const o = { believedPerKg: () => 10, bySide: true };
    expect(moldHintMood(sell, book(price(5), 1), o, at)).toBe(0);
    expect(moldHintMood(sell, book(price(15), 1), o, at)).toBeCloseTo(0.5 * MOLD_HINT_MOOD, 6);
    expect(moldHintMood(sell, book(price(5), 1), { believedPerKg: () => 10 }, at)).toBeGreaterThan(
      0,
    );
  });
});

describe("el apuro del vecino como rumor", () => {
  it("lo visto de primera mano pasa a rumor attr por hogar, sin valor en la clave", () => {
    const rumors = standingRumorsOf({
      homes: { "home:2": { standing: "tight", day: 3 }, "home:1": { standing: "broke", day: 4 } },
    });
    expect(rumors).toEqual([standingRumor("home:1", "broke"), standingRumor("home:2", "tight")]);
    expect(moldKey(standingRumor("home:1", "broke"))).toBe(
      moldKey(standingRumor("home:1", "tight")),
    );
    expect(standingRumorsOf(undefined)).toEqual([]);
  });

  it("quien recuerda poco infla un apretado a ruina; el que recuerda bien o el de ruina no cambian", () => {
    const tight = standingRumor("home:1", "tight");
    expect(distortStanding(tight, 0.4, 0.1)).toEqual(standingRumor("home:1", "broke"));
    expect(distortStanding(tight, 1, 0)).toEqual(tight);
    expect(distortStanding(tight, 0.4, 0.9)).toEqual(tight);
    const broke = standingRumor("home:1", "broke");
    expect(distortStanding(broke, 0, 0)).toEqual(broke);
  });
});

describe("el precio visto entra como rumor de primera mano", () => {
  const run = (o: Parameters<typeof moldGossipProcess>[0]) => {
    const beliefs = { "good:rice": { perKg: 12.3456789, confidence: 0.5, lastSeenDay: 3 } };
    const truth = {
      ids: (t: { name: string }) => (t.name === PERSON.name ? ["agent:a"] : []),
      get: (t: { name: string }) => (t.name === PRICE_BELIEFS.name ? beliefs : undefined),
    };
    const proc = moldGossipProcess(o);
    const out = proc.run({ truth, now: 100, rng: Rng.root(1), recent: [] } as never) as unknown as {
      changes: { value: { items: { rumor: unknown; hops: number; heardAt: number }[] } }[];
    };
    return { proc, out };
  };
  const clock = { day: 10 } as never;

  it("con fromPriceBeliefs guarda un price con el mercado visto; apagado, nada", () => {
    const on = run({ fromPriceBeliefs: { clock, marketOf: () => market } });
    expect(on.proc.reads).toContain(PRICE_BELIEFS.name);
    const item = on.out.changes[0]?.value.items[0];
    expect(item).toBeDefined();
    expect(item?.rumor).toEqual({ mold: "price", good: "rice", market, amount: 12.345679 });
    expect(item?.hops).toBe(0);
    expect(item?.heardAt).toBe(30);
    expect(run({}).out.changes).toHaveLength(0);
    expect(
      run({ fromPriceBeliefs: { clock, marketOf: () => undefined } }).out.changes,
    ).toHaveLength(0);
  });

  it("con fromLooking, un look guarda un location de primera mano con la causa; apagado, nada", () => {
    const truth = {
      ids: (t: { name: string }) => (t.name === PERSON.name ? ["agent:a"] : []),
      get: (t: { name: string }) => (t.name === PERSON.name ? {} : undefined),
    };
    const where = { kind: "place", place: "place:cave" } as unknown as PlaceRef;
    const recent = [
      {
        id: "ev:1",
        tick: 90,
        actors: ["agent:a"],
        data: { effect: { kind: "observe", acuity: 0.3 } },
      },
    ];
    const go = (o: Parameters<typeof moldGossipProcess>[0]) =>
      moldGossipProcess(o).run({
        truth,
        now: 100,
        rng: Rng.root(1),
        recent,
      } as never) as unknown as {
        changes?: { value: { items: { rumor: unknown; cause?: string; heardAt: number }[] } }[];
      };
    const on = go({ fromLooking: { siteOf: () => ({ what: "cave", where }) } });
    const item = on.changes?.[0]?.value.items[0];
    expect(item?.rumor).toEqual({ mold: "location", what: "cave", where, vague: true });
    expect(item?.cause).toBe("ev:1");
    expect(item?.heardAt).toBe(90);
    expect(go({}).changes ?? []).toHaveLength(0);
  });
});

describe("compra desde lo oído barato", () => {
  const at = { beliefs: undefined, day: 0 };
  const book = { items: [heard(5, 1)] } as unknown as Parameters<typeof moldBuyGoods>[0];
  const o = { believedPerKg: () => 10, buyCandidates: true, goodName: () => "arroz" };

  it("propone el bien oído más barato que lo creído, solo con el opt-in", () => {
    expect(moldBuyGoods(book, o, at)).toEqual(["arroz"]);
    expect(moldBuyGoods(book, { ...o, buyCandidates: false }, at)).toEqual([]);
    expect(moldBuyGoods(book, o, undefined)).toEqual([]);
  });

  it("no propone lo oído más caro o igual, ni sin precio creído", () => {
    const dear = { items: [heard(15, 1)] } as unknown as Parameters<typeof moldBuyGoods>[0];
    expect(moldBuyGoods(dear, o, at)).toEqual([]);
    expect(moldBuyGoods(book, { ...o, believedPerKg: () => undefined }, at)).toEqual([]);
    expect(moldBuyGoods(undefined, o, at)).toEqual([]);
  });
});
