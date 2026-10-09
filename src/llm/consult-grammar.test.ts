import { describe, expect, it } from "vitest";
import { parseCommand } from "./grammar.ts";

describe("la gramática y la consulta al adivino", () => {
  it("pagar y preguntar da `consult` con quién, por qué y cuánto", () => {
    expect(parseCommand("le pago dos monedas a la adivina y le pregunto por mi hijo")).toEqual({
      kind: "act",
      plan: {
        kind: "do",
        verb: "consult",
        args: [
          { role: "with", ref: { text: "adivina", kind: "person", features: ["adivina"] } },
          { role: "about", text: "mi hijo" },
          { role: "offer", text: "dos monedas" },
        ],
      },
    });
  });

  it("consultar sin pagar no pone oferta", () => {
    const d = parseCommand("consulto al adivino por la cosecha");
    const out = JSON.stringify(d);
    expect(out).toContain('"consult"');
    expect(out).toContain("la cosecha");
    expect(out).not.toContain('"offer"');
  });

  it("«voy a que me lea la suerte» es consultar, sin más datos", () => {
    expect(parseCommand("voy a que me lea la suerte")).toEqual({
      kind: "act",
      plan: { kind: "do", verb: "consult", args: [] },
    });
  });
});
