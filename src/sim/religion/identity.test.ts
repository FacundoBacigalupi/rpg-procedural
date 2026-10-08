import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type EventId, Rng } from "../../core/index.ts";
import {
  type Affiliation,
  comfortOf,
  guiltAfter,
  NO_SANCTION,
  type ReligiousIdentity,
  sanctionWeight,
  seedAffiliation,
} from "./identity.ts";
import type { PracticeDef } from "./religion.ts";
import type { CommunityReligion } from "./seed.ts";

const ev = "event:1" as EventId;
const taboo: PracticeDef = {
  id: "no-first-sheaf",
  name: "t",
  kind: "taboo",
  goods: ["grain"],
  sanction: 0.5,
  believedEffect: "x",
  socialEffect: "y",
};
const wake: PracticeDef = {
  id: "wake",
  name: "w",
  kind: "rite",
  goods: [],
  sanction: 0,
  believedEffect: "x",
  socialEffect: "y",
};
const community: CommunityReligion = {
  religion: "village-folk",
  name: "n",
  kind: "folk",
  doctrines: [],
  sacredBeings: [],
  practices: [taboo, wake],
  adherence: { belonging: 0.98, belief: 0.7 },
  exclusive: false,
  because: "b",
  originEventId: ev,
};
const aff = (belief: number, belonging: number): Affiliation => ({
  religion: "village-folk",
  belief,
  practice: 0.5,
  belonging,
  outward: 0.5,
  learnedFrom: [],
  since: 0 as never,
  originEventId: ev,
});
const ident = (a: Affiliation): ReligiousIdentity => ({ affiliations: [a], doubts: [] });
const seed = (rng: Rng, parents: Affiliation[] = []) =>
  seedAffiliation(
    { religion: community, parents, learnedFrom: [], since: 0 as never, originEventId: ev },
    rng,
  );

describe("identidad religiosa por persona", () => {
  it("es determinista y cae cerca de la media de la comunidad", () => {
    expect(seed(Rng.root(3).fork("a"))).toEqual(seed(Rng.root(3).fork("a")));
    let belief = 0;
    for (let i = 0; i < 300; i++) belief += seed(Rng.root(i).fork("m")).belief;
    expect(belief / 300).toBeGreaterThan(0.6);
    expect(belief / 300).toBeLessThan(0.76);
  });

  it("los hijos siguen la fe de los padres", () => {
    let child = 0;
    for (let i = 0; i < 300; i++) child += seed(Rng.root(i).fork("h"), [aff(0.1, 0.9)]).belief;
    expect(child / 300).toBeLessThan(0.5);
  });

  it("quien pertenece sin creer muestra más de lo que cree (finge)", () => {
    const a = seed(Rng.root(1).fork("f"), [aff(0.05, 0.99)]);
    expect(a.outward).toBeGreaterThanOrEqual(a.practice);
  });

  it("todo queda en 0-1 y consume siempre los mismos sorteos", () => {
    fc.assert(
      fc.property(fc.integer(), fc.double({ min: 0, max: 1, noNaN: true }), (s, b) => {
        const a = seed(Rng.root(s).fork("p"), [aff(b, 1 - b)]);
        for (const x of [a.belief, a.practice, a.belonging, a.outward]) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1);
        }
        const r1 = Rng.root(s).fork("q");
        const r2 = Rng.root(s).fork("q");
        seed(r1);
        seed(r2, [aff(b, b)]);
        expect(r1.float()).toBe(r2.float());
      }),
    );
  });
});

describe("la sanción creída", () => {
  it("el creyente pesa romper el tabú más que el escéptico", () => {
    const fiel = sanctionWeight(ident(aff(1, 1)), community, "grain");
    const esceptico = sanctionWeight(ident(aff(0, 0.2)), community, "grain");
    expect(fiel.penalty).toBeGreaterThan(esceptico.penalty);
    expect(fiel.fear).toBe(0.5);
    expect(sanctionWeight(ident(aff(0, 0)), community, "grain").penalty).toBe(0);
  });

  it("sin identidad, sin tabú sobre el bien o sin religión no pesa nada", () => {
    expect(sanctionWeight(undefined, community, "grain")).toEqual(NO_SANCTION);
    expect(sanctionWeight(ident(aff(1, 1)), community, "iron")).toEqual(NO_SANCTION);
    expect(sanctionWeight(ident(aff(1, 1)), undefined, "grain")).toEqual(NO_SANCTION);
  });

  it("depende de la fe, no de la verdad: el peso no mira el estado del mundo", () => {
    // La función solo recibe la identidad y la comunidad: ningún WorldTruth entra.
    expect(sanctionWeight.length).toBe(3);
  });

  it("monótona en la creencia", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (b1, b2, bel) => {
          const [lo, hi] = b1 < b2 ? [b1, b2] : [b2, b1];
          const p = (b: number) => sanctionWeight(ident(aff(b, bel)), community, "grain").penalty;
          expect(p(hi)).toBeGreaterThanOrEqual(p(lo));
        },
      ),
    );
  });
});

describe("culpa y consuelo", () => {
  it("la culpa sigue al peso y crece si lo vieron; sin sanción no hay", () => {
    const w = sanctionWeight(ident(aff(0.8, 0.9)), community, "grain");
    expect(guiltAfter(w, true)).toBeGreaterThan(guiltAfter(w, false));
    expect(guiltAfter(w, false)).toBe(w.penalty);
    expect(guiltAfter(NO_SANCTION, true)).toBe(0);
  });

  it("el rito consuela al que pertenece aunque no crea, pero más al que cree", () => {
    const sinFe = comfortOf(wake, aff(0, 1));
    const conFe = comfortOf(wake, aff(1, 1));
    expect(sinFe).toBeGreaterThan(0);
    expect(conFe).toBeGreaterThan(sinFe);
    expect(comfortOf(wake, aff(0, 0))).toBe(0);
    expect(comfortOf(wake, undefined)).toBe(0);
  });

  it("el rito del duelo consuela más que mirar golondrinas", () => {
    const golondrinas = { ...wake, kind: "divination" as const };
    expect(comfortOf(wake, aff(0.7, 0.9))).toBeGreaterThan(comfortOf(golondrinas, aff(0.7, 0.9)));
  });
});
