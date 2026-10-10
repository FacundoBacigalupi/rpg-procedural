import { describe, expect, it } from "vitest";
import { incomeNeed } from "./tradechoice.ts";
import { misreadTrade, noticeTrade, tradeBelieved } from "./tradeview.ts";

describe("creer un oficio equivocado", () => {
  const all = ["weave-cloth", "forge-tools", "bake-bread"];
  it("con la tirada bajo la chance aparenta otro oficio, nunca el cierto", () => {
    expect(misreadTrade("weave-cloth", all, 0.2, 0.1, 0)).toBe("bake-bread");
    expect(misreadTrade("weave-cloth", all, 0.2, 0.1, 0.99)).toBe("forge-tools");
  });
  it("con la tirada sobre la chance, o sin otro donde elegir, lo ve bien", () => {
    expect(misreadTrade("weave-cloth", all, 0.2, 0.5, 0)).toBe("weave-cloth");
    expect(misreadTrade("weave-cloth", ["weave-cloth"], 1, 0, 0)).toBe("weave-cloth");
  });
});

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
