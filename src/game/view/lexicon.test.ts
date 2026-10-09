import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { Life } from "../life/life.ts";
import { GAME_CONTENT_KINDS, WORLD_LEXICON } from "./content.ts";
import { believedConcepts, characterVoiceData, lexiconOf } from "./lexicon.ts";

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

describe("léxico del personaje", () => {
  it("el vocabulario de xianxia está cargado, ordenado y tiene palabras técnicas y comunes", () => {
    const terms = lexiconOf(content.all(WORLD_LEXICON), "xianxia");
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.some((t) => t.technical)).toBe(true);
    expect(terms.some((t) => !t.technical)).toBe(true);
    expect(terms.map((t) => t.id)).toEqual([...terms.map((t) => t.id)].sort());
    expect(lexiconOf(content.all(WORLD_LEXICON), "otra")).toEqual([]);
  });

  it("lo que cree y su voz salen de la vida y son deterministas", () => {
    fc.assert(
      fc.property(fc.nat({ max: 5 }), (seed) => {
        const run = () => {
          const life = Life.create(seed, content);
          const w = life.world;
          return {
            believed: [...believedConcepts(w.truth, life.player)].sort(),
            voice: characterVoiceData(w.truth, w.skills, life.player),
          };
        };
        const a = run();
        expect(a).toEqual(run());
        expect(a.voice.education).toBeGreaterThanOrEqual(0);
        expect(a.voice.education).toBeLessThanOrEqual(1);
        expect(a.voice.culture.length).toBeGreaterThan(0);
        // Nadie conoce el qi por el solo hecho de haber nacido en la aldea.
        expect(a.believed).not.toContain("law.qi");
      }),
      { numRuns: 3 },
    );
  }, 120_000);
});
