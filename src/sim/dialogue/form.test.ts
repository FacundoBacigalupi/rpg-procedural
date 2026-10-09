import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { CONTENT_KINDS } from "../content.ts";
import {
  ADDRESSES,
  CONCEPTS,
  generateLanguage,
  LANGUAGES,
  REGISTERS,
  TABOOS,
} from "../language/index.ts";
import { ETIQUETTE } from "../social/index.ts";
import { formWhitelist, judgeForm, speechForm } from "./form.ts";

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
const concepts = content.all(CONCEPTS);
const forms = content.all(ADDRESSES);
const taboos = content.all(TABOOS);
const temple = content.all(REGISTERS).find((r) => r.setting === "temple");
if (!temple) throw new Error("falta el registro del templo");
const taboo = taboos[0];
if (!taboo) throw new Error("falta un tabú");

const base = (over: object = {}) => ({
  register: temple,
  asRecipient: "master" as const,
  speakerKnowsRegister: 1,
  gap: 1,
  witnesses: 0,
  hearerReverence: 1,
  speakerKnewTaboos: true,
  ...over,
});

describe("forma de lo dicho", () => {
  it("hablar casual a un maestro en el templo es falta; hablar a la altura no", () => {
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        const lang = generateLanguage(seed, spec, concepts);
        const mk = (formality: number) =>
          speechForm(lang, forms, taboos, "village", {
            register: temple,
            recipient: "master",
            formality,
            given: "Aren",
          });
        expect(judgeForm(mk(0), taboos, base()).register).not.toBeNull();
        expect(judgeForm(mk(1), taboos, base()).register).toBeNull();
      }),
      { numRuns: 5 },
    );
  });

  it("decir la palabra vedada sin saberlo ofende menos que sabiéndolo, y el rodeo no ofende", () => {
    const lang = generateLanguage(3, spec, concepts);
    const say = (knows: boolean) =>
      speechForm(lang, forms, taboos, "village", {
        register: temple,
        recipient: "peer",
        formality: 1,
        given: "Aren",
        words: [taboo.concepts],
        knowsTaboos: knows,
      });
    const peer = { asRecipient: "peer" as const };
    const around = judgeForm(say(true), taboos, base(peer));
    const knew = judgeForm(say(false), taboos, base({ ...peer, speakerKnewTaboos: true }));
    const ignorant = judgeForm(say(false), taboos, base({ ...peer, speakerKnewTaboos: false }));
    expect(around.taboos).toHaveLength(0);
    expect(knew.taboos).toHaveLength(1);
    expect(ignorant.taboos[0]?.size ?? 0).toBeLessThan(knew.taboos[0]?.size ?? 0);
    expect(knew.faceLoss).toBeGreaterThan(around.faceLoss);
  });

  it("más testigos, más cara perdida; y la lista blanca trae el tratamiento y lo dicho", () => {
    const lang = generateLanguage(5, spec, concepts);
    const f = speechForm(lang, forms, taboos, "village", {
      register: temple,
      recipient: "master",
      formality: 0,
      given: "Aren",
      words: [taboo.concepts],
    });
    const few = judgeForm(f, taboos, base({ witnesses: 0 }));
    const many = judgeForm(f, taboos, base({ witnesses: 3 }));
    expect(many.faceLoss).toBeGreaterThanOrEqual(few.faceLoss);
    expect(formWhitelist(f)).toContain(f.address);
    expect(formWhitelist(f)).toHaveLength(2);
  });

  it("es determinista", () => {
    const run = () => {
      const lang = generateLanguage(9, spec, concepts);
      const f = speechForm(lang, forms, taboos, "village", {
        register: temple,
        recipient: "elder",
        formality: 0.5,
        given: "Aren",
      });
      return JSON.stringify([f, judgeForm(f, taboos, base({ asRecipient: "elder" }))]);
    };
    expect(run()).toBe(run());
  });
});

describe("la etiqueta declarada en el acto", () => {
  const norms = content.all(ETIQUETTE);
  const lang = generateLanguage(11, spec, concepts);
  const say = (formality: number, greeted: boolean) =>
    speechForm(lang, forms, taboos, "village", {
      register: temple,
      recipient: "peer",
      formality,
      given: "Aren",
      greeted,
    });
  const etiquette = (rank: number | undefined) => ({
    etiquette: {
      norms,
      offendedRank: 2,
      believedActor: rank === undefined ? undefined : { rank, confidence: 0.9 },
      actorKnowsEtiquette: 1,
    },
    asRecipient: "peer" as const,
  });

  it("el acto declara si usó tratamiento con honorífico y si saludó", () => {
    expect(say(0, false).acts).toEqual({ address: false, greet: false });
    expect(say(0, true).acts?.greet).toBe(true);
  });

  it("omitir el usted y el saludo ofende a quien cree al otro por debajo, no a quien no lo leyó", () => {
    const f = say(0, false);
    const below = judgeForm(f, taboos, base(etiquette(0)));
    const unread = judgeForm(f, taboos, base(etiquette(undefined)));
    const equal = judgeForm(f, taboos, base(etiquette(2)));
    expect(below.breaches.length).toBeGreaterThan(0);
    expect(below.faceLoss).toBeGreaterThan(0);
    expect(unread.breaches).toEqual([]);
    expect(equal.breaches).toEqual([]);
  });

  it("saludar quita la falta del saludo y más testigos la agrandan", () => {
    const quiet = judgeForm(say(0, false), taboos, base({ ...etiquette(0), witnesses: 0 }));
    const greeted = judgeForm(say(0, true), taboos, base({ ...etiquette(0), witnesses: 0 }));
    const loud = judgeForm(say(0, false), taboos, base({ ...etiquette(0), witnesses: 3 }));
    expect(greeted.breaches.length).toBeLessThan(quiet.breaches.length);
    expect(loud.breaches[0]?.size ?? 0).toBeGreaterThan(quiet.breaches[0]?.size ?? 1);
  });
});
