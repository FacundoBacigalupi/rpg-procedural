import { describe, expect, it } from "vitest";
import { planFor, routineAt } from "./routine.ts";

const DAY = 86400;
const sick = { unwell: true, larderLow: false };

describe("planFor", () => {
  it("sin decisión es la rutina", () => {
    expect(planFor(10, 30, undefined, 1000, DAY, sick)).toEqual({
      ...routineAt(10, 30),
      replaced: false,
    });
  });
  it("descansar hoy estando agotado reemplaza el campo por la casa", () => {
    const p = planFor(10, 30, { verb: "rest", at: 900 }, 1000, DAY, sick);
    expect(p).toEqual({ activity: "rest", at: "home", replaced: true });
  });
  it("sin agotamiento o enfermedad la decisión no manda", () => {
    const p = planFor(10, 30, { verb: "rest", at: 900 }, 1000, DAY);
    expect(p.replaced).toBe(false);
  });
  it("con la despensa baja no se saltea la cosecha", () => {
    const p = planFor(10, 30, { verb: "rest", at: 900 }, 1000, DAY, {
      unwell: true,
      larderLow: true,
    });
    expect(p.at).toBe("fields");
  });
  it("una decisión de ayer ya no manda", () => {
    expect(planFor(10, 30, { verb: "rest", at: 0 }, 2 * DAY, DAY, sick).replaced).toBe(false);
  });
  it("de noche manda el sueño", () => {
    expect(planFor(23, 30, { verb: "rest", at: 900 }, 1000, DAY, sick).activity).toBe("sleep");
  });
});
