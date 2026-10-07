import { describe, expect, it } from "vitest";
import { type AgentId, type EntityRef, makeId, z } from "../../core/index.ts";
import type { Percept, SelfReport } from "../../sim/index.ts";
import {
  type Acquaintance,
  AmbienceEntry,
  ambienceOf,
  buildPlayerView,
  type SceneInput,
  type ViewInput,
} from "./index.ts";

const player = makeId("agent", 1);
const mother = makeId("agent", 2);
const stranger = makeId("agent", 3);

const scene: SceneInput = {
  placeKinds: ["village"],
  space: "square",
  indoor: false,
  home: false,
  familiar: true,
  hour: 12,
  light: 0.9,
};

function percept(
  source: AgentId,
  fields: Percept["fields"],
  detail: Percept["detail"],
  tick = 100,
): Percept {
  return {
    id: `${source}@${tick}/${player}`,
    observer: player,
    sourceEntityId: source,
    tick,
    channels: ["sight"],
    detail,
    fields,
  };
}

const field = (value: unknown, confidence = 0.95) => ({ value, confidence, mistaken: false });

const searchStep: SelfReport = {
  believed: "partial",
  cues: ["light"],
  effect: { kind: "search", target: mother, present: true, found: false, glimpsed: true },
};

function input(over: Partial<ViewInput> = {}): ViewInput {
  return {
    player,
    scene,
    percepts: [
      percept(
        mother,
        {
          presence: field(true),
          figure: field({ sex: "female", age: "adult" }),
          identity: field(mother, 0.7),
          action: field("work"),
        },
        "identified",
      ),
      percept(
        stranger,
        { presence: field(true), figure: field({ sex: "male", age: "elder" }) },
        "clear",
      ),
      percept(stranger, { presence: field(true, 0.4) }, "vague", 101),
    ],
    steps: [{ verb: "search", self: searchStep }],
    acquaintances: new Map<EntityRef, Acquaintance>([[mother, { name: "Lan", relation: "madre" }]]),
    ...over,
  };
}

describe("buildPlayerView", () => {
  it("no deja pasar ids reales, errores, confianzas, márgenes ni factores", () => {
    const json = JSON.stringify(buildPlayerView(input()));
    for (const leak of [
      "agent:",
      "mistaken",
      "confidence",
      "sourceEntityId",
      "sourceEventId",
      "margin",
      "factors",
      "hex",
      "present",
    ]) {
      expect(json, leak).not.toContain(leak);
    }
  });

  it("un conocido es una sola etiqueta; un desconocido, una nueva en cada percept", () => {
    const v = buildPlayerView(input());
    expect(v.labels.map((l) => l.localId)).toEqual(["e1", "e2", "e3"]);
    expect(v.labels[0]).toMatchObject({ name: "Lan", relation: "madre", known: true });
    // El paso apuntó a la madre: lo sabe aunque la haya visto a medias.
    expect(v.labels[0]?.certainty).toBe("sure");
    expect(v.percepts.map((p) => p.who)).toEqual(["e1", "e2", "e3"]);
    expect(v.labels[1]).toMatchObject({ known: false, figure: { sex: "male", age: "elder" } });
    expect(v.labels[2]).toMatchObject({ known: false, certainty: "unsure" });
    expect(v.labels[2]?.figure).toBeUndefined();
    expect(v.lexicon).toEqual(["Lan"]);
  });

  it("el efecto de un paso queda como lo cree el personaje", () => {
    const v = buildPlayerView(input());
    expect(v.outcomes).toEqual([
      {
        verb: "search",
        believed: "partial",
        cues: ["light"],
        effect: { kind: "search", target: "e1", found: false, glimpsed: true },
      },
    ]);
    expect(v.scene).toMatchObject({ time: "midday", light: "bright", space: "square" });
  });

  it("no mezcla mentes: un percept de otro tira", () => {
    const other = { ...percept(mother, { presence: field(true) }, "vague"), observer: mother };
    expect(() => buildPlayerView(input({ percepts: [other] }))).toThrow(RangeError);
  });

  it("es determinista", () => {
    expect(JSON.stringify(buildPlayerView(input()))).toBe(JSON.stringify(buildPlayerView(input())));
  });

  it("solo buildPlayerView arma una PlayerView", () => {
    const fake = { self: { cues: [] }, scene, percepts: [], outcomes: [], labels: [], lexicon: [] };
    const take = (v: ReturnType<typeof buildPlayerView>) => v.labels.length;
    // @ts-expect-error: sin la marca de tipo no es una PlayerView
    expect(take(fake)).toBe(0);
  });
});

describe("ambienceOf", () => {
  it("elige las texturas que valen para la escena, en orden de id", () => {
    const entries = z.array(AmbienceEntry).parse([
      { id: "b", when: { placeKinds: ["village"] }, phrases: ["gallinas"] },
      { id: "a", when: { times: ["night"] }, phrases: ["perros"] },
      { id: "c", when: { indoor: false, light: ["bright"] }, phrases: ["sol"] },
    ]);
    const v = buildPlayerView(input());
    expect(ambienceOf(v.scene, entries)).toEqual(["gallinas", "sol"]);
  });
});
