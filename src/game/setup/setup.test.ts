import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../core/index.ts";
import {
  defaultGameSetup,
  EMPTY_NOVEL,
  type GameSetup,
  parseGameSetup,
  parseNewGameSetup,
  SetupError,
} from "./index.ts";

const opt = <T>(arb: fc.Arbitrary<T>) => fc.option(arb, { nil: undefined });
const id = fc.constantFrom("xianxia", "mysteries", "bronze-age", "qi.density");

/** Quita las claves con `undefined` (exactOptionalPropertyTypes y JSON). */
function clean<T extends object>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

const entry = fc.oneof(
  fc.record({ kind: fc.constant("born" as const), vignettesFrom: fc.integer({ min: 0, max: 20 }) }),
  fc.record({ kind: fc.constant("age" as const), at: fc.integer({ min: 0, max: 200 }) }),
);

const novel = fc
  .record({
    character: fc.record({
      species: opt(id),
      sex: opt(fc.constantFrom("female" as const, "male" as const)),
      name: opt(fc.constantFrom("Lin Feng", "Mei")),
      entryAge: opt(fc.integer({ min: 0, max: 100 })),
    }),
    goldenFingers: fc.constant<unknown[]>([]),
    rivals: opt(
      fc.record({
        count: fc.integer({ min: 0, max: 5 }),
        placement: fc.constantFrom(
          "anywhere" as const,
          "near" as const,
          "same_generation" as const,
        ),
        power: fc.constantFrom("weaker" as const, "similar" as const, "stronger" as const),
        knownToPlayer: fc.constant(false as const),
      }),
    ),
    life: fc.record({
      saves: fc.constantFrom("one_life" as const, "checkpoints" as const, "free" as const),
      deathOutcome: opt(fc.constantFrom("final" as const, "spirit_if_possible" as const)),
    }),
    narration: fc.record({
      tone: fc.constantFrom("realistic" as const, "novel" as const),
      systemMessages: opt(fc.constantFrom("bracketed" as const, "voice" as const, "none" as const)),
      chapterTitles: opt(fc.boolean()),
      revealPanels: opt(fc.boolean()),
    }),
    preset: opt(id),
  })
  .map(clean);

const setup: fc.Arbitrary<GameSetup> = fc
  .record({
    worldConstraints: opt(
      fc.record({
        family: opt(id),
        era: opt(id),
        axes: opt(fc.dictionary(id, fc.double({ min: 0, max: 1, noNaN: true }))),
      }),
    ),
    entry,
    novel: opt(novel),
  })
  .map(({ novel, ...rest }) =>
    clean(
      novel ? { ...rest, mode: "novel" as const, novel } : { ...rest, mode: "realistic" as const },
    ),
  );

describe("GameSetup", () => {
  it("acepta los setups válidos y sobreviven ida y vuelta por JSON (como en meta)", () => {
    fc.assert(
      fc.property(setup, (s) => {
        const parsed = parseGameSetup(s);
        expect(parsed).toEqual(s);
        expect(parseGameSetup(JSON.parse(canonicalJson(parsed)))).toEqual(parsed);
      }),
    );
  });

  it("los defaults de cada modo son válidos", () => {
    expect(parseGameSetup(defaultGameSetup())).toEqual({
      mode: "realistic",
      entry: { kind: "age", at: 16 },
    });
    expect(parseGameSetup(defaultGameSetup("novel")).novel).toEqual(EMPTY_NOVEL);
  });

  it("`novel` va si y solo si el modo es novela", () => {
    expect(() => parseGameSetup({ ...defaultGameSetup("realistic"), novel: EMPTY_NOVEL })).toThrow(
      /novel: el modo realista no lleva/,
    );
    expect(() => parseGameSetup({ mode: "novel", entry: { kind: "age", at: 16 } })).toThrow(
      /novel: el modo novela necesita/,
    );
  });

  it("rechaza lo que todavía no existe, con todos los problemas juntos", () => {
    const bad = {
      mode: "novel",
      entry: { kind: "born", vignettesFrom: -1 },
      novel: {
        ...EMPTY_NOVEL,
        character: { talent: { roots: ["fire"] } },
        goldenFingers: [{ kind: "reveal" }],
        rivals: { count: 1, placement: "near", power: "similar", knownToPlayer: true },
      },
    };
    try {
      parseGameSetup(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SetupError);
      const problems = (e as SetupError).problems.join("\n");
      expect(problems).toMatch(/entry\.vignettesFrom/);
      expect(problems).toMatch(/novel\.character: .*talent/);
      expect(problems).toMatch(/novel\.goldenFingers: los dedos de oro todavía no existen/);
      expect(problems).toMatch(/novel\.rivals\.knownToPlayer/);
    }
  });

  it("rechaza modos y campos desconocidos", () => {
    expect(() => parseGameSetup({ ...defaultGameSetup(), mode: "god" })).toThrow(SetupError);
    expect(() => parseGameSetup({ ...defaultGameSetup(), cheats: true })).toThrow(/cheats/);
    expect(() =>
      parseGameSetup({ ...defaultGameSetup(), worldConstraints: { axes: { qi: 2 } } }),
    ).toThrow(/worldConstraints\.axes\.qi/);
  });
});

describe("NewGameSetup", () => {
  it("es el setup con su seed", () => {
    const s = { seed: 42, ...defaultGameSetup("novel") };
    expect(parseNewGameSetup(s)).toEqual(s);
    expect(() => parseNewGameSetup({ ...s, seed: -1 })).toThrow(/seed/);
    expect(() => parseNewGameSetup({ ...s, mode: "realistic" })).toThrow(/novel/);
  });
});
