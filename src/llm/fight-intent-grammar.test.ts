import { describe, expect, it } from "vitest";
import { fightIntentOf } from "../game/life/act.ts";
import { parseCommand } from "./grammar.ts";

function strike(text: string) {
  const d = parseCommand(text);
  return d?.plan?.kind === "do" && d.plan.verb === "strike"
    ? { manner: d.plan.manner ?? [], args: d.plan.args }
    : undefined;
}

describe("para qué se pelea (novel3-intent-words)", () => {
  it.each([
    ["le pego a Wu para matarlo", "kill"],
    ["lo ataco a muerte", "kill"],
    ["mato a Wu", "kill"],
    ["lo mato", "kill"],
    ["reduzco a Wu", "subdue"],
    ["le pego para inmovilizarlo", "subdue"],
    ["le pego a Wu para echarlo", "drive_off"],
    ["peleo para que se vaya", "drive_off"],
    ["le pego para zafarme", "escape"],
  ])("«%s» es golpear con %s", (text, manner) => {
    expect(strike(text)?.manner).toEqual([manner]);
  });

  it("el modo no se cuela en el blanco", () => {
    const s = strike("mato a Wu");
    expect(s?.args[0]?.role).toBe("target");
    expect(strike("le pego a Wu para echarlo")?.args[0]?.role).toBe("target");
  });

  it("sin frase no hay intención y sigue la de siempre", () => {
    expect(strike("lo ataco")?.manner).toEqual([]);
    expect(fightIntentOf([])).toBe("subdue");
    expect(fightIntentOf(["fast"])).toBe("drive_off");
    expect(fightIntentOf(["fast", "kill"])).toBe("kill");
    expect(fightIntentOf(["hold_back", "escape"])).toBe("escape");
  });

  it("carnear un animal sigue siendo carnear", () => {
    expect(strike("carneo la cabra")).toBeUndefined();
  });
});
