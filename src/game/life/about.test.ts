import { describe, expect, it } from "vitest";
import { parseCommand } from "../../llm/grammar.ts";
import { aboutTopicText } from "./about.ts";

describe("qué sé de X", () => {
  it("saca de quién se pregunta", () => {
    expect(aboutTopicText("qué sé de mi padre")).toBe("padre");
    expect(aboutTopicText("¿Qué sé sobre el río?")).toBe("río");
    expect(aboutTopicText("que se de la aldea")).toBe("aldea");
    expect(aboutTopicText("qué sé de")).toBeUndefined();
  });

  it("la gramática lo toma como comando fuera del personaje", () => {
    expect(parseCommand("qué sé de mi madre")?.kind).toBe("meta");
    expect(parseCommand("¿qué sé de mi madre?")?.kind).toBe("meta");
  });
});
