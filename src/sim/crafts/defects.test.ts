import { describe, expect, it } from "vitest";
import { correctionGain, defectsOf, noticedBy } from "./defects.ts";
import { RecipeDef } from "./recipe.ts";
import type { SessionResult } from "./session.ts";

const recipe = RecipeDef.parse({
  id: "flatbread",
  name: "pan plano",
  craft: "cooking",
  inputs: [{ good: "grain", grams: 400 }],
  output: { good: "flatbread", ratio: 1.3 },
  prepMinutes: 20,
  heat: { target: 220, minutes: 25, scorchAt: 280 },
});

const result = (over: Partial<SessionResult["work"]>, cookMinutes = 25): SessionResult => ({
  work: { temperature: 200, doneness: 1, scorch: 0, ...over },
  quality: 1,
  perceivedQuality: 1,
  yield: 1,
  seconds: 0,
  cookMinutes,
  corrections: 0,
});

describe("defectos de receta", () => {
  it("una tanda a punto no tiene defectos", () => {
    expect(defectsOf(recipe, result({}))).toEqual([]);
  });

  it("detecta crudo y quemado, del más grave al menos", () => {
    const d = defectsOf(recipe, result({ doneness: 0.5, scorch: 0.2 }));
    expect(d.map((x) => x.kind)).toEqual(["raw", "scorched"]);
  });

  it("buenos sentidos notan más que malos", () => {
    const d = defectsOf(recipe, result({ doneness: 0.8 }));
    const sharp = noticedBy(d, { control: 1, senses: 1, judgment: 1 });
    const dull = noticedBy(d, { control: 1, senses: 0, judgment: 1 });
    expect(sharp.length).toBe(1);
    expect(dull.length).toBe(0);
  });

  it("un maestro que explica bien deja más al aprendiz", () => {
    const good = { control: 1, senses: 1, judgment: 1 };
    const bad = { control: 1, senses: 1, judgment: 0 };
    expect(correctionGain(good, 0.5)).toBeGreaterThan(correctionGain(bad, 0.5));
  });
});
