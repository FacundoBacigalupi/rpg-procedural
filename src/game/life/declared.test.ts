import { describe, expect, it } from "vitest";
import { makeId } from "../../core/index.ts";
import type { Lexicon, SpeechAct } from "../../sim/index.ts";
import { withDeclared } from "./converse.ts";

const wu = makeId("agent", 7);
const lex: Lexicon = {
  people: [{ id: wu, names: ["Wu"] }],
  goods: [{ id: "good:grain", names: ["grano"] }],
};
const other: SpeechAct = { kind: "other" };

describe("el acto declarado en la conversación", () => {
  it("si las palabras no captaron nada, el oyente toma el acto declarado", () => {
    expect(withDeclared(other, { kind: "ask", about: wu }, lex, 1)).toEqual({
      kind: "ask",
      about: wu,
    });
    expect(withDeclared(other, { kind: "request", what: "grano" }, lex, 1)).toEqual({
      kind: "request",
      good: "good:grain",
    });
  });

  it("completa la promesa con los términos declarados sin pisar los dichos", () => {
    const heard: SpeechAct = { kind: "promise", good: null, grams: null };
    const out = withDeclared(
      heard,
      { kind: "promise", what: "grano", times: 2, dueDays: 90, precision: 0.75 },
      lex,
      1,
    );
    expect(out).toMatchObject({
      kind: "promise",
      good: "good:grain",
      terms: { times: 2, dueDays: 90, precision: 0.75 },
    });
    const said: SpeechAct = { kind: "promise", good: null, grams: null, terms: { times: 3 } };
    expect(withDeclared(said, { kind: "promise", what: null, times: 2 }, lex, 1)).toMatchObject({
      terms: { times: 3 },
    });
  });

  it("con la voz turbia no llega el detalle", () => {
    expect(withDeclared(other, { kind: "greet" }, lex, 0.2)).toBe(other);
  });
});
