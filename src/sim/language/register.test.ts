import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { CONTENT_KINDS } from "../content.ts";
import { CONCEPTS, LANGUAGES } from "./defs.ts";
import { generateLanguage } from "./language.ts";
import {
  ADDRESSES,
  CASUAL_TOLERANCE,
  chooseAddress,
  demandedFormality,
  judgeRegister,
  RECIPIENTS,
  REGISTERS,
  renderAddress,
  speakWord,
  TABOOS,
  tabooOf,
  tabooOffense,
} from "./register.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(CONTENT_KINDS, sources("content"));
const spec = content.get(LANGUAGES, "village.hills");
if (!spec) throw new Error("falta la lengua de la aldea");
const concepts = content.all(CONCEPTS);
const registers = content.all(REGISTERS);
const forms = content.all(ADDRESSES);
const taboos = content.all(TABOOS);
const home = registers.find((r) => r.setting === "home");
const shrine = registers.find((r) => r.setting === "temple");
if (!home || !shrine) throw new Error("faltan registros");

describe("registros y tratamientos", () => {
  it("el templo pide más formalidad que la casa, y a un maestro más que a un par", () => {
    expect(demandedFormality(shrine, "peer")).toBeGreaterThan(demandedFormality(home, "peer"));
    expect(demandedFormality(home, "master")).toBeGreaterThan(demandedFormality(home, "peer"));
  });

  it("la forma de tratamiento sube con la formalidad pedida y nunca pasa de ella", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...RECIPIENTS),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (to, f) => {
          const form = chooseAddress(forms, "village", to, f);
          if (form) expect(form.formality).toBeLessThanOrEqual(f);
        },
      ),
    );
    expect(chooseAddress(forms, "village", "master", 0.2)).toBeUndefined();
    expect(chooseAddress(forms, "village", "master", 0.9)?.id).toBe("village.to_master");
  });

  it("el honorífico sale del léxico de la lengua y el nombre a secas queda igual", () => {
    const lang = generateLanguage(7, spec, concepts);
    const master = chooseAddress(forms, "village", "master", 0.9);
    const said = renderAddress(lang, master, "Kuma");
    expect(said).toBe(`${lang.compound(["high", "old"]).text} Kuma`);
    expect(renderAddress(lang, undefined, "Kuma")).toBe("Kuma");
  });

  it("hablar de más confianza ante quien pide formalidad es falta; lo tolerable no", () => {
    expect(judgeRegister(0.7, 0.7, 1)).toBeNull();
    expect(judgeRegister(0.5, 0.5 - CASUAL_TOLERANCE, 1)).toBeNull();
    const slip = judgeRegister(0.8, 0.1, 1);
    expect(slip?.direction).toBe("too-casual");
    const unaware = judgeRegister(0.8, 0.1, 0);
    expect((unaware?.size ?? 1) < (slip?.size ?? 0)).toBe(true);
  });

  it("pasarse de ceremonioso se nota menos que quedarse corto y solo desde cierto punto", () => {
    expect(judgeRegister(0.1, 0.3, 1)).toBeNull();
    const over = judgeRegister(0.0, 1, 1);
    expect(over?.direction).toBe("too-formal");
    expect(over?.size).toBeLessThan(judgeRegister(1, 0, 1)?.size ?? 0);
  });

  it("la falta crece con la distancia y es determinista", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (d, u, k) => {
          const a = judgeRegister(d, u, k);
          expect(a).toEqual(judgeRegister(d, u, k));
          if (a) {
            expect(a.size).toBeGreaterThanOrEqual(0);
            expect(a.size).toBeLessThanOrEqual(1);
          }
        },
      ),
    );
  });
});

describe("tabúes de palabra", () => {
  const lang = generateLanguage(11, spec, concepts);

  it("quien conoce el tabú da el rodeo y no lo rompe", () => {
    const said = speakWord(lang, taboos, "village", ["tiger"], true);
    expect(said.via).toBe("circumlocution");
    expect(said.text).toBe(lang.compound(["old", "mountain"]).text);
    expect(said.broke).toBeUndefined();
  });

  it("quien no lo conoce dice la palabra y la rompe sin saberlo", () => {
    const said = speakWord(lang, taboos, "village", ["tiger"], false);
    expect(said.text).toBe(lang.compound(["tiger"]).text);
    expect(said.broke?.id).toBe("village.tiger");
  });

  it("una palabra común y otra cultura no tienen tabú", () => {
    expect(tabooOf(taboos, "village", ["water"])).toBeUndefined();
    expect(tabooOf(taboos, "otra", ["tiger"])).toBeUndefined();
    expect(speakWord(lang, taboos, "village", ["water"], true).via).toBe("direct");
  });

  it("la ofensa crece con testigos y reverencia, y la ignorancia la atenúa", () => {
    const t = taboos[0];
    if (!t) throw new Error("falta el tabú");
    expect(tabooOffense(t, 3, 0.5, true)).toBeGreaterThan(tabooOffense(t, 0, 0.5, true));
    expect(tabooOffense(t, 1, 1, true)).toBeGreaterThan(tabooOffense(t, 1, 0, true));
    expect(tabooOffense(t, 1, 0.5, false)).toBeLessThan(tabooOffense(t, 1, 0.5, true));
    fc.assert(
      fc.property(
        fc.integer({ min: -3, max: 50 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (w, r) => {
          const x = tabooOffense(t, w, r, true);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1);
        },
      ),
    );
  });

  it("el rodeo es determinista por seed", () => {
    const a = speakWord(generateLanguage(3, spec, concepts), taboos, "village", ["tiger"], true);
    const b = speakWord(generateLanguage(3, spec, concepts), taboos, "village", ["tiger"], true);
    expect(a).toEqual(b);
  });
});
