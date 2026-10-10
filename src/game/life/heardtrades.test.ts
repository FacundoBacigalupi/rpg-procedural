import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeId, Rng, z } from "../../core/index.ts";
import { renderView, TemplateBook } from "../../llm/index.ts";
import { NARRATION_TEMPLATES } from "../index.ts";
import { buildPlayerView, type HeardTradeView, type PlayerView } from "../view/index.ts";
import { heardTradesOf } from "./heardtrades.ts";
import { tradeAbout } from "./moldgossip.ts";

const item = (home: string, value: string, confidence = 1, heardAt = 0) => ({
  rumor: { mold: "attr", about: tradeAbout(home), attr: "trade", value } as const,
  confidence,
  hops: 1,
  heardAt,
  teller: null,
});
const names = new Map([["forge", "herrería"]]);

describe("oficio oído como creencia", () => {
  it("usa el nombre del oficio y de la casa por quien conoce; sin ids; salta la propia y las recetas ajenas", () => {
    const book = {
      items: [item("h1", "forge", 0.3), item("own", "forge"), item("h2", "unknown")],
      told: [],
    };
    const out = heardTradesOf(book, "own", names, (h) => (h === "h1" ? "Marta" : undefined));
    expect(out).toEqual([{ trade: "herrería", who: "Marta", sure: false }]);
    expect(JSON.stringify(out)).not.toMatch(/household|h1|forge/);
    expect(heardTradesOf(undefined, undefined, names, () => undefined)).toEqual([]);
  });

  it("la vista lo lleva y las plantillas lo dicen como oídas, sin verdad", () => {
    const dir = join("content", NARRATION_TEMPLATES.name);
    const book = new TemplateBook(
      readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .flatMap((f) =>
          z.array(NARRATION_TEMPLATES.schema).parse(JSON.parse(readFileSync(join(dir, f), "utf8"))),
        ),
    );
    const view = (heardTrades: HeardTradeView[]): PlayerView =>
      buildPlayerView({
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
        heardTrades,
      });
    const named = renderView(
      view([{ trade: "herrería", who: "Marta", sure: false }]),
      book,
      Rng.root(1),
    );
    expect(named).toContain("Marta");
    expect(named).toContain("herrería");
    expect(named).toMatch(/cierto|verdad/);
    const anon = renderView(view([{ trade: "herrería", sure: true }]), book, Rng.root(1));
    expect(anon).toContain("herrería");
    expect(view([]).heardTrades).toEqual([]);
  });
});
