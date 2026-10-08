import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK } from "../../core/index.ts";
import { GRAIN_EATEN_PER_PERSON_DAY_G, LARDER_MARGIN_DAYS, larderNeeded } from "./larder.ts";

const clock = EARTHLIKE_CLOCK;
const YEAR = Math.round(clock.year / clock.day);
const family = [35, 33, 25, 12, 1];
const margin = family.length * GRAIN_EATEN_PER_PERSON_DAY_G * LARDER_MARGIN_DAYS;

describe("despensa de arranque", () => {
  it("con cosecha pareja todo el año solo queda el margen del granero", () => {
    expect(larderNeeded(family, clock, () => 1, 0)).toBe(margin);
  });

  it("sin cosecha en medio año hay que guardar para esos meses", () => {
    const winter = (d: number) => (d % YEAR < YEAR / 2 ? 0 : 2);
    const need = larderNeeded(family, clock, winter, 0);
    expect(need).toBeGreaterThan(
      margin + (family.length * GRAIN_EATEN_PER_PERSON_DAY_G * YEAR) / 3,
    );
  });

  it("empezar justo antes del invierno pide más que empezar después de la cosecha", () => {
    const f = (d: number) => (d % YEAR < YEAR / 2 ? 0 : 2);
    // Medio año sin cosecha seguido de medio año generoso: empezar en el medio (con la cosecha por
    // delante) necesita menos que empezar al principio (con el invierno por delante).
    expect(larderNeeded(family, clock, f, YEAR / 2)).toBeLessThan(
      larderNeeded(family, clock, f, 0),
    );
  });

  it("más brazos en el campo, menos reserva; un hogar de chicos pide más", () => {
    const f = (d: number) => (d % YEAR < YEAR / 2 ? 0 : 2);
    const kids = [8, 6, 4, 1];
    const adults = [30, 28, 26, 24];
    expect(larderNeeded(adults, clock, f, 0)).toBeLessThan(larderNeeded(kids, clock, f, 0));
  });
});
