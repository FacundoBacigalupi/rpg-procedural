import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeId, Rng, z } from "../core/index.ts";
import {
  buildPlayerView,
  type DueView,
  NARRATION_TEMPLATES,
  type PlayerView,
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

function viewWith(dues: readonly DueView[]): PlayerView {
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
    dues,
  });
}

const due = (over: Partial<DueView> = {}): DueView => ({
  direction: "i-owe",
  who: "Marta",
  what: "unas monedas",
  state: "overdue",
  sure: true,
  ...over,
});

describe("deudas y promesas en el narrador", () => {
  it("cada dirección y estado tiene plantilla y nombra a la otra parte y lo debido", () => {
    for (const direction of ["i-owe", "owed-to-me"] as const) {
      for (const state of ["overdue", "soon"] as const) {
        const text = renderView(viewWith([due({ direction, state })]), book, Rng.root(1));
        expect(text).toContain("Marta");
        expect(text).toContain("unas monedas");
      }
    }
    expect(renderView(viewWith([due({ sure: false })]), book, Rng.root(1))).toMatch(
      /recordás|borronean/,
    );
  });

  it("el pedido al LLM lleva las deudas solo si hay", () => {
    expect(narratorUserMessage(narrationRequest(viewWith([]), style))).not.toContain("dues");
    expect(narratorUserMessage(narrationRequest(viewWith([due()]), style))).toContain('"dues":[');
  });
});
