import { describe, expect, it } from "vitest";
import { feelOf, type Recap } from "../game/index.ts";
import { renderRecap } from "./render.ts";

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
});
