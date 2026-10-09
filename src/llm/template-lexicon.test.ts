import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeId, Rng, z } from "../core/index.ts";
import { buildPlayerView, NARRATION_TEMPLATES, type StepView } from "../game/index.ts";
import { characterLexicon, renderView, TemplateBook, type WorldTerm } from "./index.ts";

const dir = join("content", NARRATION_TEMPLATES.name);
const book = new TemplateBook(
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) =>
      z.array(NARRATION_TEMPLATES.schema).parse(JSON.parse(readFileSync(join(dir, f), "utf8"))),
    ),
);

const WORLD: WorldTerm[] = [
  {
    concept: "good.spirit-stone",
    term: "piedra espiritual",
    plain: "una piedra rara",
    technical: true,
  },
];

const steps: StepView[] = [
  {
    verb: "gather",
    self: {
      believed: "success",
      cues: [],
      effect: {
        kind: "gather",
        good: "good:spirit-stone" as never,
        amount: 100,
        what: "piedra espiritual",
        stumbled: false,
      },
    },
  },
  {
    verb: "speak",
    self: {
      believed: "success",
      cues: [],
      effect: {
        kind: "speak",
        to: undefined as never,
        delivered: true,
        clarity: 1,
        text: "una piedra espiritual",
      },
    },
  },
];

const view = buildPlayerView({
  player: makeId("agent", 1),
  scene: {
    placeKinds: ["village"],
    space: "street",
    indoor: false,
    home: false,
    familiar: true,
    hour: 10,
    light: 1,
  },
  percepts: [],
  steps,
  acquaintances: new Map(),
});

describe("léxico en las plantillas sin red", () => {
  it("dice lo llano si no cree el concepto, pero no toca lo citado", () => {
    const rng = () => Rng.root(1 as never).fork("narration", 1 as never);
    const lex = characterLexicon(WORLD, new Set());
    const text = renderView(view, book, rng(), lex);
    expect(text).toContain("una piedra rara");
    expect(text).toContain("una piedra espiritual");
    expect(text.replace("una piedra espiritual", "")).not.toContain("piedra espiritual");
  });

  it("la dice tal cual si la cree, y sin léxico no cambia nada", () => {
    const rng = () => Rng.root(1 as never).fork("narration", 1 as never);
    const knows = characterLexicon(WORLD, new Set(["good.spirit-stone"]));
    expect(renderView(view, book, rng(), knows)).toBe(renderView(view, book, rng()));
    expect(renderView(view, book, rng())).toContain("piedra espiritual");
  });
});
