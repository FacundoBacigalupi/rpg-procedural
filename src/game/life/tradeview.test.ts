import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, makeId, Rng } from "../../core/index.ts";
import { ASLEEP, LOCATION, PERSON, type ProcessContext, WorldTruth } from "../../sim/index.ts";
import { incomeNeed } from "./tradechoice.ts";
import {
  apprenticeOf,
  misreadTrade,
  noticeTrade,
  TRADE_VIEW,
  tradeBelieved,
  tradeViewProcess,
} from "./tradeview.ts";

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

  it("actualizar el hogar conserva las creencias sobre personas", () => {
    const people = { "agent:3": { recipe: "forge-tools", day: 2 } };
    expect(noticeTrade({ homes: {}, people }, "h1", "weave-cloth", 4)?.people).toEqual(people);
  });
});

describe("limpieza de trade_view sin componentes inexistentes", () => {
  function population() {
    const truth = new WorldTruth();
    for (let i = 1; i <= 3; i++) {
      truth.setRaw(PERSON.name, makeId("agent", i), {
        household: `household:${i}`,
        born: -20 * EARTHLIKE_CLOCK.year,
      });
      truth.setRaw(LOCATION.name, makeId("agent", i), { hex: i === 3 ? 9 : 0 });
    }
    truth.setRaw(ASLEEP.name, makeId("agent", 3), { since: 0 });
    return truth;
  }

  function run(truth: WorldTruth, people: boolean) {
    return tradeViewProcess({
      clock: EARTHLIKE_CLOCK,
      recipes: [],
      assignments: [],
      people,
      misread: { chance: 0.1 },
    }).run({
      truth,
      now: EARTHLIKE_CLOCK.day,
      rng: Rng.root(1),
    } as unknown as ProcessContext);
  }

  it.each([false, true])("sin oficios ni recuerdos previos no borra nada (people=%s)", (people) => {
    const truth = population();
    expect(run(truth, people).changes).toEqual([]);
  });

  it("borra el último recuerdo existente, sin tocar al dormido distante", () => {
    const truth = population();
    truth.setRaw(TRADE_VIEW.name, makeId("agent", 1), {
      homes: { "household:2": { recipe: "forge-tools", day: 0 } },
    });
    truth.setRaw(TRADE_VIEW.name, makeId("agent", 3), {
      homes: { "household:2": { recipe: "forge-tools", day: 0 } },
    });
    expect(run(truth, true).changes).toEqual([
      { op: "delete", table: TRADE_VIEW.name, id: "agent:1" },
    ]);
  });

  it("conserva una creencia personal no observada aunque ya no haya creencias de hogares", () => {
    const truth = population();
    const people = { "agent:3": { recipe: "forge-tools", day: 0 } };
    truth.setRaw(TRADE_VIEW.name, makeId("agent", 1), {
      homes: { "household:2": { recipe: "forge-tools", day: 0 } },
      people,
    });
    expect(run(truth, true).changes).toEqual([
      { op: "set", table: TRADE_VIEW.name, id: "agent:1", value: { homes: {}, people } },
    ]);
  });
});

describe("aprendiz tomado por maestro", () => {
  it("el menor sin oficio en casa se cree aprendiz del maestro presente", () => {
    expect(apprenticeOf(undefined, [undefined, "forge-tools"])).toBe("forge-tools");
    expect(apprenticeOf("weave-cloth", ["forge-tools"])).toBe("weave-cloth");
    expect(apprenticeOf(undefined, [undefined])).toBeUndefined();
  });
});
