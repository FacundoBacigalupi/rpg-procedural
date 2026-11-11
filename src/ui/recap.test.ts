import { describe, expect, it } from "vitest";
import { feelOf, type Recap } from "../game/index.ts";
import { RESUME_READ_CHARS, renderRecap, renderResume } from "./render.ts";

describe("recuento al volver", () => {
  it("la valencia se resume en cómo le quedó", () => {
    expect(feelOf(-0.6)).toBe("bad");
    expect(feelOf(0.5)).toBe("good");
    expect(feelOf(0.05)).toBe("neutral");
  });

  it("cuenta lo último que hacía y lo que recuerda, con nombres solo de conocidos", () => {
    const r: Recap = {
      lastDid: "work",
      lastDidDaysAgo: 0,
      recent: [
        { kind: "body.died", daysAgo: 1, feel: "bad", with: ["Wu"] },
        { kind: "action.give", daysAgo: 3, feel: "good", with: [] },
      ],
    };
    const text = renderRecap(r);
    expect(text).toContain("trabajando");
    expect(text).toContain("la muerte de alguien con Wu, ayer, y todavía pesa");
    expect(text).toContain("un regalo, hace 3 días, y fue bueno");
    expect(renderRecap({ recent: [] })).toBe("");
  });

  it("al retomar repite lo último leído, salta el título de capítulo y suma las metas", () => {
    const last = "Capítulo 2 · Otoño del año 70\n\nPrimero algo.\n\nAl final, el río.";
    const text = renderResume(last, "Recordás un regalo, ayer.", ["entrar a una secta"]);
    expect(text.split("\n")).toEqual([
      "Donde lo dejaste: Al final, el río.",
      "Recordás un regalo, ayer.",
      "Lo que te proponés: entrar a una secta.",
    ]);
    const long = renderResume("x".repeat(RESUME_READ_CHARS + 50), "", []);
    expect(long).toBe(`Donde lo dejaste: …${"x".repeat(RESUME_READ_CHARS)}`);
    expect(renderResume(undefined, "", [])).toBe("");
  });
});
