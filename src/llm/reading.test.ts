import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeId, Rng, z } from "../core/index.ts";
import {
  buildPlayerView,
  NARRATION_TEMPLATES,
  type PlayerView,
  type ReadingView,
} from "../game/index.ts";
import {
  DEFAULT_NARRATION,
  narrationRequest,
  narratorUserMessage,
  renderView,
  styleOf,
  TemplateBook,
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

function viewWith(readings: readonly ReadingView[]): PlayerView {
  return buildPlayerView({
    player: makeId("agent", 1),
    scene: {
      placeKinds: ["village"],
      space: "street",
      indoor: false,
      home: false,
      familiar: true,
      hour: 12,
      light: 0.9,
    },
    percepts: [],
    steps: [],
    acquaintances: new Map(),
    readings,
  });
}

const reading = (over: Partial<ReadingView> = {}): ReadingView => ({
  instrument: "huesos de gallina",
  signs: ["huesos dispersos", "un hueso quebrado"],
  diviner: "la adivina",
  told: "ruin",
  strength: "strong",
  vague: false,
  doubtful: false,
  ...over,
});

describe("lectura de adivino en el narrador", () => {
  it("la plantilla dice el tiro, lo dicho y la duda, sin afirmar que sea cierto", () => {
    const text = renderView(
      viewWith([reading({ vague: true, doubtful: true })]),
      book,
      Rng.root(1),
    );
    expect(text).toContain("huesos dispersos, un hueso quebrado");
    expect(text).toContain("ruina");
    expect(text).toContain("cualquiera");
    expect(text).toContain("creerle");
  });

  it("el pedido al LLM lleva la lectura solo si la hay", () => {
    expect(narratorUserMessage(narrationRequest(viewWith([]), style))).not.toContain("readings");
    expect(narratorUserMessage(narrationRequest(viewWith([reading()]), style))).toContain(
      '"readings":[',
    );
  });
});
