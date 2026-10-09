import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AgentId, Rng } from "../../core/index.ts";
import type { Vector } from "../relations/index.ts";
import { understand } from "./acts.ts";
import { SpeechLine } from "./lines.ts";
import { decideReply, type ReplyInput } from "./reply.ts";

const FEEL: Vector = {
  trust: 0.3,
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
const lines = (JSON.parse(readFileSync("content/speech/es.json", "utf8")) as unknown[]).map((l) =>
  SpeechLine.parse(l),
);
const ana = "agent:1" as AgentId;
const bruno = "agent:2" as AgentId;
const carla = "agent:3" as AgentId;
const lex = {
  people: [
    { id: bruno, names: ["Bruno"] },
    { id: carla, names: ["Carla"] },
  ],
  goods: [],
};

const reply = (text: string, over: Partial<ReplyInput> = {}) =>
  decideReply(
    {
      act: understand(text, lex),
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
    },
    0,
  );

describe("rumores que el personaje cuenta", () => {
  it("«dicen que» con un hecho es un rumor, no una acusación", () => {
    expect(understand("Dicen que Bruno le robó a Carla", lex)).toEqual({
      kind: "rumor",
      deed: "theft",
      by: bruno,
      victim: carla,
    });
    expect(understand("Bruno le robó a Carla", lex).kind).toBe("accuse");
  });

  it("el oyente lo pesa según lo que ya hizo hearRumor", () => {
    const r = reply("Dicen que Bruno le robó a Carla", { hearsay: { verdict: "believed" } });
    expect(r.line).toBe("rumor.believed");
    expect(r.rumor?.verdict).toBe("believed");
    expect(reply("Dicen que Bruno le robó a Carla").line).toBe("rumor.idle");
  });

  it("«¿quién te lo dijo?» se contesta con la fuente que recuerda", () => {
    expect(understand("¿Quién te lo dijo?", lex)).toEqual({ kind: "source", about: null });
    expect(
      reply("¿Quién te lo dijo?", { source: { kind: "named", name: "Carla", voices: 1 } }).text,
    ).toContain("Carla");
    expect(reply("¿Quién te lo dijo?", { source: { kind: "crowd", voices: 2 } }).line).toBe(
      "source.crowd",
    );
    expect(reply("¿Quién te lo dijo?").line).toBe("source.none");
  });
});
