import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type CauseRef,
  externalAccount,
  type HolderRef,
  holderAccount,
  Ledger,
  ledgerUnit,
  loadContent,
  makeId,
  type PlaceRef,
  Rng,
} from "../../core/index.ts";
import { RecipeDef } from "../crafts/index.ts";
import { TRAITS } from "../family/index.ts";
import { draftEvent } from "../scheduler/index.ts";
import { SKILLS } from "../skills/index.ts";
import { LOCATION, type LocalMap } from "../world/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  type ActionDef,
  type ActionResolution,
  type AttemptActor,
  degreeOf,
  isMoney,
  legOf,
  PLANS,
  type ResolveInput,
  resolve,
} from "./index.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [ACTIONS, PLANS, SKILLS, TRAITS],
  [
    { kind: "actions", file: "content/actions/core.json", data: json("content/actions/core.json") },
    { kind: "skills", file: "content/skills/core.json", data: json("content/skills/core.json") },
    { kind: "traits", file: "content/traits/human.json", data: json("content/traits/human.json") },
    { kind: "plans", file: "content/plans/steal.json", data: json("content/plans/steal.json") },
  ],
);
const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));
const verb = (id: string) => catalog.verb(id) as ActionDef;

const me = makeId("agent", 1);
const wu = makeId("agent", 2);
const forestRef: PlaceRef = { kind: "place", place: makeId("place", 1) };
const intent: CauseRef[] = [{ kind: "event", event: makeId("event", 9) }];

/** Dos filas de seis hexes: cada uno toca a sus vecinos de fila y al de la otra fila. */
const W = 6;
const map: LocalMap = {
  cell: makeId("cell", 1),
  lonDeg: 0,
  climate: {
    cell: "c:0",
    latDeg: 40,
    axialTiltDeg: 23.4,
    annualMeanC: 12,
    seasonalRangeC: 20,
    annualPrecipMm: 700,
    windEast: 1,
    windNorth: 0,
  },
  neighbors: Array.from({ length: 2 * W }, (_, h) => {
    const row = Math.floor(h / W);
    const col = h % W;
    const out: number[] = [];
    if (col > 0) out.push(h - 1);
    if (col < W - 1) out.push(h + 1);
    out.push(row === 0 ? h + W : h - W);
    return out.sort((a, b) => a - b);
  }),
  crossSeconds: Array.from({ length: 2 * W }, () => 600),
  forest: Array.from({ length: 2 * W }, () => false),
};

const forage = ledgerUnit("good:forage");
const coin = ledgerUnit("coin");
const jade = ledgerUnit("good:jade_pendant");
const config = { externals: { seed: [forage, coin, jade] } };

function ledgerWith(
  rows: { holder: HolderRef; unit: ReturnType<typeof ledgerUnit>; amount: number }[],
) {
  const ledger = new Ledger(config);
  rows.forEach((r, i) => {
    ledger.post({
      tick: 0,
      eventId: makeId("event", i + 1),
      transfers: [
        {
          unit: r.unit,
          from: externalAccount("seed"),
          to: holderAccount(r.holder),
          amount: r.amount,
        },
      ],
    });
  });
  return ledger;
}

const actor = (extra: Partial<AttemptActor> = {}): AttemptActor => ({
  id: me,
  z: {},
  capabilities: {},
  hex: 0,
  ...extra,
});

function input(
  verbId: string,
  node: Partial<ResolveInput["node"]> = {},
  extra: Partial<ResolveInput> = {},
): ResolveInput {
  return {
    def: verb(verbId),
    node: { kind: "do", verb: verbId, args: [], manner: [], ...node },
    planManner: [],
    actor: actor(),
    parties: {},
    scene: { light: 1, terrain: 0, placeKinds: ["village"] },
    tick: 1000,
    rng: Rng.root(7),
    map,
    ledger: new Ledger(config),
    place: forestRef,
    causes: intent,
    ...extra,
  };
}

const many = (n: number, f: (i: number) => ResolveInput): ActionResolution[] =>
  Array.from({ length: n }, (_, i) => resolve({ ...f(i), tick: i }));

/** Aplica los asientos de una resolución al ledger, como el scheduler. */
function post(ledger: Ledger, r: ActionResolution, n: number) {
  for (const p of r.postings) {
    expect(p.event).toBe(draftEvent(0));
    ledger.post({ tick: n, eventId: makeId("event", 100 + n), transfers: p.transfers });
  }
}

describe("grado", () => {
  it("crece con el margen, vale 0,5 en el medio y 0 si no se pudo empezar", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -8, max: 8, noNaN: true }),
        fc.double({ min: 0, max: 4, noNaN: true }),
        (m, d) => {
          expect(degreeOf(m + d)).toBeGreaterThanOrEqual(degreeOf(m));
          expect(degreeOf(m)).toBeGreaterThan(0);
          expect(degreeOf(m)).toBeLessThan(1);
        },
      ),
    );
    expect(degreeOf(0)).toBeCloseTo(0.5, 10);
    expect(degreeOf(null)).toBe(0);
  });

  it("la plata se distingue de los bienes por la unidad", () => {
    expect([coin, ledgerUnit("coin:copper"), forage].map(isMoney)).toEqual([true, true, false]);
  });
});

describe("resolución", () => {
  it("es determinista y siempre trae causas, evento y emisiones acotadas", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1e6 }),
        fc.integer({ min: 0, max: 1e9 }),
        fc.constantFrom(
          "move",
          "look",
          "gather",
          "work",
          "speak",
          "strike",
          "trade",
          "take",
          "rest",
        ),
        (seed, tick, v) => {
          const i = input(v, v === "take" ? { args: [{ role: "from", entity: wu }] } : {}, {
            rng: Rng.root(seed),
            tick,
            destination: 5,
            scene: { light: 0.4, terrain: 0.5, placeKinds: ["forest"] },
            parties: v === "take" ? { from: { id: wu, z: {}, hex: 0 } } : {},
            ledger: ledgerWith([
              { holder: forestRef, unit: forage, amount: 5000 },
              { holder: wu, unit: coin, amount: 30 },
            ]),
          });
          const a = resolve(i);
          expect(resolve(i)).toEqual(a);
          const [event] = a.events;
          expect(event?.kind).toBe(`action.${v}`);
          expect(event?.causes).toEqual(intent);
          expect(event?.actors[0]).toBe(me);
          for (const x of [a.emissions.sight, a.emissions.sound, a.degree]) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(1);
          }
          expect(a.seconds).toBeGreaterThan(0);
        },
      ),
    );
  });

  it("un paso sin causas es un error", () => {
    expect(() => resolve(input("rest", {}, { causes: [] }))).toThrow(/sin causas/);
  });
});

describe("moverse", () => {
  const go = (extra: Partial<ResolveInput>) =>
    input(
      "move",
      { args: [{ role: "to", entity: makeId("place", 3) }] },
      { destination: 5, ...extra },
    );

  it("de día camina un tramo, cambia la ubicación y tarda lo del tramo o un poco más", () => {
    const rs = many(200, () => go({}));
    const ok = rs.filter((r) => r.outcome === "success" || r.outcome === "critical");
    expect(ok.length).toBeGreaterThan(100);
    for (const r of ok) {
      // 600 s por hex y tramos de 1800 s: tres hexes de los cinco.
      expect(r.effect).toMatchObject({ kind: "move", from: 0, to: 5, reached: 3, onTheWay: true });
      expect(r.changes).toEqual([{ op: "set", table: LOCATION.name, id: me, value: { hex: 3 } }]);
      expect(r.seconds).toBeGreaterThanOrEqual(3 * 600);
      expect(r.seconds).toBeLessThanOrEqual(3 * 600 * 1.3);
    }
  });

  it("los tramos siguen desde donde quedó y suman el camino entero", () => {
    let hex = 0;
    let total = 0;
    for (let leg = 0; leg < 5 && hex !== 5; leg++) {
      const r = resolve(go({ actor: actor({ hex }) }));
      if (r.effect.kind !== "move" || r.effect.reached === null) throw new Error("no es move");
      expect(r.effect.reached).not.toBe(hex);
      hex = r.effect.reached;
      total += r.seconds;
      expect(r.effect.onTheWay === true).toBe(hex !== 5);
    }
    expect(hex).toBe(5);
    expect(total).toBeGreaterThanOrEqual(5 * 600);
  });

  it("un tramo a medias puede torcer el rumbo sin que el caminante lo note", () => {
    const rs = many(600, () => go({}));
    const veered = rs.filter((r) => r.effect.kind === "move" && r.effect.believedAt !== undefined);
    expect(veered.length).toBeGreaterThan(0);
    for (const r of veered) {
      if (r.effect.kind !== "move" || r.self.effect.kind !== "move") throw new Error("no es move");
      expect(r.effect.reached).not.toBe(r.effect.believedAt);
      expect(r.effect.onTheWay).toBe(true);
      // Cree estar donde iba; la ubicación real es donde quedó.
      expect(r.self.effect.reached).toBe(r.effect.believedAt);
      expect(r.changes).toEqual([
        { op: "set", table: LOCATION.name, id: me, value: { hex: r.effect.reached } },
      ]);
    }
    // Un tramo bien hecho nunca se tuerce.
    const good = rs.filter((r) => r.outcome === "success" || r.outcome === "critical");
    expect(good.every((r) => r.effect.kind === "move" && r.effect.believedAt === undefined)).toBe(
      true,
    );
  });

  it("un tramo tiene al menos un hex aunque pase de la media hora", () => {
    const slow = { ...map, crossSeconds: map.crossSeconds.map(() => 9000) };
    expect(legOf(slow, [1, 2, 3])).toEqual([1]);
    expect(legOf(map, [])).toEqual([]);
  });

  it("con barro o nieve el tramo abarca menos hexes", () => {
    const flat = { ...map, crossSeconds: map.crossSeconds.map(() => 600) };
    expect(legOf(flat, [1, 2, 3, 4, 5])).toHaveLength(3);
    expect(legOf(flat, [1, 2, 3, 4, 5], 1.5)).toHaveLength(2);
  });

  it("de noche se pierde: queda en otro hex, y no sabe en cuál", () => {
    const rs = many(400, () => go({ scene: { light: 0, terrain: 0, placeKinds: [] } }));
    const lost = rs.filter(
      (r) => r.failure === "lost" && r.attempt.margin !== null && r.attempt.margin < -0.5,
    );
    expect(lost.length).toBeGreaterThan(20);
    for (const r of lost) {
      if (r.effect.kind !== "move") throw new Error("no es move");
      expect(r.effect.reached).not.toBe(5);
      expect(r.changes.length === 0).toBe(r.effect.reached === 0);
      if (r.self.effect.kind !== "move") throw new Error("no es move");
      // lo notó: no sabe dónde está; no lo notó: cree que llegó
      expect(r.self.effect.reached).toBe(r.outcome === "failure_unnoticed" ? 5 : null);
    }
  });

  it("en terreno malo se cae a mitad de camino y sabe dónde quedó", () => {
    const rs = many(400, () => go({ scene: { light: 1, terrain: 1, placeKinds: [] } }));
    const fell = rs.filter((r) => r.failure === "slip" && r.outcome === "failure");
    expect(fell.length).toBeGreaterThan(10);
    for (const r of fell) {
      expect(r.effect).toMatchObject({ reached: 1, stumbled: true });
      expect(r.self.effect).toEqual(r.effect);
    }
  });

  it("sin piernas no sale y tarda lo que tarda en darse cuenta", () => {
    const r = resolve(go({ actor: actor({ capabilities: { locomotion: 0.05 } }) }));
    expect(r.failure).toBe("too_weak");
    expect(r.changes).toEqual([]);
    expect(r.seconds).toBe(Math.min(5 * 600, verb("move").checkpoint));
    expect(r.emissions.sight).toBeLessThan(verb("move").emissions.sight);
  });
});

describe("recolectar", () => {
  const forest = { light: 1, terrain: 0, placeKinds: ["forest" as const] };

  it("rinde con el grado y sale del stock del lugar, sin crear nada", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 1, max: 1e6 }),
        (stock, seed) => {
          const ledger = ledgerWith(
            stock > 0 ? [{ holder: forestRef, unit: forage, amount: stock }] : [],
          );
          const total = ledger.total(forage);
          let left = stock;
          for (let n = 0; n < 6; n++) {
            const r = resolve(
              input("gather", {}, { scene: forest, ledger, rng: Rng.root(seed), tick: n }),
            );
            if (r.effect.kind !== "gather") throw new Error("no es gather");
            expect(r.effect.amount).toBeLessThanOrEqual(left);
            expect(r.self.effect).toEqual(r.effect);
            if (r.effect.amount === 0) expect(r.failure).toBe("poor_yield");
            post(ledger, r, n);
            left -= r.effect.amount;
            expect(ledger.balance(holderAccount(forestRef), forage)).toBe(left);
          }
          expect(ledger.total(forage)).toBe(total);
          expect(ledger.audit()).toEqual([]);
        },
      ),
    );
  });

  it("mejor tirada, más rinde", () => {
    const ledger = ledgerWith([{ holder: forestRef, unit: forage, amount: 1e7 }]);
    const rs = many(300, () => input("gather", {}, { scene: forest, ledger }));
    const amount = (r: ActionResolution) => (r.effect.kind === "gather" ? r.effect.amount : 0);
    const sorted = rs
      .filter((r) => r.attempt.margin !== null)
      .sort((a, b) => (a.attempt.margin as number) - (b.attempt.margin as number));
    const low = sorted.slice(0, 50).reduce((s, r) => s + amount(r), 0);
    const high = sorted.slice(-50).reduce((s, r) => s + amount(r), 0);
    expect(high).toBeGreaterThan(low * 2);
  });

  it("donde no hay qué sacar, no saca", () => {
    const r = resolve(input("gather", {}, { scene: forest }));
    expect(r.effect).toMatchObject({ amount: 0 });
    expect(r.postings).toEqual([]);
    expect(r.failure).toBe("poor_yield");
  });
});

describe("tomar", () => {
  const steal = (extra: Partial<ResolveInput> = {}, what?: string) =>
    input(
      "take",
      {
        args: [{ role: "from", entity: wu }, ...(what ? [{ role: "what", text: what }] : [])],
        manner: ["covert"],
      },
      {
        parties: { from: { id: wu, z: {}, hex: 0 } },
        ledger: ledgerWith([
          { holder: wu, unit: coin, amount: 40 },
          { holder: wu, unit: jade, amount: 1 },
        ]),
        ...extra,
      },
    );

  it("pasa lo tomado del otro al actor, con lo que nombró o lo que más hay", () => {
    const rs = many(300, () => steal());
    const ok = rs.find((r) => r.outcome === "success");
    expect(ok?.effect).toMatchObject({
      kind: "take",
      from: wu,
      wanted: coin,
      got: [{ unit: coin, amount: 40 }],
    });
    expect(ok?.postings[0]?.transfers).toEqual([
      { unit: coin, from: holderAccount(wu), to: holderAccount(me), amount: 40 },
    ]);
    const named = resolve(steal({}, "el colgante de jade"));
    expect(named.effect).toMatchObject({ wanted: jade });
  });

  it("lo que pasa de mano se conserva y nunca deja al otro en negativo", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1e6 }),
        fc.integer({ min: 0, max: 1e6 }),
        (seed, tick) => {
          const i = steal({
            rng: Rng.root(seed),
            tick,
            scene: { light: 0.2, terrain: 0, placeKinds: [] },
          });
          const ledger = i.ledger as Ledger;
          const r = resolve(i);
          post(ledger, r, 0);
          expect(ledger.total(coin)).toBe(40);
          expect(ledger.total(jade)).toBe(1);
          expect(ledger.audit()).toEqual([]);
          if (r.effect.kind !== "take") throw new Error("no es take");
          const got = r.effect.got.reduce((s, g) => s + g.amount, 0);
          if (r.outcome === "partial") expect(got).toBeLessThanOrEqual(40);
        },
      ),
    );
  });

  it("a oscuras a veces agarra otra cosa, y un desastre lo deja descubierto", () => {
    const rs = many(600, () => steal({ scene: { light: 0, terrain: 0, placeKinds: [] } }));
    const wrong = rs.filter(
      (r) => r.failure === "wrong_target" && r.attempt.margin !== null && r.attempt.margin < -0.5,
    );
    expect(wrong.length).toBeGreaterThan(5);
    for (const r of wrong) expect(r.effect).toMatchObject({ got: [{ unit: jade, amount: 1 }] });
    const disaster = rs.filter((r) => r.attempt.margin !== null && r.attempt.margin <= -2.5);
    for (const r of disaster) expect(r.events[0]?.data).toMatchObject({ noticedBy: [wu] });
  });
});

describe("buscar, pegar, hablar, trabajar", () => {
  it("buscar a quien no está falla con forma y el actor lo sabe", () => {
    const r = resolve(
      input(
        "search",
        { args: [{ role: "target", entity: wu }] },
        { parties: { target: { id: wu, z: {}, hex: 4 } } },
      ),
    );
    expect(r).toMatchObject({ outcome: "failure", failure: "not_here" });
    expect(r.self).toMatchObject({ believed: "failure", effect: { present: false, found: false } });
  });

  it("si no lo encuentra estando ahí, cree que no está", () => {
    const rs = many(300, () =>
      input(
        "search",
        { args: [{ role: "target", entity: wu }] },
        {
          parties: { target: { id: wu, z: {}, hex: 0 } },
          scene: { light: 0.1, terrain: 0, placeKinds: [] },
        },
      ),
    );
    const missed = rs.filter(
      (r) =>
        r.effect.kind === "search" &&
        !r.effect.found &&
        !r.effect.glimpsed &&
        r.outcome !== "failure_unnoticed",
    );
    expect(missed.length).toBeGreaterThan(0);
    for (const r of missed) {
      expect(r.effect).toMatchObject({ present: true });
      expect(r.self.effect).toMatchObject({ present: false });
    }
  });

  it("pegar: un roce es más débil que un golpe limpio, y un golpe suena", () => {
    const rs = many(400, () =>
      input(
        "strike",
        { args: [{ role: "target", entity: wu }] },
        { parties: { target: { id: wu, z: {}, hex: 0 } } },
      ),
    );
    const force = (r: ActionResolution) => (r.effect.kind === "strike" ? r.effect.force : -1);
    const clean = rs.filter(
      (r) => r.effect.kind === "strike" && r.effect.hit && !r.effect.glancing,
    );
    const glance = rs.filter((r) => r.effect.kind === "strike" && r.effect.glancing);
    expect(clean.length).toBeGreaterThan(0);
    expect(glance.length).toBeGreaterThan(0);
    expect(Math.min(...clean.map(force))).toBeGreaterThan(Math.max(...glance.map(force)));
    const miss = rs.filter((r) => r.effect.kind === "strike" && !r.effect.hit);
    for (const r of miss) expect(force(r)).toBe(0);
    if (miss[0] && clean[0])
      expect(clean[0].emissions.sound).toBeGreaterThan(miss[0].emissions.sound);
  });

  it("hablar: la claridad sigue al grado; trabajar rinde según la tirada", () => {
    const talk = resolve(
      input(
        "speak",
        {
          args: [
            { role: "to", entity: wu },
            { role: "content", text: "hola" },
          ],
        },
        { parties: { to: { id: wu, z: {}, hex: 0 } } },
      ),
    );
    if (talk.effect.kind !== "speak") throw new Error("no es speak");
    if (talk.effect.delivered) expect(talk.effect.clarity).toBe(talk.degree);
    expect(talk.effect.text).toBe("hola");

    const fields = { light: 1, terrain: 0, placeKinds: ["fields" as const] };
    const rs = many(200, () =>
      input("work", { args: [{ role: "for", seconds: 3600 }] }, { scene: fields }),
    );
    for (const r of rs) {
      if (r.effect.kind !== "work") throw new Error("no es work");
      expect(r.effect.effectiveSeconds).toBeLessThanOrEqual(1.5 * r.seconds);
      expect(r.effect.effectiveSeconds).toBe(Math.round(r.seconds * Math.min(1.5, 2 * r.degree)));
    }
  });

  it("lo que no notó que le salió mal lo cree bien: la verdad y lo creído se separan", () => {
    const rs = many(600, () =>
      input(
        "speak",
        {
          args: [
            { role: "to", entity: wu },
            { role: "content", text: "te debo" },
          ],
        },
        { parties: { to: { id: wu, z: {}, hex: 0 } }, actor: actor({ z: { sociability: -1.5 } }) },
      ),
    );
    const fooled = rs.filter((r) => r.outcome === "failure_unnoticed");
    expect(fooled.length).toBeGreaterThan(0);
    for (const r of fooled) {
      expect(r.self.believed).toBe("success");
      if (r.effect.kind !== "speak" || r.self.effect.kind !== "speak")
        throw new Error("no es speak");
      expect(r.self.effect.delivered).toBe(true);
      expect(r.self.effect.clarity).toBeGreaterThan(r.effect.clarity);
    }
  });
});

describe("comer, beber, curar", () => {
  const grain = ledgerUnit("good:grain");
  const house = makeId("household", 1);
  const foods = new Map([
    [grain, { kcalPerGram: 3.4, waterPerGram: 0.12 }],
    [forage, { kcalPerGram: 0.6, waterPerGram: 0.8 }],
  ]);
  const eatConfig = { externals: { seed: [forage, grain, coin], eaten: [forage, grain] } };
  const stocked = (rows: { holder: HolderRef; unit: typeof grain; amount: number }[]) => {
    const ledger = new Ledger(eatConfig);
    rows.forEach((r, i) => {
      ledger.post({
        tick: 0,
        eventId: makeId("event", i + 1),
        transfers: [
          {
            unit: r.unit,
            from: externalAccount("seed"),
            to: holderAccount(r.holder),
            amount: r.amount,
          },
        ],
      });
    });
    return ledger;
  };

  it("come lo que lleva encima antes que la despensa, y lo comido sale del ledger", () => {
    const ledger = stocked([
      { holder: me, unit: forage, amount: 300 },
      { holder: house, unit: grain, amount: 5000 },
    ]);
    const r = resolve(input("eat", {}, { foods, larder: house, ledger }));
    expect(r.effect).toMatchObject({ kind: "eat", good: forage, from: me, grams: 300 });
    if (r.effect.kind !== "eat") throw new Error("no es eat");
    expect(r.effect.kcal).toBe(180);
    post(ledger, r, 1);
    expect(ledger.audit()).toEqual([]);
    expect(ledger.balance(externalAccount("eaten"), forage)).toBe(300);
  });

  it("sin nada propio come de la despensa una comida, no todo", () => {
    const ledger = stocked([{ holder: house, unit: grain, amount: 5000 }]);
    const r = resolve(input("eat", {}, { foods, larder: house, ledger }));
    if (r.effect.kind !== "eat") throw new Error("no es eat");
    expect(r.effect.from).toBe(house);
    expect(r.effect.grams).toBe(Math.ceil(800 / 3.4));
    expect(r.postings[0]?.transfers[0]).toMatchObject({
      from: holderAccount(house),
      to: externalAccount("eaten"),
    });
  });

  it("sin comida falla por falta de medios y no mueve nada", () => {
    const r = resolve(input("eat", {}, { foods, larder: house, ledger: stocked([]) }));
    expect(r.outcome).toBe("failure");
    expect(r.failure).toBe("no_means");
    expect(r.postings).toEqual([]);
  });

  it("beber da agua; curar sin objetivo es curarse, y bien hecho cuida con el grado", () => {
    const d = resolve(input("drink"));
    expect(d.effect).toEqual({ kind: "drink", liters: 0.75 });
    const rs = many(200, () => input("tend"));
    for (const r of rs) {
      if (r.effect.kind !== "tend") throw new Error("no es tend");
      expect(r.effect.target).toBe(me);
      expect(r.effect.care).toBe(r.effect.done ? r.degree : 0);
    }
    expect(rs.some((r) => r.effect.kind === "tend" && r.effect.done)).toBe(true);
  });
});

describe("comerciar y cosechar", () => {
  const grain = ledgerUnit("good:grain");
  const copper = ledgerUnit("coin:copper");
  const mine = makeId("household", 1);
  const theirs = makeId("household", 2);
  const foods = new Map([[grain, { kcalPerGram: 3.4, waterPerGram: 0.12 }]]);
  const market = {
    priceCopperPerKg: new Map([[grain, 6]]),
    ownMembers: 3,
    other: { larder: theirs as unknown as HolderRef, members: 4 },
    harvestGramsPerHour: 150,
    harvestGood: grain,
  };
  const tradeConfig = { externals: { seed: [grain, copper], harvest: [grain] } };
  const stock = (rows: { holder: HolderRef; unit: typeof grain; amount: number }[]) => {
    const ledger = new Ledger(tradeConfig);
    rows
      .filter((r) => r.amount > 0)
      .forEach((r, i) => {
        ledger.post({
          tick: 0,
          eventId: makeId("event", i + 1),
          transfers: [
            {
              unit: r.unit,
              from: externalAccount("seed"),
              to: holderAccount(r.holder),
              amount: r.amount,
            },
          ],
        });
      });
    return ledger;
  };
  const trading = (ledger: Ledger, what: string | null = null, extra: Partial<ResolveInput> = {}) =>
    input(
      "trade",
      {
        args: [
          { role: "with", entity: wu },
          ...(what === null ? [] : [{ role: "what", text: what } as const]),
        ],
      },
      {
        actor: actor({ capabilities: { speech: 1 } }),
        parties: { with: { id: wu, z: {}, hex: 0, skill: 0 } },
        ledger,
        foods,
        larder: mine as unknown as HolderRef,
        market,
        ...extra,
      },
    );

  it("comprar mueve grano de la despensa del otro y monedas al otro, sin crear nada", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 1, max: 30 }),
        (coins, kilos) => {
          const ledger = stock([
            { holder: theirs as unknown as HolderRef, unit: grain, amount: 600_000 },
            { holder: me, unit: copper, amount: coins },
          ]);
          const before = ledger.total(copper);
          for (const r of many(40, () => trading(ledger, `${kilos} kilos`))) {
            if (r.effect.kind !== "trade" || r.effect.direction !== "buy") continue;
            expect(r.effect.grams).toBeLessThanOrEqual(kilos * 1000);
            expect(r.effect.coins).toBeLessThanOrEqual(coins);
            // El vendedor no se queda sin los 60 días de comida de su casa.
            expect(600_000 - r.effect.grams).toBeGreaterThanOrEqual((60 * 2400 * 4) / 3.4 - 1);
            const copy = stock([
              { holder: theirs as unknown as HolderRef, unit: grain, amount: 600_000 },
              { holder: me, unit: copper, amount: coins },
            ]);
            post(copy, r, 1);
            expect(copy.audit()).toEqual([]);
            expect(copy.total(copper)).toBe(before);
            expect(copy.balance(holderAccount(me), grain)).toBe(r.effect.grams);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it("con monedas y un vecino con sobra, comprar cierra tratos de verdad", () => {
    const ledger = stock([
      { holder: theirs as unknown as HolderRef, unit: grain, amount: 600_000 },
      { holder: me, unit: copper, amount: 50 },
    ]);
    const deals = many(80, () => trading(ledger, "5 kilos")).filter(
      (r) => r.effect.kind === "trade" && r.effect.direction === "buy",
    );
    expect(deals.length).toBeGreaterThan(0);
  });

  it("lo que el jugador nombra en su lengua elige el bien: «grano» es good:grain aunque haya más forraje", () => {
    const forage = ledgerUnit("good:forage");
    const names = new Map([
      [grain, "grano de la cosecha"],
      [forage, "frutos y raíces del monte"],
    ]);
    const both = {
      ...tradeConfig,
      externals: { ...tradeConfig.externals, seed: [grain, forage, copper] },
    };
    const rich = () => {
      const ledger = new Ledger(both);
      [
        { holder: theirs as unknown as HolderRef, unit: grain, amount: 600_000 },
        { holder: theirs as unknown as HolderRef, unit: forage, amount: 900_000 },
        { holder: me, unit: copper, amount: 50 },
      ].forEach((r, i) => {
        ledger.post({
          tick: 0,
          eventId: makeId("event", i + 1),
          transfers: [
            {
              unit: r.unit,
              from: externalAccount("seed"),
              to: holderAccount(r.holder),
              amount: r.amount,
            },
          ],
        });
      });
      return ledger;
    };
    const wide = {
      ...market,
      priceCopperPerKg: new Map([
        [grain, 6],
        [forage, 2],
      ]),
    };
    const goods = (what: string) =>
      many(80, () => trading(rich(), what, { market: wide, unitNames: names })).flatMap((r) =>
        r.effect.kind === "trade" && r.effect.direction === "buy" ? [r.effect] : [],
      );
    const byName = goods("2 kilos de grano");
    expect(byName.length).toBeGreaterThan(0);
    for (const e of byName) {
      expect(e.good).toBe(grain);
      expect(e.grams).toBeLessThanOrEqual(2000);
    }
    const forageDeals = goods("frutos del monte");
    expect(forageDeals.length).toBeGreaterThan(0);
    for (const e of forageDeals) expect(e.good).toBe(forage);
  });

  it("sin monedas o sin nada que vender no hay trato: falla por falta de medios", () => {
    const poor = stock([{ holder: theirs as unknown as HolderRef, unit: grain, amount: 600_000 }]);
    const none = stock([{ holder: me, unit: copper, amount: 50 }]);
    for (const ledger of [poor, none]) {
      for (const r of many(60, () => trading(ledger))) {
        expect(r.postings).toEqual([]);
        if (r.effect.kind === "trade") expect(r.effect.grams).toBe(0);
      }
    }
  });

  it("nadie vende lo que necesita para comer los próximos meses", () => {
    const tight = stock([
      { holder: theirs as unknown as HolderRef, unit: grain, amount: 100_000 },
      { holder: me, unit: copper, amount: 50 },
    ]);
    for (const r of many(60, () => trading(tight))) expect(r.postings).toEqual([]);
  });

  it("guardar pasa lo que lleva a la despensa de la casa, sin crear ni perder nada", () => {
    const storing = (what: string | null, ledger: Ledger) =>
      input(
        "store",
        { args: what === null ? [] : [{ role: "what", text: what }] },
        {
          actor: actor({ capabilities: { manipulation: 1 } }),
          ledger,
          larder: mine as unknown as HolderRef,
          unitNames: new Map([[grain, "grano de la cosecha"]]),
        },
      );
    const ledger = stock([
      { holder: me, unit: grain, amount: 4000 },
      { holder: me, unit: copper, amount: 12 },
    ]);
    const r = resolve(storing("el grano", ledger));
    expect(r.effect).toMatchObject({ kind: "store" });
    post(ledger, r, 1);
    expect(ledger.audit()).toEqual([]);
    expect(ledger.balance(holderAccount(me), grain)).toBe(0);
    expect(ledger.balance(holderAccount(mine as unknown as HolderRef), grain)).toBe(4000);
    // La plata no se guarda como si fuera un bien: sigue en el bolsillo.
    expect(ledger.balance(holderAccount(me), copper)).toBe(12);
  });

  it("guardar sin nada encima falla por falta de medios y no mueve nada", () => {
    const ledger = stock([{ holder: me, unit: copper, amount: 12 }]);
    const r = resolve(
      input(
        "store",
        {},
        {
          actor: actor({ capabilities: { manipulation: 1 } }),
          ledger,
          larder: mine as unknown as HolderRef,
        },
      ),
    );
    expect(r.postings).toEqual([]);
    expect(r.failure).toBe("no_means");
  });

  it("trabajar el campo rinde grano de afuera del ledger y queda en el bolsillo", () => {
    const ledger = stock([]);
    const rs = many(60, () =>
      input(
        "work",
        {},
        {
          actor: actor({ capabilities: { strength: 1 } }),
          scene: { light: 1, terrain: 0, placeKinds: ["fields"] },
          ledger,
          market,
        },
      ),
    );
    const paid = rs.filter((r) => r.postings.length > 0);
    expect(paid.length).toBeGreaterThan(0);
    for (const r of paid) {
      expect(r.postings[0]?.transfers[0]).toMatchObject({
        from: externalAccount("harvest"),
        to: holderAccount(me),
        unit: grain,
      });
      post(ledger, r, 1);
    }
    expect(ledger.audit()).toEqual([]);
    expect(ledger.balance(holderAccount(me), grain)).toBeGreaterThan(0);
  });
});

describe("cocinar", () => {
  const grain = ledgerUnit("good:grain");
  const bread = ledgerUnit("good:flatbread");
  const house = makeId("household", 1) as unknown as HolderRef;
  const recipe = RecipeDef.parse({
    id: "flatbread",
    name: "pan plano",
    craft: "cooking",
    inputs: [{ good: "grain", grams: 400 }],
    output: { good: "flatbread", ratio: 1.3 },
    prepMinutes: 20,
    heat: { target: 220, minutes: 25, scorchAt: 280 },
  });
  const cookConfig = {
    externals: { seed: [grain, bread], cooked: [grain, bread] },
  };
  const stocked = (holder: HolderRef, amount: number) => {
    const ledger = new Ledger(cookConfig);
    ledger.post({
      tick: 0,
      eventId: makeId("event", 1),
      transfers: [
        { unit: grain, from: externalAccount("seed"), to: holderAccount(holder), amount },
      ],
    });
    return ledger;
  };
  const cooking = (ledger: Ledger, skill = 0.5) =>
    input(
      "cook",
      { args: [{ role: "what", text: "pan" }] },
      {
        actor: actor({ capabilities: { manipulation: 1 }, skill }),
        ledger,
        larder: house,
        recipes: [recipe],
      },
    );

  it("gasta los insumos de la despensa y deja el pan ahí, sin crear ni perder nada de más", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1e6 }),
        fc.integer({ min: 400, max: 5000 }),
        (seed, have) => {
          const ledger = stocked(house, have);
          const r = resolve({ ...cooking(ledger), rng: Rng.root(seed) });
          expect(r.effect).toMatchObject({ kind: "cook", recipe: "flatbread" });
          post(ledger, r, 1);
          expect(ledger.audit()).toEqual([]);
          expect(ledger.balance(holderAccount(house), grain)).toBe(have - 400);
          const eff = r.effect;
          if (eff.kind !== "cook") throw new Error("no cocinó");
          expect(ledger.balance(holderAccount(house), bread)).toBe(eff.grams);
          // El producto nunca pesa más que lo que la receta rinde.
          expect(eff.grams).toBeLessThanOrEqual(Math.floor(400 * recipe.output.ratio));
        },
      ),
      { numRuns: 40 },
    );
  });

  it("es determinista y el evento queda con la calidad y las causas", () => {
    const a = resolve(cooking(stocked(house, 1000)));
    const b = resolve(cooking(stocked(house, 1000)));
    expect(a).toEqual(b);
    expect(a.events[0]?.causes).toEqual(intent);
    expect(a.events[0]?.data).toMatchObject({ verb: "cook", effect: { kind: "cook" } });
  });

  it("sin insumos suficientes falla por falta de medios y no mueve nada", () => {
    const r = resolve(cooking(stocked(house, 50)));
    expect(r.postings).toEqual([]);
    expect(r.failure).toBe("no_means");
  });

  it("el cocinero juzga la calidad con sus sentidos: lo creído no es la verdad", () => {
    const rs = many(40, () => cooking(stocked(house, 1000), 0.05));
    const differs = rs.some(
      (r) =>
        r.effect.kind === "cook" &&
        r.self.effect.kind === "cook" &&
        r.self.effect.quality !== r.effect.quality,
    );
    expect(differs).toBe(true);
    for (const r of rs) {
      if (r.self.effect.kind === "cook") expect(r.self.effect.state).toBeNull();
    }
  });

  it("aprende de lo que le salió: el resultado sale de la sesión, no de la tirada", () => {
    const rs = many(40, () => cooking(stocked(house, 1000), 0.9));
    const good = rs.filter((r) => r.effect.kind === "cook" && r.effect.quality >= 0.7);
    expect(good.length).toBeGreaterThan(20);
    for (const r of good) expect(r.attempt.outcome).toBe(r.outcome);
  });
});
