import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AgentId, Rng } from "../../core/index.ts";
import type { Vector } from "../relations/index.ts";
import { NO_RECOLLECTION } from "./disposition.ts";
import { SpeechLine } from "./lines.ts";
import { decideReply, type ReplyInput } from "./reply.ts";

const ana = "agent:1" as AgentId;
const bruno = "agent:2" as AgentId;
const lines = (JSON.parse(readFileSync("content/speech/es.json", "utf8")) as unknown[]).map((l) =>
  SpeechLine.parse(l),
);
const feel: Vector = {
  trust: 0.4,
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

// Bruno ofrece 1 kg de grano (6 cobres) y pide 6 monedas: Ana compra con su bolsa.
const buy = (over: Partial<ReplyInput>) =>
  decideReply(
    {
      act: {
        kind: "offer",
        give: { good: "grain", grams: 1000 },
        want: { good: "copper", grams: 6 },
      },
      speaker: bruno,
      listener: ana,
      feel,
      direct: () => null,
      heard: [],
      nameOf: () => "Bruno",
      goodName: (g) => g,
      held: (g) => (g === "copper" ? 100 : 0),
      members: 1,
      isCoin: (g) => g === "copper",
      worth: (g) => (g === "copper" ? 1000 : 6),
      speakerHas: () => 5000,
      recollection: NO_RECOLLECTION,
      lines,
      rng: Rng.root(1),
      ...over,
    } as ReplyInput,
    0,
  );

describe("el tope de gasto del hogar en las compras", () => {
  it("sin tope compra; con tope bajo la compra no se cierra", () => {
    expect(buy({}).deal).toBeDefined();
    expect(buy({ coinCeiling: 100 }).deal).toBeDefined();
    expect(buy({ coinCeiling: 2 }).deal).toBeUndefined();
    expect(buy({ coinCeiling: 0 }).deal).toBeUndefined();
  });
});
