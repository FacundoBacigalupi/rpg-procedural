import { describe, expect, it } from "vitest";
import { aboutTopicText } from "./about.ts";

describe("qué sé de X", () => {
  it("saca de quién se pregunta", () => {
    expect(aboutTopicText("qué sé de mi padre")).toBe("padre");
    expect(aboutTopicText("¿Qué sé sobre el río?")).toBe("río");
    expect(aboutTopicText("que se de la aldea")).toBe("aldea");
    expect(aboutTopicText("qué sé de")).toBeUndefined();
  });
});
