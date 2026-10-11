import { describe, expect, it } from "vitest";
import { planFor, routineAt } from "./routine.ts";

const DAY = 86400;
const sick = { unwell: true, larderLow: false };

describe("planFor boil", () => {
  const d = { verb: "boil", at: 900 };
  const can = { unwell: false, larderLow: false, canBoil: true };
  it("hierve en casa y despierto solo si está habilitado", () => {
    expect(planFor(19, 30, d, 1000, DAY, can).boil).toBe(true);
    expect(planFor(19, 30, d, 1000, DAY, { ...can, canBoil: false }).boil).toBeUndefined();
    expect(planFor(19, 30, d, 1000, DAY).boil).toBeUndefined();
    expect(planFor(23, 30, d, 1000, DAY, can).boil).toBeUndefined();
    expect(planFor(10, 30, d, 1000, DAY, can).boil).toBeUndefined();
  });
});

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

describe("planFor: comer decidido", () => {
  const hungry = { unwell: false, larderLow: false, hungry: true };
  it("fuera de las comidas, con hambre, saca una ración", () => {
    expect(planFor(10, 30, { verb: "eat", at: 900 }, 1000, DAY, hungry).eat).toBe(true);
  });
  it("a la hora de comer no duplica la rutina", () => {
    expect(planFor(12, 30, { verb: "eat", at: 900 }, 1000, DAY, hungry).eat).toBeUndefined();
  });
  it("sin hambre, de noche o con decisión vieja no come", () => {
    const d = { verb: "eat", at: 900 };
    expect(planFor(10, 30, d, 1000, DAY, { ...hungry, hungry: false }).eat).toBeUndefined();
    expect(planFor(23, 30, d, 1000, DAY, hungry).eat).toBeUndefined();
    expect(planFor(10, 30, d, 2 * DAY, DAY, hungry).eat).toBeUndefined();
  });
});

describe("planFor: ir hacia un lugar decidido", () => {
  const d = { verb: "move", at: 900, target: "place:4" };
  const can = { unwell: false, larderLow: false, canMove: true };
  it("despierto y con la decisión vigente va al lugar, sin cosecha", () => {
    const p = planFor(10, 30, d, 1000, DAY, can);
    expect(p).toEqual({ activity: "light", at: "home", replaced: true, move: "place:4" });
    expect(planFor(7, 30, d, 1000, DAY, can).move).toBe("place:4");
  });
  it("apagado, de noche, vieja o sin lugar no se mueve", () => {
    expect(planFor(10, 30, d, 1000, DAY).move).toBeUndefined();
    expect(planFor(10, 30, d, 1000, DAY, { ...can, canMove: false }).move).toBeUndefined();
    expect(planFor(23, 30, d, 1000, DAY, can).move).toBeUndefined();
    expect(planFor(10, 30, d, 2 * DAY, DAY, can).move).toBeUndefined();
    expect(planFor(10, 30, { ...d, target: "agent:2" }, 1000, DAY, can).move).toBeUndefined();
  });
});
