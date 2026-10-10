import { describe, expect, it } from "vitest";
import { incomeNeed } from "./tradechoice.ts";
import { noticeTrade, tradeBelieved } from "./tradeview.ts";

describe("ocupación de oficio como creencia", () => {
  it("quien cruza al hogar anota su oficio con el día; quien no, no sabe nada", () => {
    const book = noticeTrade(undefined, "h1", "weave-cloth", 4);
    expect(tradeBelieved(book, "h1")).toEqual({ recipe: "weave-cloth", day: 4 });
    expect(tradeBelieved(book, "h2")).toBeUndefined();
    expect(tradeBelieved(undefined, "h1")).toBeUndefined();
  });

  it("si lo cruza y ya no tiene oficio, borra lo que creía; sin nada, no cambia el libro", () => {
    const book = noticeTrade(undefined, "h1", "weave-cloth", 4);
    expect(noticeTrade(book, "h1", undefined, 9)).toEqual({ homes: {} });
    expect(noticeTrade(undefined, "h1", undefined, 9)).toBeUndefined();
  });

  it("la creencia queda vieja si no se cruzan (no se actualiza sola)", () => {
    const book = noticeTrade(undefined, "h1", "weave-cloth", 4);
    const later = noticeTrade(book, "h2", "forge-tools", 20);
    expect(tradeBelieved(later, "h1")?.day).toBe(4);
    expect(tradeBelieved(later, "h2")?.recipe).toBe("forge-tools");
  });

  it("la necesidad de ingreso crece con el apuro del hogar", () => {
    expect(incomeNeed("comfortable")).toBe(0);
    expect(incomeNeed("getting-by")).toBeLessThan(incomeNeed("tight"));
    expect(incomeNeed("broke")).toBe(1);
  });
});
