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

describe("rendirse (novel3-intent-resolve-talk)", () => {
  function yielded(text: string) {
    const d = parseCommand(text);
    return d?.plan?.kind === "do" && d.plan.verb === "yield" ? d.plan.args : undefined;
  }

  it.each(["me rindo", "me doy por vencido", "me entrego"])("«%s» es rendirse ante nadie", (t) => {
    expect(yielded(t)).toEqual([]);
  });

  it.each(["me rindo ante Wu", "me rindo a Wu", "me entrego a Wu"])(
    "«%s» es rendirse ante Wu",
    (t) => {
      const args = yielded(t);
      expect(args?.[0]?.role).toBe("target");
      const a = args?.[0];
      expect(a && "ref" in a ? a.ref.text : undefined).toBe("Wu");
    },
  );
});

describe("practicar (novel3-spar-act)", () => {
  it.each([
    "entreno con Wu",
    "practico con Wu",
    "hago una práctica con Wu",
    "me mido con Wu",
    "practico pelea con Wu",
  ])("«%s» es pelear de práctica con Wu", (t) => {
    const s = strike(t);
    expect(s?.manner).toEqual(["spar"]);
    const a = s?.args[0];
    expect(a?.role).toBe("target");
    expect(a && "ref" in a ? a.ref.text : undefined).toBe("Wu");
    expect(fightIntentOf(s?.manner ?? [])).toBe("spar");
  });
});

describe("la técnica de ataque (novel3-technique-act)", () => {
  it.each([
    "uso la técnica contra Wu",
    "uso mi técnica contra Wu",
    "le lanzo la técnica a Wu",
    "lanzo mi técnica de ataque contra Wu",
    "le pego a Wu con la técnica",
    "ataco a Wu con mi tecnica",
  ])("«%s» es golpear a Wu con la técnica", (t) => {
    const s = strike(t);
    expect(s?.manner).toEqual(["art"]);
    const a = s?.args[0];
    expect(a?.role).toBe("target");
    expect(a && "ref" in a ? a.ref.text : undefined).toBe("Wu");
  });

  it("usar una cosa sigue siendo usarla", () => {
    const d = parseCommand("uso el hacha");
    expect(d?.plan?.kind === "do" ? d.plan.verb : undefined).toBe("use");
  });
});
