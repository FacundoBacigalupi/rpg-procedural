// El reino y la técnica de la escuela en el narrador (novel-cult-school): las plantillas los dicen con
// la capa en palabras, el pedido al modelo los lleva y el validador los acepta como nombres sabidos.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeId, Rng, z } from "../core/index.ts";
import { buildPlayerView, NARRATION_TEMPLATES, type PlayerView } from "../game/index.ts";
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

function view(): PlayerView {
  return buildPlayerView({
    player: makeId("agent", 1),
    scene: {
      placeKinds: ["village"],
      space: "square",
      indoor: false,
      home: false,
      familiar: true,
      hour: 12,
      light: 0.9,
    },
    percepts: [],
    steps: [],
    acquaintances: new Map(),
    self: ["trial_accepted", "sect_joined", "technique_taught"],
    selfRealm: { name: "Refinamiento del Qi", layer: 2, word: "capa" },
    selfTechnique: "el Método del Aliento Claro",
  });
}

describe("el reino de la escuela en el narrador (novel-cult-school)", () => {
  it("las plantillas nombran la técnica y el reino con la capa en palabras", () => {
    for (let n = 0; n < 6; n++) {
      const text = renderView(view(), book, Rng.root(n));
      expect(text).toContain("el Método del Aliento Claro");
      expect(text).toContain("segunda capa de Refinamiento del Qi");
      expect(text).not.toMatch(/\{\w+\}/);
    }
  });

  it("el modelo los recibe y el validador los deja pasar", () => {
    const request = narrationRequest(view(), style);
    const message = JSON.parse(narratorUserMessage(request));
    expect(message.realm).toEqual({ name: "Refinamiento del Qi", layer: 2, word: "capa" });
    expect(message.technique).toBe("el Método del Aliento Claro");
    const text =
      "Te aceptan. Te enseñan el Método del Aliento Claro y te dicen que estás en Refinamiento del Qi.";
    const r = validateNarration(text, request);
    expect(r.filter((p) => p.includes("does not know"))).toEqual([]);
  });
});
