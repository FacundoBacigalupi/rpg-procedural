import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ContentError,
  type ContentSource,
  contentId,
  defineContent,
  loadContent,
  z,
} from "./index.ts";

const Herb = z.strictObject({ id: contentId, name: z.string(), potency: z.number().min(0) });
type Herb = z.infer<typeof Herb>;
const HERBS = defineContent("herbs", Herb);

const Recipe = z.strictObject({ id: contentId, herbs: z.array(contentId).min(1) });
const RECIPES = defineContent("recipes", Recipe, (r) =>
  r.herbs.map((h, i) => ({ kind: "herbs", id: h, at: `herbs.${i}` })),
);

const KINDS = [HERBS, RECIPES];

const ginseng: Herb = { id: "ginseng", name: "ginseng", potency: 3 };
const lotus: Herb = { id: "lotus", name: "loto", potency: 1 };

function problems(sources: ContentSource[]): readonly string[] {
  try {
    loadContent(KINDS, sources);
  } catch (e) {
    if (e instanceof ContentError) return e.problems;
    throw e;
  }
  return [];
}

describe("loadContent", () => {
  it("carga, tipa y ordena", () => {
    const c = loadContent(KINDS, [
      { kind: "herbs", file: "herbs/a.json", data: [lotus, ginseng] },
      { kind: "recipes", file: "recipes/a.json", data: [{ id: "pill", herbs: ["ginseng"] }] },
    ]);
    const herb: Herb | undefined = c.get(HERBS, "ginseng");
    expect(herb).toEqual(ginseng);
    expect(c.all(HERBS).map((h) => h.id)).toEqual(["ginseng", "lotus"]);
    expect(c.has(RECIPES, "pill")).toBe(true);
    expect(c.has(RECIPES, "nada")).toBe(false);
    expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("una referencia rota no carga", () => {
    expect(
      problems([
        { kind: "herbs", file: "herbs/a.json", data: [ginseng] },
        {
          kind: "recipes",
          file: "recipes/a.json",
          data: [{ id: "pill", herbs: ["ginseng", "moly"] }],
        },
      ]),
    ).toEqual(["recipes/pill.herbs.1: herbs/moly no existe"]);
  });

  it("junta todos los problemas: esquema, repetidos, carpetas y formas", () => {
    expect(
      problems([
        {
          kind: "herbs",
          file: "herbs/a.json",
          data: [ginseng, { id: "Bad", name: 3, potency: -1 }],
        },
        { kind: "herbs", file: "herbs/b.json", data: [ginseng] },
        { kind: "herbs", file: "herbs/c.json", data: { id: "x" } },
        { kind: "spells", file: "spells/a.json", data: [] },
        { kind: "herbs", file: "herbs/d.json", data: [{ ...lotus, extra: true }] },
      ]),
    ).toEqual([
      "herbs/a.json[1].id: id de contenido inválido",
      expect.stringMatching(/^herbs\/a\.json\[1\]\.name: /),
      expect.stringMatching(/^herbs\/a\.json\[1\]\.potency: /),
      "herbs/b.json[0]: herbs/ginseng repetido (ya está en herbs/a.json)",
      "herbs/c.json: tiene que ser una lista de entradas",
      expect.stringMatching(/^herbs\/d\.json\[0\]: /),
      "spells/a.json: la carpeta spells no es un tipo de contenido conocido",
    ]);
  });

  it("el hash no depende de cómo se reparten las entradas en archivos ni del orden", () => {
    const herbs = fc.uniqueArray(
      fc.record({
        id: fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/),
        name: fc.string(),
        potency: fc.nat(),
      }),
      { selector: (h) => h.id, minLength: 1, maxLength: 12 },
    );
    fc.assert(
      fc.property(herbs, fc.nat(), (list, cut) => {
        const k = cut % (list.length + 1);
        const whole = loadContent(KINDS, [{ kind: "herbs", file: "herbs/all.json", data: list }]);
        const split = loadContent(KINDS, [
          { kind: "herbs", file: "herbs/z.json", data: list.slice(0, k).reverse() },
          { kind: "herbs", file: "herbs/a.json", data: list.slice(k) },
        ]);
        expect(split.hash).toBe(whole.hash);
      }),
    );
  });

  it("un tipo con nombre inválido o repetido es un error de programa", () => {
    expect(() => defineContent("Herbs", Herb)).toThrow(TypeError);
    expect(() => loadContent([HERBS, HERBS], [])).toThrow(TypeError);
  });
});
