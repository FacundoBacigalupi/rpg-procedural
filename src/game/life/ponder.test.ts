import { describe, expect, it } from "vitest";
import type { Event } from "../../core/index.ts";
import { candidateClaims, claimId, FIELD_YIELD } from "../../sim/index.ts";
import { claimOfText, ponderedText } from "./ponder.ts";

describe("suponer en texto libre", () => {
  it("las palabras del jugador caen en el catálogo, o en nada", () => {
    expect(claimOfText("rinde más en verano")).toEqual({
      kind: "depends",
      on: "season",
      high: [1, 2],
    });
    expect(claimOfText("rinde más entre otoño e invierno")).toEqual({
      kind: "depends",
      on: "season",
      high: [2, 3],
    });
    expect(claimOfText("rinde más con luna llena")).toEqual({
      kind: "depends",
      on: "moon",
      high: [2, 3],
    });
    expect(claimOfText("rinde menos en invierno")).toEqual({
      kind: "depends",
      on: "season",
      high: [0, 1],
    });
    expect(claimOfText("no depende de nada, es suerte")).toEqual({ kind: "none" });
    expect(claimOfText("es un castigo del Cielo")).toEqual({ kind: "moral" });
    // Lo que el catálogo no deja formular no se inventa.
    expect(claimOfText("rinde más de noche")).toBeNull();
    expect(claimOfText("rinde más en verano y en invierno")).toBeNull();
  });

  it("todo lo que devuelve está en el catálogo", () => {
    const ids = new Set(candidateClaims(FIELD_YIELD).map((c) => claimId(FIELD_YIELD, c)));
    for (const t of ["verano", "primavera", "otoño", "invierno", "luna nueva", "menguante"]) {
      for (const low of ["más", "menos"]) {
        const c = claimOfText(`rinde ${low} en ${t}`);
        if (c) expect(ids.has(claimId(FIELD_YIELD, c))).toBe(true);
      }
    }
  });

  it("el evento trae las palabras tal cual", () => {
    const e = {
      id: 7,
      kind: "action.ponder",
      actors: ["agent:1"],
      data: { effect: { kind: "ponder", about: "rinde más en verano" } },
    } as unknown as Event;
    expect(ponderedText(e)).toEqual({ who: "agent:1", about: "rinde más en verano" });
  });
});
