import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type EntityRef, makeId, Rng, z } from "../core/index.ts";
import {
  type Acquaintance,
  buildPlayerView,
  NARRATION_TEMPLATES,
  type SpecialMode,
  type ThoughtInput,
} from "../game/index.ts";
import {
  DEFAULT_NARRATION,
  narrationRequest,
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

function view(mode: SpecialMode | undefined, thoughts: readonly ThoughtInput[] = []) {
  return buildPlayerView({
    player: me,
    scene: {
      placeKinds: ["village"],
      space: "street",
      indoor: false,
      home: false,
      familiar: true,
      hour: 3,
      light: 0.1,
    },
    percepts: [],
    steps: [],
    acquaintances,
    thoughts,
    ...(mode ? { mode } : {}),
  });
}

describe("montage con lo vivido", () => {
  const stretch = {
    days: 9,
    did: [{ verb: "work", times: 5, failed: 2 }],
    spoke: 1,
    spokeWith: [],
    hurt: true,
    fought: false,
  };
  const base = view("montage");

  it("el resumen llega al narrador solo en montage y las plantillas lo cuentan", () => {
    const v = { ...base, stretch };
    const text = renderView(v, book, Rng.root(7 as never).fork("narration", 0));
    expect(text).toMatch(/trabajar/);
    expect(text).toMatch(/lastim/);
    expect(validateNarration(text, narrationRequest(v, style))).toEqual([]);
    expect(base.stretch).toBeUndefined();
  });

  it("las heridas sentidas se cuentan con la parte del cuerpo", () => {
    const v = {
      ...base,
      stretch: { ...stretch, wounds: [{ zone: "left_arm", sign: "bone_broken" }] },
    };
    const text = renderView(v, book, Rng.root(7 as never).fork("narration", 0));
    expect(text).toMatch(/brazo izquierdo/);
    expect(validateNarration(text, narrationRequest(v, style))).toEqual([]);
  });
});

describe("modos montage, sueño y secuela", () => {
  it("el modo sale de la sim y manda sobre los pensamientos", () => {
    for (const mode of ["montage", "dream", "aftermath"] as const) {
      const request = narrationRequest(view(mode, [{ kind: "feel", mood: "fear" }]), style);
      expect(request.mode).toBe(mode);
    }
    expect(narrationRequest(view(undefined), style).mode).toBe("scene");
  });

  it("las plantillas cuentan cada modo y el recuerdo borroso, y pasan el validador", () => {
    for (const mode of ["montage", "dream", "aftermath"] as const) {
      const v = view(mode, [{ kind: "remember", about: mother, mood: "grief", hazy: true }]);
      const text = renderView(v, book, Rng.root(7 as never).fork("narration", 0));
      expect(text).toMatch(/seguro|mezclan/);
      expect(validateNarration(text, narrationRequest(v, style))).toEqual([]);
    }
  });
});
