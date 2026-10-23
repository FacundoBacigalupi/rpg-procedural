import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentKind, type EntityRef, makeId, Rng, z } from "../core/index.ts";
import {
  type Acquaintance,
  buildPlayerView,
  NARRATION_TEMPLATES,
  type SceneInput,
} from "../game/index.ts";
import type { Percept } from "../sim/index.ts";
import { mustMentionOf, renderView, stripMarks, TemplateBook } from "./index.ts";

function load<T extends { readonly id: string }>(kind: ContentKind<T>): T[] {
  const dir = join("content", kind.name);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => z.array(kind.schema).parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

const book = new TemplateBook(load(NARRATION_TEMPLATES));
const player = makeId("agent", 1);
const mother = makeId("agent", 2);
const old = makeId("agent", 3);
const acquaintances = new Map<EntityRef, Acquaintance>([
  [mother, { name: "Lan", relation: "madre" }],
]);
const field = (value: unknown) => ({ value, confidence: 0.95, mistaken: false });

const seen = (id: string, source: EntityRef, fields: Percept["fields"]): Percept => ({
  id,
  observer: player,
  sourceEntityId: source,
  tick: 10,
  channels: ["sight"],
  detail: "clear",
  fields: { presence: field(true), ...fields },
});

const lan = seen("p1", mother, { identity: field(mother) });
const viejo = seen("p2", old, { figure: field({ sex: "male", age: "elder" }) });

const scene: SceneInput = {
  placeKinds: ["village"],
  space: "street",
  indoor: false,
  home: false,
  familiar: true,
  hour: 9,
  light: 0.8,
};

const view = () =>
  buildPlayerView({
    player,
    scene,
    percepts: [viejo],
    arrived: new Set(["p2"]),
    gone: [lan],
    steps: [],
    acquaintances,
  });

describe("llegadas y partidas en la escena", () => {
  it("quien aparece queda marcado y quien se dejó de ver es una etiqueta aparte", () => {
    const v = view();
    expect(v.percepts).toEqual([expect.objectContaining({ who: "e1", arrived: true })]);
    expect(v.gone).toEqual(["e2"]);
    expect(v.labels[1]).toMatchObject({ name: "Lan", known: true });
    expect(mustMentionOf(v)).toEqual(["e1", "e2"]);
  });

  it("las plantillas cuentan el cambio sin inventar adónde fue nadie", () => {
    for (let n = 0; n < 8; n++) {
      const text = stripMarks(renderView(view(), book, Rng.root(n).fork("narration", 1)));
      expect(text).toMatch(/Ahora ves también a|aparece a la vista/u);
      expect(text).toMatch(/Ya no ves a Lan|Lan ya no está a la vista/u);
    }
  });

  it("sin escena anterior no hay llegadas ni partidas", () => {
    const v = buildPlayerView({
      player,
      scene,
      percepts: [viejo],
      steps: [],
      acquaintances,
    });
    expect(v.gone).toBeUndefined();
    expect(v.percepts[0]?.arrived).toBeUndefined();
  });
});
