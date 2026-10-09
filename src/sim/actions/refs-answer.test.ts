import { describe, expect, it } from "vitest";
import { answerClarify, type ClarifyOption, unknownNote } from "./refs.ts";

const opt = (ref: string, label: string, distinguishing: string[], present = false) =>
  ({ ref, label, distinguishing, present }) as unknown as ClarifyOption;

const options = [
  opt("agent:1", "Wu", ["vende té"], true),
  opt("agent:2", "Lin", ["duerme detrás"]),
  opt("agent:3", "Zhao", ["pelo gris"]),
];

describe("responder a la aclaración", () => {
  it("elige por rasgo, por orden, por presencia y por rótulo", () => {
    expect(answerClarify("el que duerme detrás", options)?.label).toBe("Lin");
    expect(answerClarify("el segundo", options)?.label).toBe("Lin");
    expect(answerClarify("el último", options)?.label).toBe("Zhao");
    expect(answerClarify("el que tengo delante", options)?.label).toBe("Wu");
    expect(answerClarify("Zhao", options)?.label).toBe("Zhao");
  });

  it("no elige si no distingue a uno solo", () => {
    expect(answerClarify("voy al río", options)).toBeUndefined();
    expect(answerClarify("", options)).toBeUndefined();
    expect(answerClarify("compro dos kilos de grano", options)).toBeUndefined();
  });

  it("lo desconocido se reformula como buscar o preguntar", () => {
    const note = unknownNote([{ text: "el herrero", features: [] }]);
    expect(note).toContain("el herrero");
    expect(note).toMatch(/buscarlo|preguntar/);
  });
});
