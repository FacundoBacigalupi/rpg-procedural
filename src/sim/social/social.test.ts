import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { HouseholdId } from "../../core/index.ts";
import {
  assignStatuses,
  DEFERENCE_MAX,
  deferenceEdge,
  type HouseholdSeat,
  type StatusDef,
  standingOf,
} from "./status.ts";

const defs: StatusDef[] = [
  {
    id: "landholder",
    name: "terrateniente",
    culture: "village",
    role: "holder",
    rank: 2,
    wealth: 2,
    attire: "fine",
  },
  {
    id: "peasant",
    name: "campesino libre",
    culture: "village",
    role: "common",
    rank: 1,
    wealth: 1,
    attire: "plain",
  },
  {
    id: "servant",
    name: "sirviente",
    culture: "village",
    role: "dependent",
    rank: 0,
    wealth: 0.7,
    attire: "worn",
  },
];

const seat = (n: number, members: number, since = 0): HouseholdSeat => ({
  id: `household:${n}` as HouseholdId,
  members,
  since,
});

describe("estatus de aldea", () => {
  it("con menos de tres casas no hay jerarquía", () => {
    const out = assignStatuses([seat(1, 5), seat(2, 3)], defs);
    expect([...out.values()].every((a) => a.status === "peasant")).toBe(true);
  });

  it("la casa más numerosa es la del terrateniente y la más chica le sirve", () => {
    const out = assignStatuses([seat(1, 4), seat(2, 7), seat(3, 5), seat(4, 2)], defs);
    expect(out.get(seat(2, 0).id)).toEqual({ status: "landholder", patron: null });
    expect(out.get(seat(4, 0).id)).toEqual({ status: "servant", patron: seat(2, 0).id });
    expect(out.get(seat(1, 0).id)?.status).toBe("peasant");
    expect(out.get(seat(3, 0).id)?.status).toBe("peasant");
  });

  it("con tres casas hay terrateniente pero no sirvientes", () => {
    const out = assignStatuses([seat(1, 4), seat(2, 7), seat(3, 5)], defs);
    expect([...out.values()].map((a) => a.status).sort()).toEqual([
      "landholder",
      "peasant",
      "peasant",
    ]);
  });

  it("no depende del orden de la lista y hay a lo sumo un terrateniente (propiedad)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 9 }), fc.integer({ min: 0, max: 30 })), {
          minLength: 1,
          maxLength: 12,
        }),
        (rows) => {
          const seats = rows.map(([m, s], i) => seat(i + 1, m, s));
          const a = assignStatuses(seats, defs);
          const b = assignStatuses([...seats].reverse(), defs);
          expect([...a].sort()).toEqual([...b].sort());
          const tops = [...a.values()].filter((x) => x.status === "landholder");
          expect(tops.length).toBe(seats.length >= 3 ? 1 : 0);
          for (const x of a.values()) expect(x.patron === null).toBe(x.status !== "servant");
        },
      ),
    );
  });

  it("la deferencia favorece al de arriba, es simétrica y tiene tope", () => {
    expect(deferenceEdge(2, 1)).toBeGreaterThan(0);
    expect(deferenceEdge(1, 2)).toBe(-deferenceEdge(2, 1));
    expect(deferenceEdge(1, 1)).toBe(0);
    expect(deferenceEdge(undefined, 1)).toBe(0);
    expect(deferenceEdge(50, 0)).toBe(DEFERENCE_MAX);
  });

  it("la ropa da la posición que deduce un extraño", () => {
    expect(standingOf("fine")).toBe("high");
    expect(standingOf("plain")).toBe("common");
    expect(standingOf("worn")).toBe("low");
  });
});
