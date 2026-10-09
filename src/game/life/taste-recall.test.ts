import { describe, expect, it } from "vitest";
import { makeId } from "../../core/index.ts";
import { tasteRecall } from "./view.ts";

const ev = (n: number) => makeId("event", n);
const mem = (n: number, valence: number, intensity = 0.5) => ({
  eventId: ev(n),
  valence,
  intensity,
});

describe("gusto ligado a un recuerdo", () => {
  it("un origen que recuerda mal o bien lo cuenta así", () => {
    expect(tasteRecall([mem(1, -0.7)], [ev(1)])).toBe("ill");
    expect(tasteRecall([mem(1, 0.6)], [ev(1)])).toBe("good");
  });

  it("sin la memoria, con una valencia tibia o sin origen no hay recuerdo", () => {
    expect(tasteRecall([], [ev(1)])).toBeUndefined();
    expect(tasteRecall([mem(1, 0.1)], [ev(1)])).toBeUndefined();
    expect(tasteRecall([mem(2, -0.9)], [ev(1)])).toBeUndefined();
    expect(tasteRecall([mem(1, -0.9)], [])).toBeUndefined();
  });

  it("gana la memoria más intensa", () => {
    expect(tasteRecall([mem(1, 0.6, 0.2), mem(2, -0.6, 0.9)], [ev(1), ev(2)])).toBe("ill");
  });
});
