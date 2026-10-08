import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, Rng } from "../../core/index.ts";
import type { Vector } from "../relations/index.ts";
import { understand } from "./acts.ts";
import { secretAbout } from "./knowledge.ts";
import { SpeechLine } from "./lines.ts";
import { decideReply, type ReplyInput } from "./reply.ts";
import type { KeeperState } from "./secrets.ts";

const lines = (JSON.parse(readFileSync("content/speech/es.json", "utf8")) as unknown[]).map((l) =>
  SpeechLine.parse(l),
);
const ana = "agent:1" as AgentId;
const bruno = "agent:2" as AgentId;
const carla = "agent:3" as AgentId;
const lex = { people: [{ id: carla, names: ["Carla"] }], goods: [] };
const FEEL: Vector = {
  trust: 0.2,
  respect: 0,
  affection: 0.2,
  fear: 0,
  attraction: 0,
  gratitude: 0,
  jealousy: 0,
  resentment: 0,
  familiarity: 0.5,
  dependency: 0,
};
const LOOSE: KeeperState = {
  stakes: 0,
  discipline: 0,
  arousal: 1,
  intoxication: 1,
  fatigue: 1,
  pain: 0,
  trust: 1,
  affection: 1,
  believesKnown: 1,
  insight: 0,
};
const TIGHT: KeeperState = {
  ...LOOSE,
  stakes: 1,
  discipline: 1,
  arousal: 0,
  intoxication: 0,
  fatigue: 0,
  trust: -1,
  affection: -1,
  believesKnown: 0,
};

function input(over: Partial<ReplyInput>): ReplyInput {
  return {
    act: { kind: "ask", about: carla },
    speaker: bruno,
    listener: ana,
    feel: FEEL,
    direct: () => null,
    heard: [],
    nameOf: () => "Carla",
    goodName: () => "grano",
    held: () => 0,
    members: 4,
    lines,
    rng: Rng.root(1),
    ...over,
  };
}

describe("entender cómo se pregunta por alguien", () => {
  it("reconoce la maniobra y deja la pregunta de frente sin marca", () => {
    expect(understand("¿Dónde está Carla?", lex)).toEqual({ kind: "ask", about: carla });
    expect(understand("Ya me contaron lo de Carla, contame", lex)).toEqual({
      kind: "ask",
      about: carla,
      via: "feign_knowledge",
    });
    expect(understand("Contame lo de Carla, por curiosidad", lex)).toEqual({
      kind: "ask",
      about: carla,
      via: "sideways",
    });
    expect(understand("Yo te cuento un secreto si me contás lo de Carla", lex)).toEqual({
      kind: "ask",
      about: carla,
      via: "trade_secret",
    });
    expect(understand("Contame lo de Carla", lex)).toEqual({ kind: "ask", about: carla });
  });
});

describe("contestar por un secreto", () => {
  it("sin secreto es una pregunta común", () => {
    expect(decideReply(input({}), 0).secret).toBeUndefined();
  });

  it("quien guarda con todo el control no suelta, y el que está flojo sí", () => {
    const keep = (state: KeeperState, seed: number) =>
      decideReply(
        input({ keep: { state, skill: 0.5, salience: 0.8, fact: "dead" }, rng: Rng.root(seed) }),
        0,
      );
    const outcomes = (state: KeeperState) =>
      Array.from({ length: 30 }, (_v, s) => keep(state, s).secret?.result.outcome);
    expect(outcomes(TIGHT).filter((o) => o === "revealed").length).toBeLessThan(5);
    expect(outcomes(LOOSE).filter((o) => o === "revealed").length).toBeGreaterThan(15);
  });

  it("revelar deja lo dicho para quien preguntó; las otras salidas no", () => {
    fc.assert(
      fc.property(fc.nat({ max: 500 }), (seed) => {
        const r = decideReply(
          input({
            keep: { state: LOOSE, skill: 0.5, salience: 0.8, fact: "alive" },
            rng: Rng.root(seed),
          }),
          10,
        );
        expect(r.line.startsWith("ask.secret.")).toBe(true);
        if (r.secret?.result.outcome === "revealed") {
          expect(r.told).toEqual({ about: carla, claim: "alive", from: ana, at: 10 });
        } else {
          expect(r.told).toBeUndefined();
        }
      }),
      { numRuns: 25 },
    );
  });

  it("es determinista", () => {
    fc.assert(
      fc.property(fc.nat({ max: 1000 }), (seed) => {
        const mk = () =>
          decideReply(
            input({
              act: { kind: "ask", about: carla, via: "feign_knowledge" },
              keep: { state: TIGHT, skill: 0.5, salience: 0.8 },
              rng: Rng.root(seed),
            }),
            0,
          );
        expect(mk()).toEqual(mk());
      }),
      { numRuns: 25 },
    );
  });
});

describe("marcar un secreto", () => {
  it("devuelve el de mayor costo sobre esa persona", () => {
    const s = {
      items: [
        { about: carla, attr: "alive" as const, stakes: 0.2 },
        { about: carla, attr: "at" as const, stakes: 0.7 },
        { about: bruno, attr: "alive" as const, stakes: 0.9 },
      ],
    };
    expect(secretAbout(s, carla)?.stakes).toBe(0.7);
    expect(secretAbout(s, ana)).toBeUndefined();
    expect(secretAbout(undefined, carla)).toBeUndefined();
  });
});
