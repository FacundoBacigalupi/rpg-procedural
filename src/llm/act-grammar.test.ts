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

  it("«canjeo mis puntos por tres horas de cueva» es el canje de aportes", () => {
    expect(parseCommand("canjeo mis puntos por tres horas de cueva")).toMatchObject({
      kind: "act",
      plan: {
        verb: "redeem",
        args: [
          { role: "for", duration: { amount: 3, unit: "hour" } },
          { role: "what", text: "cueva" },
        ],
      },
    });
    expect(parseCommand("pido un pase")).toMatchObject({
      plan: { verb: "redeem", args: [{ role: "what", text: "cueva" }] },
    });
    // El pabellón de escrituras (novel2-method-pavilion).
    expect(parseCommand("pido el método siguiente")).toMatchObject({
      plan: { verb: "redeem", args: [{ role: "what", text: "técnica" }] },
    });
    expect(parseCommand("canjeo mis puntos por la técnica del reino siguiente")).toMatchObject({
      plan: { verb: "redeem", args: [{ role: "what", text: "técnica" }] },
    });
  });

  it("«pido permiso para bajar a la aldea por diez días» es el permiso de la secta", () => {
    expect(parseCommand("pido permiso para bajar a la aldea por diez días")).toMatchObject({
      kind: "act",
      plan: { verb: "furlough", args: [{ role: "for", duration: { amount: 10, unit: "day" } }] },
    });
    expect(parseCommand("pido licencia")).toMatchObject({ plan: { verb: "furlough", args: [] } });
    // El pase a la cueva sigue siendo canje.
    expect(parseCommand("pido permiso para la cueva")).not.toMatchObject({
      plan: { verb: "furlough" },
    });
  });
});
