import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentKind, type EntityRef, makeId, Rng, z } from "../core/index.ts";
import { buildPlayerView, NARRATION_TEMPLATES, type SceneInput } from "../game/index.ts";
import type { Percept } from "../sim/index.ts";
import { narratorUserMessage, renderView, stripMarks, TemplateBook } from "./index.ts";

function load<T extends { readonly id: string }>(kind: ContentKind<T>): T[] {
  const dir = join("content", kind.name);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => z.array(kind.schema).parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

const book = new TemplateBook(load(NARRATION_TEMPLATES));
const player = makeId("agent", 1);
const basket = makeId("item", 7) as unknown as EntityRef;
const knife = makeId("item", 8) as unknown as EntityRef;
const field = (value: unknown) => ({ value, confidence: 0.95, mistaken: false });

const thing = (id: string, source: EntityRef, look: unknown): Percept => ({
  id,
  observer: player,
  sourceEntityId: source,
  tick: 10,
  channels: ["sight"],
  detail: "clear",
  fields: { presence: field(true), thing: field(look) },
});

const scene: SceneInput = {
  placeKinds: ["village"],
  space: "street",
  indoor: false,
  home: false,
  familiar: true,
  hour: 9,
  light: 0.8,
};

const looked = (target?: EntityRef) =>
  buildPlayerView({
    player,
    scene,
    percepts: [],
    things: [
      thing("t1", basket, { shape: "basket", material: "bamboo", size: "medium" }),
      thing("t2", knife, { shape: "knife", material: "iron", size: "small" }),
    ],
    steps: [
      {
        verb: "look",
        self: {
          believed: "success",
          cues: [],
          effect: { kind: "observe", acuity: 0.8, ...(target ? { target } : {}) },
        } as never,
      },
    ],
    acquaintances: new Map(),
  });

describe("cosas a la vista en la narración (play-refs-objects-look)", () => {
  it("la vista lleva las cosas con sus rasgos y marca la que miró", () => {
    expect(looked(basket).things).toEqual([
      { shape: "basket", material: "bamboo", size: "medium", looked: true },
      { shape: "knife", material: "iron", size: "small" },
    ]);
    expect(looked().things?.some((t) => t.looked === true)).toBe(false);
    expect(JSON.parse(narratorUserMessage({ view: looked(basket) } as never)).things).toHaveLength(
      2,
    );
  });

  it("las plantillas nombran la cosa mirada y, al mirar, las demás", () => {
    for (let n = 0; n < 6; n++) {
      const text = stripMarks(renderView(looked(basket), book, Rng.root(n).fork("narration", 1)));
      expect(text).toMatch(/(Te fijás bien en|Mirás de cerca) una canasta de bambú/u);
      expect(text).toMatch(/un cuchillo de hierro/u);
    }
  });
});

describe("lo fijo en la narración (play-refs-objects-fixtures-look)", () => {
  const well = makeId("work", 3) as unknown as EntityRef;
  const view = (target?: EntityRef) =>
    buildPlayerView({
      player,
      scene,
      percepts: [],
      fixtures: [{ ref: well, shape: "well", state: "poor" }],
      steps: [
        {
          verb: "look",
          self: {
            believed: "success",
            cues: [],
            effect: { kind: "observe", acuity: 0.8, ...(target ? { target } : {}) },
          } as never,
        },
      ],
      acquaintances: new Map(),
    });

  it("el pozo mirado se nombra con su estado; sin mirarlo no aparece", () => {
    expect(view(well).things).toEqual([
      { shape: "well", size: "large", looked: true, state: "poor" },
    ]);
    expect(view().things).toBeUndefined();
    for (let n = 0; n < 6; n++) {
      const text = stripMarks(renderView(view(well), book, Rng.root(n).fork("narration", 1)));
      expect(text).toMatch(/(Te fijás bien en|Mirás de cerca) el pozo/u);
      expect(text).toMatch(/descuidado/u);
    }
  });
});

describe("el animal mirado en la narración (livestock-draft-rest-say)", () => {
  const ox = makeId("animal", 4) as unknown as EntityRef;
  const view = (tired: boolean) =>
    buildPlayerView({
      player,
      scene,
      percepts: [],
      fixtures: [{ ref: ox, shape: "ox", size: "large", ...(tired ? { state: "tired" } : {}) }],
      steps: [
        {
          verb: "look",
          self: {
            believed: "success",
            cues: [],
            effect: { kind: "observe", acuity: 0.8, target: ox },
          } as never,
        },
      ],
      acquaintances: new Map(),
    });

  it("el buey cansado se nombra con su cansancio; descansado, sin él", () => {
    for (let n = 0; n < 6; n++) {
      const rng = () => Rng.root(n).fork("narration", 1);
      const tired = stripMarks(renderView(view(true), book, rng()));
      expect(tired).toMatch(/(Te fijás bien en|Mirás de cerca) el buey/u);
      expect(tired).toMatch(/cansado/u);
      expect(stripMarks(renderView(view(false), book, rng()))).not.toMatch(/cansado/u);
    }
  });
});

describe("lo demás que se le nota al animal en la narración (livestock-look-more)", () => {
  const goat = makeId("animal", 5) as unknown as EntityRef;
  const view = (marks: readonly ("young" | "old" | "thin" | "starving" | "nursing")[]) =>
    buildPlayerView({
      player,
      scene,
      percepts: [],
      fixtures: [{ ref: goat, shape: "goat", size: "medium", marks }],
      steps: [
        {
          verb: "look",
          self: {
            believed: "success",
            cues: [],
            effect: { kind: "observe", acuity: 0.8, target: goat },
          } as never,
        },
      ],
      acquaintances: new Map(),
    });

  it("cada marca tiene su frase y sin marcas no se dice nada de eso", () => {
    for (const m of ["young", "old", "thin", "starving", "nursing"] as const) {
      expect(book.has(`thing.mark.${m}`)).toBe(true);
    }
    for (let n = 0; n < 6; n++) {
      const rng = () => Rng.root(n).fork("narration", 1);
      const said = stripMarks(renderView(view(["starving", "nursing"]), book, rng()));
      expect(said).toMatch(/la cabra/u);
      expect(said).toMatch(/huesos/u);
      expect(said).toMatch(/mamar/u);
      expect(stripMarks(renderView(view([]), book, rng()))).not.toMatch(/huesos|mamar|cría|años/u);
    }
  });
});

describe("la tina mirada en la narración (livestock-hide-tan-look)", () => {
  const vat = makeId("building", 9) as unknown as EntityRef;
  const view = (state: "soaking" | "almost") =>
    buildPlayerView({
      player,
      scene,
      percepts: [],
      fixtures: [{ ref: vat, shape: "vat", state }],
      steps: [
        {
          verb: "look",
          self: {
            believed: "success",
            cues: [],
            effect: { kind: "observe", acuity: 0.8, target: vat },
          } as never,
        },
      ],
      acquaintances: new Map(),
    });

  it("la tina se nombra con su tanda: en remojo o casi curtida", () => {
    for (let n = 0; n < 6; n++) {
      const rng = () => Rng.root(n).fork("narration", 1);
      expect(stripMarks(renderView(view("soaking"), book, rng()))).toMatch(/la tina de curtir/u);
      expect(stripMarks(renderView(view("soaking"), book, rng()))).toMatch(/remoj/u);
      expect(stripMarks(renderView(view("almost"), book, rng()))).toMatch(/cuero|curtidos/u);
    }
  });
});
