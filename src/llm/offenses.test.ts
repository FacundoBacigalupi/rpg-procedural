import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeId, Rng, z } from "../core/index.ts";
import { buildPlayerView, NARRATION_TEMPLATES, type OffenseView } from "../game/index.ts";
import { renderView, TemplateBook } from "./index.ts";

const dir = join("content", NARRATION_TEMPLATES.name);
const book = new TemplateBook(
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) =>
      z.array(NARRATION_TEMPLATES.schema).parse(JSON.parse(readFileSync(join(dir, f), "utf8"))),
    ),
);

function viewWith(offenses: readonly OffenseView[]) {
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
    offenses,
  });
}

describe("ofensas en las plantillas sin red", () => {
  it("cada rol y respuesta tiene plantilla, nombra al otro y cita la norma rota", () => {
    for (const role of ["received", "caused"] as const) {
      for (const response of ["rebuke", "punish", "ignore"] as const) {
        const text = renderView(
          viewWith([{ role, who: "Marta", norm: "village.greet_first", response }]),
          book,
          Rng.root(1),
        );
        expect(text).toContain("Marta");
        expect(text).toContain("saludo");
      }
    }
  });
});
