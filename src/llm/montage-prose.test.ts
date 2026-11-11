import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentKind, type EntityRef, makeId, Rng, z } from "../core/index.ts";
import {
  type Acquaintance,
  buildPlayerView,
  NARRATION_TEMPLATES,
  type SceneInput,
} from "../game/index.ts";
import type { Percept } from "../sim/index.ts";
import { mustMentionOf, narratorSystem, renderView, stripMarks, TemplateBook } from "./index.ts";

function load<T extends { readonly id: string }>(kind: ContentKind<T>): T[] {
  const dir = join("content", kind.name);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => z.array(kind.schema).parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

const book = new TemplateBook(load(NARRATION_TEMPLATES));
const player = makeId("agent", 1);
const mother = makeId("agent", 2);
const acquaintances = new Map<EntityRef, Acquaintance>([
  [mother, { name: "Lan", relation: "madre" }],
]);
const field = (value: unknown) => ({ value, confidence: 0.95, mistaken: false });
const lan: Percept = {
  id: "p1",
  observer: player,
  sourceEntityId: mother,
  tick: 10,
  channels: ["sight", "sound"],
  detail: "clear",
  fields: { presence: field(true), identity: field(mother), words: field("¿Quién?") },
};
const scene: SceneInput = {
  placeKinds: ["village"],
  space: "street",
  indoor: false,
  home: false,
  familiar: true,
  hour: 9,
  light: 0.8,
};

describe("el montaje como prosa (novel-narr-montage)", () => {
  it("en un salto la escena de la última hora no se cuenta: ni quién aparece, ni quién se fue, ni lo dicho al pasar", () => {
    const view = buildPlayerView({
      player,
      scene,
      percepts: [lan],
      arrived: new Set(["p1"]),
      gone: [lan],
      steps: [],
      acquaintances,
      mode: "montage",
      stretch: {
        days: 14,
        did: [],
        spoke: 0,
        metWith: [],
        hurt: false,
        fought: false,
        kept: [{ kind: "meditate", times: 12 }],
      },
    });
    expect(view.percepts).toEqual([]);
    expect(view.gone).toBeUndefined();
    expect(mustMentionOf(view)).toEqual([]);
    for (let n = 0; n < 6; n++) {
      const text = stripMarks(renderView(view, book, Rng.root(n).fork("narration", 1)));
      expect(text).not.toMatch(/Lan|Quién|Ahora ves|Ya no ves/u);
      expect(text).toMatch(/respirar/u);
    }
  });

  it("la glosa con su determinante se come el artículo de la plantilla", () => {
    const view = buildPlayerView({
      player,
      scene,
      percepts: [],
      steps: [],
      acquaintances,
      self: ["qi_resists"],
    });
    const vocabulary = {
      use: [],
      avoid: [{ term: "qi", say: "ese aliento invisible que corre por las cosas" }],
    };
    for (let n = 0; n < 6; n++) {
      const text = stripMarks(renderView(view, book, Rng.root(n), vocabulary));
      expect(text).not.toMatch(/\b(el|El|del|al) ese\b/u);
      expect(text).not.toMatch(/\bqi\b/u);
    }
    const texts = Array.from({ length: 12 }, (_, n) =>
      stripMarks(renderView(view, book, Rng.root(n), vocabulary)),
    );
    expect(
      texts.some((t) => /Ese aliento invisible que corre por las cosas de este lugar/u.test(t)),
    ).toBe(true);
  });

  it("voz por modo (novel-narr-voice): la novela abre y cierra el salto con su frase; realista, no", () => {
    const view = buildPlayerView({
      player,
      scene,
      percepts: [],
      steps: [],
      acquaintances,
      mode: "montage",
      stretch: { days: 14, did: [], spoke: 0, metWith: [], hurt: false, fought: false },
    });
    const opens = book.lines("novel.mode.montage");
    const closes = book.lines("novel.close.montage");
    for (let n = 0; n < 6; n++) {
      const novel = stripMarks(renderView(view, book, Rng.root(n), undefined, { novel: true }));
      expect(opens.some((l) => novel.startsWith(l))).toBe(true);
      expect(closes.some((l) => novel.endsWith(l))).toBe(true);
      const plain = stripMarks(renderView(view, book, Rng.root(n)));
      expect(opens.some((l) => plain.includes(l))).toBe(false);
      expect(closes.some((l) => plain.includes(l))).toBe(false);
    }
    const style = {
      person: "second",
      tense: "present",
      voseo: true,
      detail: "normal",
      language: "es",
    } as const;
    expect(narratorSystem({ ...style, novel: true })).toMatch(/Novel mode/u);
    expect(narratorSystem(style)).not.toMatch(/Novel mode/u);
  });
});
