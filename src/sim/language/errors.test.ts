import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent, Rng } from "../../core/index.ts";
import { CONTENT_KINDS } from "../content.ts";
import { CONCEPTS, LANGUAGES } from "./defs.ts";
import {
  editDistance,
  type FalseFriend,
  findFalseFriends,
  formCloseness,
  intelligibility,
  type SpeakerCommand,
  type SpeechPlan,
  speechErrorOffense,
  speechErrors,
  type ToneContrast,
  toneSlipChance,
} from "./errors.ts";
import { generateLanguage } from "./language.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "llm" ? [] : sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(CONTENT_KINDS, sources("content"));
const spec = content.get(LANGUAGES, "village.hills");
if (!spec) throw new Error("falta la lengua de la aldea");

const full = new Set(["water", "stone", "river"]);
const skilled: SpeakerCommand = { speak: 1, register: 1, tone: 1, vocabulary: full };
const novice: SpeakerCommand = { speak: 0, register: 0, tone: 0, vocabulary: new Set() };
const plan: SpeechPlan = { words: [["water"], ["stone"]], demanded: 0.7, used: 0.7 };
const contrast: ToneContrast = { concepts: ["water"], confusableWith: ["stone"], offense: 0.6 };
const friend: FalseFriend = {
  nativeConcept: "water",
  targetConcept: "stone",
  nativeText: "kara",
  targetText: "kari",
  closeness: 0.75,
  offense: 0.4,
};

describe("errores de quien habla mal", () => {
  it("la distancia de edición es simétrica y 0 solo entre iguales", () => {
    expect(editDistance("kara", "kari")).toBe(1);
    expect(formCloseness("kara", "kara")).toBe(1);
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{0,6}$/), fc.stringMatching(/^[a-z]{0,6}$/), (a, b) => {
        expect(editDistance(a, b)).toBe(editDistance(b, a));
        expect(editDistance(a, b) === 0).toBe(a === b);
      }),
    );
  });

  it("quien lo sabe todo no se equivoca", () => {
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        expect(speechErrors(skilled, plan, [contrast], [friend], Rng.root(seed))).toEqual([]);
      }),
    );
  });

  it("quien no sabe palabras las pierde, y sin falso amigo solo son huecos", () => {
    const errs = speechErrors(novice, plan, [], [], Rng.root(1));
    expect(errs.map((e) => e.kind)).toEqual(["missing-word", "missing-word"]);
    expect(intelligibility(plan, errs)).toBe(0);
  });

  it("el falso amigo aparece solo cuando falta la palabra y es determinista por seed", () => {
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        const a = speechErrors(novice, plan, [], [friend], Rng.root(seed));
        const b = speechErrors(novice, plan, [], [friend], Rng.root(seed));
        expect(a).toEqual(b);
        for (const e of a) if (e.kind === "false-friend") expect(e.friend).toBe(friend);
      }),
    );
    const knows: SpeakerCommand = { ...novice, vocabulary: full };
    const errs = speechErrors(knows, plan, [], [friend], Rng.root(3));
    expect(errs.some((e) => e.kind === "false-friend")).toBe(false);
  });

  it("sin oído a los tonos se confunde la palabra y se dice la otra", () => {
    const deaf: SpeakerCommand = { ...skilled, speak: 0, tone: 0 };
    expect(toneSlipChance(deaf)).toBe(1);
    const errs = speechErrors(deaf, plan, [contrast], [], Rng.root(5));
    expect(errs.find((e) => e.kind === "tone")).toMatchObject({
      meant: ["water"],
      said: ["stone"],
      offense: 0.6,
    });
    expect(toneSlipChance(skilled)).toBe(0);
  });

  it("el chance de tono baja con el oído y con la habla", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (t, s) => {
          const base = toneSlipChance({ tone: t, speak: s });
          expect(base).toBeGreaterThanOrEqual(
            toneSlipChance({ tone: Math.min(1, t + 0.1), speak: s }),
          );
          expect(base).toBeGreaterThanOrEqual(
            toneSlipChance({ tone: t, speak: Math.min(1, s + 0.1) }),
          );
        },
      ),
    );
  });

  it("el registro de quien no lo conoce es falta y no cuenta como palabra perdida", () => {
    const rude: SpeechPlan = { words: [], demanded: 0.9, used: 0.1 };
    const errs = speechErrors({ ...skilled, register: 0 }, rude, [], [], Rng.root(1));
    expect(errs[0]?.kind).toBe("register");
    expect(errs[0] && speechErrorOffense(errs[0])).toBeGreaterThan(0);
    expect(intelligibility(rude, errs)).toBe(1);
  });

  it("la ofensa de cada error está en 0-1", () => {
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        for (const e of speechErrors(novice, plan, [contrast], [friend], Rng.root(seed))) {
          const o = speechErrorOffense(e);
          expect(o).toBeGreaterThanOrEqual(0);
          expect(o).toBeLessThanOrEqual(1);
        }
      }),
    );
  });

  it("los falsos amigos entre lenguas son deterministas y nunca del mismo concepto", () => {
    const a = generateLanguage(7, spec, content.all(CONCEPTS));
    const b = generateLanguage(8, spec, content.all(CONCEPTS));
    const found = findFalseFriends(a, b);
    for (const f of found) expect(f.nativeConcept).not.toBe(f.targetConcept);
    expect(found).toEqual(findFalseFriends(a, b));
  });
});
