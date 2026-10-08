import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AgentId } from "../../core/index.ts";
import { appealOf, understand } from "./acts.ts";

const ana = "agent:1" as AgentId;
const bruno = "agent:2" as AgentId;
const lex = {
  people: [{ id: bruno, names: ["Bruno", "hermano"] }],
  goods: [{ id: "grain", names: ["grano"] }],
};

describe("razones (argue)", () => {
  it("entiende las razones del léxico", () => {
    expect(understand("Hacelo por tu hermano", lex)).toEqual({
      kind: "argue",
      reason: { kind: "relation", with: bruno },
    });
    expect(understand("Es la costumbre, no se discute", lex)).toEqual({
      kind: "argue",
      reason: { kind: "norm", norm: "custom" },
    });
    expect(understand("Cuidado, te van a matar", lex)).toEqual({
      kind: "argue",
      reason: { kind: "fear", danger: "death" },
    });
    expect(understand("Si no vas quedas mal", lex)).toEqual({
      kind: "argue",
      reason: { kind: "face", whose: null },
    });
    expect(understand("Lo manda el anciano", lex)).toEqual({
      kind: "argue",
      reason: { kind: "authority", source: "anciano" },
    });
    expect(understand("Me lo debes, te ayudé antes", lex).kind).toBe("argue");
  });

  it("un pedido o una pregunta ganan sobre la razón, y la charla común no es razón", () => {
    expect(understand("Dame grano, es la costumbre", lex).kind).toBe("request");
    expect(understand("¿Dónde está Bruno? Es peligroso", lex).kind).toBe("ask");
    expect(understand("Hace buen tiempo hoy", lex).kind).toBe("other");
  });

  it("con la voz turbia no se entiende de quién", () => {
    expect(understand("Hacelo por tu hermano", lex, 0.1)).toEqual({
      kind: "argue",
      reason: { kind: "relation", with: null },
    });
  });

  it("appealOf: la cara sin dueño es la del oyente; sin de quién no hay apelación", () => {
    expect(appealOf({ kind: "face", whose: null }, ana)).toEqual({ kind: "face", whose: ana });
    expect(appealOf({ kind: "relation", with: null }, ana)).toBeNull();
    expect(appealOf({ kind: "relation", with: bruno }, ana)).toEqual({
      kind: "relation",
      with: bruno,
    });
  });

  it("entender es determinista y nunca tira", () => {
    fc.assert(
      fc.property(fc.string(), fc.nat(100), (text, c) => {
        const a = understand(text, lex, c / 100);
        expect(understand(text, lex, c / 100)).toEqual(a);
      }),
    );
  });
});
