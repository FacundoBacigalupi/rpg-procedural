import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EventId, loadContent, Rng } from "../../core/index.ts";
import { CONTENT_KINDS } from "../content.ts";
import { CONCEPTS, LANGUAGES } from "./defs.ts";
import { generateLanguage } from "./language.ts";
import { MIN_NAME_LETTERS, nameNewborn, nameRules, type PersonName } from "./names.ts";

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

const letters = (s: string) => s.match(/\p{L}/gu)?.length ?? 0;
const part = (n: PersonName, kind: "given" | "family") =>
  n.parts.find((p) => p.kind === kind)?.form ?? "";

function names(seed: number, legacy: boolean): PersonName[] {
  const language = generateLanguage(seed, spec as NonNullable<typeof spec>, concepts);
  const root = Rng.root(seed).fork("test-names");
  return Array.from({ length: 200 }, (_, i) =>
    nameNewborn(language, {
      rng: root.fork(i),
      sex: i % 2 === 0 ? "female" : "male",
      father: undefined,
      used: new Set(),
      raisedBy: null,
      event: "event:1" as EventId,
      rules: nameRules({ legacyShortNames: legacy }),
    }),
  );
}

describe("largo mínimo de los nombres (play-names)", () => {
  it("ningún nombre de pila ni apellido queda con menos letras que el mínimo", () => {
    for (const seed of [1, 2, 3, 42, 777]) {
      for (const n of names(seed, false)) {
        expect(letters(part(n, "given"))).toBeGreaterThanOrEqual(MIN_NAME_LETTERS);
        expect(letters(part(n, "family"))).toBeGreaterThanOrEqual(MIN_NAME_LETTERS);
      }
    }
  });

  it("los que ya eran largos no cambian; los cortos suman un elemento con significado", () => {
    let lengthened = 0;
    for (const seed of [1, 2, 3, 42, 777]) {
      const now = names(seed, false);
      const old = names(seed, true);
      old.forEach((o, i) => {
        const n = now[i] as PersonName;
        for (const kind of ["given", "family"] as const) {
          const before = old[i]?.parts.find((p) => p.kind === kind);
          const after = n.parts.find((p) => p.kind === kind);
          if (letters(part(o, kind)) >= MIN_NAME_LETTERS) {
            expect(after).toEqual(before);
          } else {
            lengthened++;
            expect(after?.lexemes.length).toBeGreaterThan(before?.lexemes.length ?? 0);
            expect(after?.lexemes).toEqual(expect.arrayContaining([...(before?.lexemes ?? [])]));
          }
        }
      });
    }
    // Con la lengua de la aldea hay nombres de una o dos letras («O», «Te»): el caso se prueba.
    expect(lengthened).toBeGreaterThan(0);
  });

  it("es determinista", () => {
    expect(names(42, false)).toEqual(names(42, false));
  });
});
