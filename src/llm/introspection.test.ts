import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type EntityRef, makeId, Rng, z } from "../core/index.ts";
import {
  type Acquaintance,
  buildPlayerView,
  NARRATION_TEMPLATES,
  type PlayerView,
  type ThoughtInput,
} from "../game/index.ts";
import {
  DEFAULT_NARRATION,
  narrationRequest,
  narratorUserMessage,
  renderView,
  styleOf,
  TemplateBook,
  validateNarration,
} from "./index.ts";

const dir = join("content", NARRATION_TEMPLATES.name);
const book = new TemplateBook(
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) =>
      z.array(NARRATION_TEMPLATES.schema).parse(JSON.parse(readFileSync(join(dir, f), "utf8"))),
    ),
);
const style = styleOf(DEFAULT_NARRATION, "es");

const me = makeId("agent", 1);
const mother = makeId("agent", 2);
const acquaintances = new Map<EntityRef, Acquaintance>([
  [mother, { name: "Lan", relation: "madre" }],
]);

function thinking(thoughts: readonly ThoughtInput[]): PlayerView {
  return buildPlayerView({
    player: me,
    scene: {
      placeKinds: ["village"],
      space: "street",
      indoor: false,
      home: false,
      familiar: true,
      hour: 22,
      light: 0.1,
    },
    percepts: [],
    steps: [],
    acquaintances,
    thoughts,
  });
}

const THOUGHTS: ThoughtInput[] = [];
for (const kind of ["remember", "ponder", "feel"] as const) {
  for (const about of [mother, undefined]) {
    for (const mood of ["grief", "fear", "longing", "guilt", "calm", undefined] as const) {
      THOUGHTS.push({ kind, ...(about ? { about } : {}), ...(mood ? { mood } : {}) });
    }
  }
}

describe("modo introspección", () => {
  it("sale de lo que piensa el personaje, no de lo que pasa afuera", () => {
    expect(narrationRequest(thinking([{ kind: "remember", about: mother }]), style).mode).toBe(
      "introspection",
    );
    expect(narrationRequest(thinking([]), style).mode).toBe("scene");
  });

  it("a quien recuerda hay que nombrarlo y el pedido lleva los pensamientos", () => {
    const req = narrationRequest(thinking([{ kind: "remember", about: mother }]), style);
    expect(req.mustMention).toEqual(["e1"]);
    expect(JSON.parse(narratorUserMessage(req)).thoughts).toEqual([
      { kind: "remember", about: "e1" },
    ]);
  });

  it("toda combinación de pensamiento tiene plantilla y pasa el validador", () => {
    fc.assert(
      fc.property(fc.nat(), fc.subarray(THOUGHTS, { minLength: 1, maxLength: 3 }), (seed, ts) => {
        const view = thinking(ts);
        const text = renderView(view, book, Rng.root(seed).fork("narration", 0));
        expect(validateNarration(text, narrationRequest(view, style))).toEqual([]);
      }),
    );
  });

  it("tiene su propio largo: más corto que una escena", () => {
    const view = thinking([{ kind: "ponder" }]);
    const long = "x".repeat(900);
    const req = narrationRequest(view, style);
    expect(validateNarration(long, req).some((p) => p.includes("too long"))).toBe(true);
  });
});

describe("pensar: la conclusión en la voz del personaje", () => {
  const conclusion = (c: ThoughtInput["conclusion"]): PlayerView =>
    thinking([{ kind: "conclude", ...(c ? { conclusion: c } : {}) }]);

  it("pide nombrar a quien nombra el hecho y lleva banda y evidencia", () => {
    const view = conclusion({
      pred: "took",
      args: [mother],
      band: "likely",
      because: ["tracks"],
    });
    const req = narrationRequest(view, style);
    expect(req.mode).toBe("introspection");
    expect(req.mustMention).toEqual(["e1"]);
    const sent = JSON.parse(narratorUserMessage(req));
    expect(sent.thoughts[0].conclusion).toMatchObject({
      pred: "took",
      who: ["e1"],
      band: "likely",
      because: ["tracks"],
    });
  });

  it("toda banda con rival y evidencia tiene plantilla y pasa el validador", () => {
    for (const band of ["convinced", "likely", "maybe", "hunch"] as const) {
      const view = conclusion({
        pred: "alive",
        args: [mother],
        band,
        rival: { pred: "dead", args: [mother] },
        because: ["wound", "tracks"],
      });
      const text = renderView(view, book, Rng.root(1).fork("narration", 0));
      expect(text).toContain("{{e1|");
      expect(validateNarration(text, narrationRequest(view, style))).toEqual([]);
    }
  });

  it("un predicado sin plantilla propia cae a la frase genérica", () => {
    const view = conclusion({ pred: "algo_raro", args: [mother], band: "hunch" });
    const text = renderView(view, book, Rng.root(1).fork("narration", 0));
    expect(text).toContain("algo no cierra");
  });
});
