import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeId, Rng, z } from "../core/index.ts";
import {
  buildPlayerView,
  type HeardClaimView,
  type HeardTradeView,
  NARRATION_TEMPLATES,
  type PlayerView,
} from "../game/index.ts";
import { renderView, TemplateBook } from "./index.ts";

describe("oficio oído en las plantillas", () => {
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

  it("lo que le contaron de si alguien vive se dice como «dicen que», con fuente y duda", () => {
    const dir = join("content", NARRATION_TEMPLATES.name);
    const book = new TemplateBook(
      readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .flatMap((f) =>
          z.array(NARRATION_TEMPLATES.schema).parse(JSON.parse(readFileSync(join(dir, f), "utf8"))),
        ),
    );
    const view = (heardClaims: HeardClaimView[]): PlayerView =>
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
        heardClaims,
      });
    const told = renderView(
      view([{ about: "Marta", claim: "dead", from: "el herrero", sure: false }]),
      book,
      Rng.root(1),
    );
    expect(told).toContain("Marta");
    expect(told).toContain("el herrero");
    expect(told).toMatch(/cierto|verdad/);
    const anon = renderView(
      view([{ about: "Marta", claim: "alive", sure: true }]),
      book,
      Rng.root(1),
    );
    expect(anon).toContain("Marta");
    expect(view([]).heardClaims).toEqual([]);
  });
});
