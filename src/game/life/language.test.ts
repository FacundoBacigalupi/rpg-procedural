import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import {
  CONCEPTS,
  callName,
  ENTITY,
  familyName,
  fullName,
  generateLanguage,
  LANGUAGES,
  PERSON,
  PERSON_NAME,
  PLACE_NAME,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { playerView } from "./view.ts";
import { knownWords } from "./witness.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
const spec = content.get(LANGUAGES, "village.hills");
const concepts = content.all(CONCEPTS);
if (!spec) throw new Error("falta la lengua de la aldea");

describe("la lengua de la aldea", () => {
  it("mismo seed, misma lengua; otro seed, otra", () => {
    const a = generateLanguage(5, spec, concepts);
    const b = generateLanguage(5, spec, concepts);
    expect(a.phonology).toEqual(b.phonology);
    expect(a.roots()).toEqual(b.roots());
    const c = generateLanguage(6, spec, concepts);
    expect(c.roots().map((r) => r.text)).not.toEqual(a.roots().map((r) => r.text));
  });

  it("una raíz por concepto, sin dos con la misma forma", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), (seed) => {
        const l = generateLanguage(seed, spec, concepts);
        const texts = l.roots().map((r) => r.text);
        expect(texts).toHaveLength(concepts.length);
        expect(new Set(texts).size).toBe(texts.length);
      }),
      { numRuns: 30 },
    );
  });

  it("ninguna forma viola la fonotáctica: solo sus fonemas y solo codas permitidas", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), (seed) => {
        const l = generateLanguage(seed, spec, concepts);
        const p = l.phonology;
        for (const r of l.roots()) {
          for (const s of r.form) {
            if (s.onset !== undefined) expect(p.consonants).toContain(s.onset);
            expect(p.vowels).toContain(s.nucleus);
            if (s.coda !== undefined) expect(p.codas).toContain(s.coda);
          }
          expect(r.text).toMatch(/^[a-z]+$/);
        }
      }),
      { numRuns: 30 },
    );
  });

  it("los compuestos no dependen del orden en que se piden", () => {
    const l = generateLanguage(9, spec, concepts);
    const first = l.compound(["clear", "water"]).text;
    const other = generateLanguage(9, spec, concepts);
    other.compound(["strong", "stone"]);
    other.compound(["moon"]);
    expect(other.compound(["clear", "water"]).text).toBe(first);
    expect(l.compound(["clear", "water"]).origin).toEqual({
      kind: "compound",
      parts: [l.root("clear").id, l.root("water").id],
    });
  });
});

describe("los nombres de la aldea", () => {
  const life = Life.create(11, content, { frequency: 8 });
  const { truth } = life.world;

  it("toda persona tiene nombre de pila y apellido, con significado y evento de origen", () => {
    const people = truth.ids(PERSON);
    expect(people.length).toBeGreaterThan(0);
    for (const id of people) {
      const name = truth.get(PERSON_NAME, id);
      expect(name, id).toBeDefined();
      if (!name) continue;
      expect(callName(name)).toMatch(/^\p{Lu}\p{Ll}+$/u);
      expect(familyName(name)).toBeDefined();
      for (const part of name.parts) {
        expect(part.meaning.length).toBeGreaterThan(0);
        expect(life.world.log.get(part.event)).toBeDefined();
        expect(part.event).toBe(truth.get(ENTITY, id)?.originEventId);
      }
    }
  });

  it("los hijos llevan el apellido del padre", () => {
    let withFather = 0;
    for (const id of truth.ids(PERSON)) {
      const p = truth.get(PERSON, id);
      if (!p?.father) continue;
      const n = truth.get(PERSON_NAME, id);
      const f = truth.get(PERSON_NAME, p.father);
      if (!n || !f) continue;
      withFather++;
      expect(familyName(n)).toBe(familyName(f));
    }
    expect(withFather).toBeGreaterThan(0);
  });

  it("la aldea y sus lugares tienen nombre con sus raíces", () => {
    const places = truth.ids(PLACE_NAME);
    expect(places.length).toBeGreaterThanOrEqual(3);
    for (const id of places) {
      const n = truth.get(PLACE_NAME, id);
      expect(n?.form).toMatch(/^\p{Lu}\p{Ll}+$/u);
      expect(n?.meaning.length).toBeGreaterThan(0);
    }
  });

  it("es determinista: mismo seed, mismos nombres", () => {
    const again = Life.create(11, content, { frequency: 8 });
    for (const id of truth.ids(PERSON)) {
      expect(again.world.truth.get(PERSON_NAME, id)).toEqual(truth.get(PERSON_NAME, id));
    }
  }, 120_000);

  it("el personaje conoce los nombres de pila de su familia y la vista los cita", () => {
    const v = playerView(life.world, []);
    const mother = truth.get(PERSON, life.world.player)?.mother;
    expect(mother).toBeDefined();
    const given = callName(truth.get(PERSON_NAME, mother as never) ?? { language: "", parts: [] });
    const words = knownWords(life.world);
    expect(words.length).toBeGreaterThan(0);
    for (const w of words) expect(v.lexicon).toContain(w);
    expect(given).toBeDefined();
    // Sin fuga: nadie de afuera de su casa entra a la lista blanca por su nombre de pila.
    const mine = truth.get(PERSON, life.world.player)?.household;
    const stranger = truth.ids(PERSON).find((id) => {
      const p = truth.get(PERSON, id);
      return p && p.household !== mine && truth.get(ENTITY, id)?.endedAt === undefined;
    });
    const strangerGiven = callName(
      truth.get(PERSON_NAME, stranger as never) ?? { language: "", parts: [] },
    );
    const familyWords = new Set(words);
    if (strangerGiven !== undefined && !familyWords.has(strangerGiven)) {
      expect(v.lexicon).not.toContain(strangerGiven);
    }
  });

  it("el nombre completo sigue el orden de la lengua", () => {
    const l = generateLanguage(11, spec, concepts);
    const any = truth.ids(PERSON_NAME)[0];
    const n = truth.get(PERSON_NAME, any as never);
    if (!n) throw new Error("sin nombre");
    expect(fullName(l, n).split(" ")[0]).toBe(familyName(n));
  });
});
