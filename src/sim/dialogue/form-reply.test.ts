import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AgentId, Rng } from "../../core/index.ts";
import type { TabooDef } from "../language/index.ts";
import type { Vector } from "../relations/index.ts";
import { understand } from "./acts.ts";
import { formalityShift, recipientBetween, type SpokenForm, spokenTaboos } from "./form.ts";
import { SpeechLine } from "./lines.ts";
import { decideReply, type ReplyInput } from "./reply.ts";

const lines = (JSON.parse(readFileSync("content/speech/es.json", "utf8")) as unknown[]).map((l) =>
  SpeechLine.parse(l),
);
const ana = "agent:1" as AgentId;
const bruno = "agent:2" as AgentId;
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
const TIGER: TabooDef = {
  id: "village.tiger",
  name: "el nombre del tigre",
  culture: "village",
  kind: "beast",
  concepts: ["tiger"],
  circumlocution: ["old", "mountain"],
  severity: 0.35,
  reason: "x",
};
const CASUAL: SpokenForm = {
  registerId: "village.shrine",
  recipient: "peer",
  used: 0,
  addressId: null,
  address: "Ana",
  words: [],
};

function input(over: Partial<ReplyInput>): ReplyInput {
  return {
    act: { kind: "greet" },
    speaker: bruno,
    listener: ana,
    feel: FEEL,
    direct: () => null,
    heard: [],
    nameOf: () => "Bruno",
    goodName: () => "grano",
    held: () => 0,
    members: 4,
    lines,
    rng: Rng.root(1),
    ...over,
  };
}

describe("la forma de lo dicho en el acto", () => {
  it("el texto corre el registro y el rango elige el trato", () => {
    expect(formalityShift("disculpe usted")).toBeGreaterThan(0);
    expect(formalityShift("callate idiota")).toBeLessThan(0);
    expect(formalityShift("hola")).toBe(0);
    expect(recipientBetween(1, 3, false)).toBe("superior");
    expect(recipientBetween(3, 1, false)).toBe("inferior");
    expect(recipientBetween(2, 2, false)).toBe("peer");
    expect(recipientBetween(1, 3, true)).toBe("intimate");
  });

  it("nombrar al tigre en el texto es decir la palabra vedada", () => {
    const gloss = (c: string) => (c === "tiger" ? "tigre" : undefined);
    expect(spokenTaboos("vi al tigre en la majada", [TIGER], "village", gloss)).toEqual([TIGER]);
    expect(spokenTaboos("vi al tigres", [TIGER], "village", gloss)).toEqual([]);
  });

  it("understand adjunta la forma sin tocar el contenido", () => {
    const lex = { people: [], goods: [] };
    const plain = understand("hola", lex);
    const formed = understand("hola", lex, 1, CASUAL);
    expect(formed.kind).toBe(plain.kind);
    expect(formed.form).toEqual(CASUAL);
    expect(plain.form).toBeUndefined();
  });

  it("un saludo casual donde se pide ceremonia ante un superior ofende y se contesta con queja", () => {
    const act = understand("hola", { people: [], goods: [] }, 1, CASUAL);
    const judge = {
      register: { formality: 0.8 },
      asRecipient: "superior" as const,
      speakerKnowsRegister: 1,
      gap: 2,
      witnesses: 3,
      hearerReverence: 0.5,
      speakerKnewTaboos: true,
    };
    const reply = decideReply(input({ act, formJudge: { taboos: [], input: judge } }), 0);
    expect(reply.line).toBe("form.offended");
    expect(reply.form?.faceLoss).toBeGreaterThan(0);
    // Sin quien lo juzgue, el saludo es un saludo.
    expect(decideReply(input({ act }), 0).line).toBe("greet");
  });
});
