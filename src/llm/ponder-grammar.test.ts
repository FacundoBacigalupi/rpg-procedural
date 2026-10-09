import { describe, expect, it } from "vitest";
import { parseCommand } from "./grammar.ts";

describe("la gramática y las ideas sobre el campo", () => {
  it("«creo que rinde más en verano» es suponer, con las palabras del jugador", () => {
    expect(parseCommand("creo que el campo rinde más en verano")).toEqual({
      kind: "act",
      plan: {
        kind: "do",
        verb: "ponder",
        args: [{ role: "about", text: "el campo rinde más en verano" }],
      },
    });
  });

  it("una creencia que no es del campo no es suponer", () => {
    const d = parseCommand("creo que Wu miente");
    expect(d?.plan?.kind === "do" && d.plan.verb === "ponder").toBe(false);
  });
});
