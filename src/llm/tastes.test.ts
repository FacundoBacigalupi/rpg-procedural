import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeId, Rng, z } from "../core/index.ts";
import {
  buildPlayerView,
  NARRATION_TEMPLATES,
  type PlayerView,
  type TasteView,
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

function viewWith(tastes: readonly TasteView[]): PlayerView {
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
    tastes,
  });
}

describe("gustos en el narrador", () => {
  it("cada postura tiene plantilla y nombra el gusto", () => {
    for (const stance of ["loves", "likes", "dislikes", "loathes"] as const) {
      const text = renderView(viewWith([{ name: "lo amargo", stance }]), book, Rng.root(1));
      expect(text.toLowerCase()).toContain("lo amargo");
    }
  });

  it("el pedido al LLM lleva los gustos solo si hay", () => {
    const none = narratorUserMessage(narrationRequest(viewWith([]), style));
    expect(none).not.toContain("tastes");
    const some = narratorUserMessage(
      narrationRequest(viewWith([{ name: "el té", stance: "loves" }]), style),
    );
    expect(some).toContain('"tastes":[{"name":"el té","stance":"loves"}]');
  });

  it("el validador rechaza contradecir el gusto y acepta lo coherente", () => {
    const req = narrationRequest(viewWith([{ name: "el té", stance: "loves" }]), style);
    const ok = validateNarration("Tomás un sorbo: el té te encanta, siempre.", req);
    expect(ok).toEqual([]);
    const bad = validateNarration("Tomás un sorbo: no te gusta el té, siempre.", req);
    expect(bad.join(" ")).toMatch(/do not say the opposite/);
    const bad2 = validateNarration("Tomás un sorbo: odiás el té, siempre.", req);
    expect(bad2.join(" ")).toMatch(/do not say the opposite/);

    const hates = narrationRequest(viewWith([{ name: "el té", stance: "loathes" }]), style);
    expect(validateNarration("Tomás un sorbo: no soportás el té, siempre.", hates)).toEqual([]);
    expect(
      validateNarration("Tomás un sorbo: el té te encanta, siempre.", hates).join(" "),
    ).toMatch(/opposite/);
  });
});
