import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { makeId, Rng } from "../../core/index.ts";
import { generateTastes, mentionableTastes, TasteDef, type TasteInput } from "./tastes.ts";

const def = (o: object) =>
  TasteDef.parse({
    id: "spicy",
    species: "human",
    domain: "food.flavor",
    name: "lo picante",
    ...o,
  });
const origin = makeId("event", 1);
const base = (o: Partial<TasteInput> = {}): TasteInput => ({
  innate: {},
  body: { sensitivities: {} },
  culture: { familiar: { spicy: 0.8, bitter: 0.8 } },
  exposure: {},
  origin,
  ...o,
});
const defs = [
  def({ temperament: { boldness: 0.8 }, body: { spice: -0.8 } }),
  def({ id: "bitter", name: "lo amargo", body: { bitter: -1 }, acquiredTaste: true }),
];
const find = (r: ReturnType<typeof generateTastes>, item: string) => r.find((p) => p.item === item);

describe("gustos básicos", () => {
  it("el temperamento audaz busca lo picante; el tímido lo evita", () => {
    const bold = generateTastes(defs, base({ innate: { boldness: 1 } }), Rng.root(1));
    const timid = generateTastes(defs, base({ innate: { boldness: -1 } }), Rng.root(1));
    expect(find(bold, "spicy")?.valence ?? 0).toBeGreaterThan(find(timid, "spicy")?.valence ?? 0);
  });

  it("el cuerpo sensible al picante lo rechaza", () => {
    const tender = generateTastes(
      defs,
      base({ body: { sensitivities: { spice: 1 } } }),
      Rng.root(2),
    );
    const tough = generateTastes(
      defs,
      base({ body: { sensitivities: { spice: 0 } } }),
      Rng.root(2),
    );
    expect(find(tender, "spicy")?.valence ?? 0).toBeLessThan(find(tough, "spicy")?.valence ?? 0);
  });

  it("lo que nunca conoció no entra; lo probado sí", () => {
    expect(generateTastes(defs, base({ culture: { familiar: {} } }), Rng.root(3))).toEqual([]);
    const tried = generateTastes(
      defs,
      base({
        culture: { familiar: {} },
        exposure: { spicy: { count: 12, outcome: 0.8, childhood: true } },
      }),
      Rng.root(3),
    );
    expect(tried.map((p) => p.item)).toEqual(["spicy"]);
  });

  it("el gusto adquirido se vuelve agrado con la repetición y se marca adquirido", () => {
    const body = { sensitivities: { bitter: 0.5 } };
    const first = generateTastes(defs, base({ body }), Rng.root(4));
    const used = generateTastes(
      defs,
      base({ body, exposure: { bitter: { count: 30, outcome: 0.6 } } }),
      Rng.root(4),
    );
    expect(find(used, "bitter")?.valence ?? 0).toBeGreaterThan(
      find(first, "bitter")?.valence ?? -1,
    );
    expect(find(used, "bitter")?.acquired).toBe(true);
  });

  it("lo que le hizo mal da asco y cita el evento", () => {
    const sick = makeId("event", 9);
    const r = generateTastes(
      defs,
      base({ exposure: { spicy: { count: 1, outcome: -1, events: [sick] } } }),
      Rng.root(5),
    );
    const p = find(r, "spicy");
    expect(p?.valence ?? 0).toBeLessThan(0);
    expect(p?.originEventIds).toEqual([sick]);
  });

  it("la comida de la infancia consuela", () => {
    const plain = generateTastes(
      defs,
      base({ exposure: { spicy: { count: 3, outcome: 0.2 } } }),
      Rng.root(6),
    );
    const home = generateTastes(
      defs,
      base({ exposure: { spicy: { count: 3, outcome: 0.2, childhood: true } } }),
      Rng.root(6),
    );
    expect(find(home, "spicy")?.valence ?? 0).toBeGreaterThan(find(plain, "spicy")?.valence ?? 0);
  });

  it("lo vedado por la cultura y la intolerancia empujan a la aversión", () => {
    const r = generateTastes(
      defs,
      base({
        culture: { familiar: { spicy: 0.2 }, forbidden: ["spicy"] },
        body: { sensitivities: {}, intolerances: ["spicy"] },
      }),
      Rng.root(7),
    );
    expect(find(r, "spicy")?.valence ?? 0).toBeLessThan(0);
  });

  it("es determinista y el catálogo nuevo no mueve los gustos viejos", () => {
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        const input = base({ innate: { boldness: 0.3, curiosity: -0.2 } });
        const a = generateTastes(defs, input, Rng.root(seed));
        const b = generateTastes(defs, input, Rng.root(seed));
        expect(a).toEqual(b);
        const more = generateTastes(
          [...defs, def({ id: "salty", name: "lo salado" })],
          base({
            innate: { boldness: 0.3, curiosity: -0.2 },
            culture: { familiar: { spicy: 0.8, bitter: 0.8, salty: 0.8 } },
          }),
          Rng.root(seed),
        );
        expect(find(more, "spicy")).toEqual(find(a, "spicy"));
        for (const p of a) {
          expect(Math.abs(p.valence)).toBeLessThanOrEqual(1);
          expect(p.strength).toBeGreaterThanOrEqual(0.12);
        }
      }),
    );
  });

  it("el narrador menciona los más fuertes con su postura", () => {
    const prefs = [
      {
        domain: "food.flavor",
        item: "spicy",
        valence: 0.9,
        strength: 0.8,
        originEventIds: [origin],
        acquired: false,
      },
      {
        domain: "food.flavor",
        item: "bitter",
        valence: -0.3,
        strength: 0.2,
        originEventIds: [origin],
        acquired: false,
      },
    ];
    const m = mentionableTastes(prefs, defs);
    expect(m).toEqual([
      { item: "spicy", domain: "food.flavor", name: "lo picante", stance: "loves" },
    ]);
  });
});

describe("gusto ligado a una persona", () => {
  const mother = makeId("agent", 7);
  const fed = (outcome: number) =>
    generateTastes(
      defs,
      base({
        innate: { boldness: 1 },
        exposure: { spicy: { count: 12, childhood: true, outcome, from: mother } },
      }),
      Rng.root(3),
    );

  it("lo bueno de la infancia queda ligado a quien lo dio, y la mención lo cita", () => {
    const p = find(fed(0.9), "spicy");
    expect(p?.about).toBe(mother);
    const [m] = mentionableTastes(p ? [p] : [], defs, 1, 0);
    expect(m?.about).toBe(mother);
  });

  it("lo que hizo mal no recuerda a nadie, y sin infancia tampoco", () => {
    expect(find(fed(-0.9), "spicy")?.about).toBeUndefined();
    const adult = generateTastes(
      defs,
      base({ exposure: { spicy: { count: 12, from: mother } } }),
      Rng.root(3),
    );
    expect(find(adult, "spicy")?.about).toBeUndefined();
  });
});
