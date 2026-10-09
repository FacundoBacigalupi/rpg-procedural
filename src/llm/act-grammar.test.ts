import { describe, expect, it } from "vitest";
import { parseCommand } from "./grammar.ts";

function speechOf(input: string): { text: string; to?: unknown; act?: unknown } {
  const d = parseCommand(input) as unknown as { speech?: { text: string; to?: unknown } };
  expect(d.speech).toBeDefined();
  return d.speech as { text: string; to?: unknown; act?: unknown };
}

describe("la gramática y el acto de habla declarado", () => {
  it("«le pregunto a X por Y» declara ask con lo preguntado", () => {
    const s = speechOf("le pregunto al viejo por mi hermana");
    expect(s.act).toMatchObject({ kind: "ask", about: { text: "mi hermana" } });
    expect(s.to).toMatchObject({ text: "el viejo" });
  });

  it("saludar y despedirse declaran greet y farewell", () => {
    expect(speechOf("saludo a Wu").act).toEqual({ kind: "greet" });
    expect(speechOf("me despido de Wu").act).toEqual({ kind: "farewell" });
    expect(speechOf("lo saludo").act).toEqual({ kind: "greet" });
  });

  it("«le pido X al Y» declara request con lo pedido", () => {
    expect(speechOf("le pido plata al mercader").act).toMatchObject({
      kind: "request",
      what: "plata",
    });
  });
});
