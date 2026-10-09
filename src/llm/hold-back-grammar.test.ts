import { describe, expect, it } from "vitest";
import { parseCommand } from "./grammar.ts";

function strikeManner(text: string): readonly string[] | undefined {
  const d = parseCommand(text);
  return d?.plan?.kind === "do" && d.plan.verb === "strike" ? (d.plan.manner ?? []) : undefined;
}

describe("la gramática y el nivel escondido en la pelea", () => {
  it.each([
    "peleo sin esforzarme",
    "lo ataco conteniéndome",
    "le pego sin mostrar mi nivel",
    "lo golpeo sin poner toda mi fuerza",
  ])("«%s» es golpear en modo hold_back", (text) => {
    expect(strikeManner(text)).toEqual(["hold_back"]);
  });

  it("sin la frase no hay hold_back", () => {
    expect(strikeManner("lo ataco")).toEqual([]);
  });

  it("el modo no se cuela en el blanco del golpe", () => {
    const d = parseCommand("le pego al bandido sin esforzarme");
    expect(d?.plan?.kind === "do" && d.plan.args[0]?.role).toBe("target");
  });
});
