import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, Rng } from "../../core/index.ts";
import type { Vector } from "../relations/index.ts";
import { understand } from "./acts.ts";
import { NO_RECOLLECTION } from "./disposition.ts";
import { SpeechLine } from "./lines.ts";
import { credence, decideReply, type ReplyInput } from "./reply.ts";

const ana = "agent:1" as AgentId;
const bruno = "agent:2" as AgentId;

describe("promesas en el diálogo", () => {
  const lines = (JSON.parse(readFileSync("content/speech/es.json", "utf8")) as unknown[]).map((l) =>
    SpeechLine.parse(l),
  );
  const lex = { people: [], goods: [{ id: "grain", names: ["grano"] }] };
  const f = (over: Partial<Vector>): Vector => ({
    trust: 0.2,
    respect: 0,
    affection: 0,
    fear: 0,
    attraction: 0,
    gratitude: 0,
    jealousy: 0,
    resentment: 0,
    familiarity: 0.5,
    dependency: 0,
    ...over,
  });
  const reply = (feel: Vector, text: string, over: Partial<ReplyInput> = {}) =>
    decideReply(
      {
        act: understand(text, lex),
        speaker: bruno,
        listener: ana,
        feel,
        direct: () => null,
        heard: [],
        nameOf: () => "Bruno",
        goodName: () => "grano",
        held: () => 0,
        members: 1,
        lines,
        rng: Rng.root(1),
        ...over,
      },
      0,
    );

  it("entiende promesas con cantidad y las distingue de un pedido", () => {
    expect(understand("Te prometo que te devuelvo 2 kilos de grano", lex)).toEqual({
      kind: "promise",
      good: "grain",
      grams: 2000,
    });
    expect(understand("Te juro que te lo pago", lex)).toEqual({
      kind: "promise",
      good: null,
      grams: null,
    });
    expect(understand("Dame grano, te lo devuelvo", lex).kind).toBe("request");
  });

  it("acepta la palabra de quien se confía, la duda de quien fue traicionado, y pide precisión", () => {
    const a = reply(f({}), "Te prometo 500 gramos de grano");
    expect(a.line).toBe("promise.accept");
    expect(a.pledge).toEqual({ good: "grain", grams: 500 });
    expect(reply(f({}), "Te prometo 500 gramos de grano", { reproach: "theft" }).line).toBe(
      "promise.doubt",
    );
    expect(
      reply(f({}), "Te prometo 500 gramos de grano", { owes: { grams: 100, overdue: true } }).line,
    ).toBe("promise.doubt");
    expect(reply(f({}), "Te prometo que todo va a estar bien").line).toBe("promise.vague");
  });

  it("la credulidad está acotada y sube con la confianza", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        (trust, resentment) => {
          const c = credence(f({ trust, resentment }), NO_RECOLLECTION);
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(1);
        },
      ),
    );
    expect(credence(f({ trust: 0.6 }), NO_RECOLLECTION)).toBeGreaterThan(
      credence(f({ trust: -0.2 }), NO_RECOLLECTION),
    );
  });
});
