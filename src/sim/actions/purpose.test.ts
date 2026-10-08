import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, makeId, Rng } from "../../core/index.ts";
import {
  PURPOSES,
  type PurposeContext,
  type PurposeReader,
  parsePlan,
  purposeWeight,
  purposeWeights,
  readPurpose,
} from "./index.ts";

const agent = (n: number) => makeId("agent", n) as AgentId;
const take: PurposeContext = {
  verb: "take",
  tenure: "other",
  covert: true,
  onPerson: false,
  readerIsTarget: false,
};
const reader = (regard: number, suspicion: number): PurposeReader => ({
  id: agent(2),
  regard,
  suspicion,
});

function readRate(
  ctx: PurposeContext,
  r: PurposeReader,
  truth: "gift" | "theft",
  n: number,
  declared?: { motive: "gift" | "theft"; aplomb: number },
) {
  let hits = 0;
  for (let s = 0; s < n; s++) {
    const out = readPurpose(Rng.root(s), agent(1), { motive: truth }, ctx, r, 10, declared);
    if (out.guessed === "theft") hits++;
  }
  return hits / n;
}

describe("intención percibida", () => {
  it("el desconfiado ve robo más que quien quiere al actor", () => {
    const wary = readRate(take, reader(-0.5, 0.9), "gift", 400);
    const fond = readRate(take, reader(0.9, 0.0), "gift", 400);
    expect(wary).toBeGreaterThan(fond);
  });

  it("tomar lo ajeno a escondidas se lee como robo más que a la vista", () => {
    const hidden = purposeWeights(take, reader(0, 0.3));
    const open = purposeWeights({ ...take, covert: false }, reader(0, 0.3));
    expect(hidden.theft ?? 0).toBeGreaterThan(open.theft ?? 0);
  });

  it("una declaración con aplomo pasa más que una floja, y puede ser mentira", () => {
    const r = reader(0, 0.3);
    const firm = readRate(take, r, "theft", 400, { motive: "gift", aplomb: 0.95 });
    const weak = readRate(take, r, "theft", 400, { motive: "gift", aplomb: 0.1 });
    expect(firm).toBeLessThan(weak);
    let lies = 0;
    for (let seed = 0; seed < 200; seed++) {
      const out = readPurpose(
        Rng.root(seed),
        agent(1),
        { motive: "theft" },
        take,
        reader(0.9, 0),
        5,
        {
          motive: "gift",
          aplomb: 1,
        },
      );
      if (out.basis === "declared") {
        expect(out.mistaken).toBe(true);
        lies++;
      }
    }
    expect(lies).toBeGreaterThan(0);
  });

  it("el juicio cambia con el motivo creído y se atenúa con la duda", () => {
    expect(purposeWeight({ guessed: "theft", confidence: 1 })).toBeLessThan(
      purposeWeight({ guessed: "gift", confidence: 1 }),
    );
    expect(Math.abs(purposeWeight({ guessed: "theft", confidence: 0.1 }))).toBeLessThan(
      Math.abs(purposeWeight({ guessed: "theft", confidence: 1 })),
    );
  });

  it("determinismo y mistaken coherente con la verdad", () => {
    fc.assert(
      fc.property(
        fc.nat(),
        fc.constantFrom(...PURPOSES),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (seed, motive, regard, suspicion) => {
          const run = () =>
            readPurpose(Rng.root(seed), agent(1), { motive }, take, reader(regard, suspicion), 3);
          const a = run();
          expect(a).toEqual(run());
          expect(a.mistaken).toBe(a.guessed !== motive);
          expect(a.confidence).toBeGreaterThanOrEqual(0);
          expect(a.confidence).toBeLessThanOrEqual(1);
        },
      ),
    );
  });

  it("el plan guarda el porqué y lo valida", () => {
    const plan = parsePlan({
      actor: agent(1),
      source: "player",
      purpose: { motive: "gift", forWhom: agent(3) },
      root: { kind: "do", verb: "give", args: [], manner: [] },
      manner: [],
      causes: [],
    });
    expect(plan.purpose?.motive).toBe("gift");
    expect(() =>
      parsePlan({
        actor: agent(1),
        source: "player",
        purpose: { motive: "x" },
        root: { kind: "do", verb: "give", args: [], manner: [] },
        manner: [],
        causes: [],
      }),
    ).toThrow();
  });
});
