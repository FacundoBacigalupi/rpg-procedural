import { describe, expect, it } from "vitest";
import type { AgentId } from "../../core/index.ts";
import { duelVictor } from "./duels.ts";

const A = "agent:1" as AgentId;
const B = "agent:2" as AgentId;

describe("quién gana un duelo (novel3-challenge-fight)", () => {
  it("gana quien queda en pie con el otro rendido, caído, muerto o huido", () => {
    for (const lost of ["yielded", "down", "dead", "fled"]) {
      expect(
        duelVictor({ actors: [A, B], data: { outcomes: { [A]: "standing", [B]: lost } } }),
      ).toEqual({ winner: A, loser: B });
    }
  });

  it("sin vencedor claro, nada", () => {
    expect(
      duelVictor({ actors: [A, B], data: { outcomes: { [A]: "standing", [B]: "standing" } } }),
    ).toBeUndefined();
    expect(
      duelVictor({ actors: [A, B], data: { outcomes: { [A]: "down", [B]: "down" } } }),
    ).toBeUndefined();
  });

  it("a primera sangre pierde quien sangró en el último pulso; si sangraron los dos, nada", () => {
    const hits = [
      { t: 3, to: A },
      { t: 5, to: B },
    ];
    expect(duelVictor({ actors: [A, B], data: { end: "first_blood", hits } })).toEqual({
      winner: A,
      loser: B,
    });
    expect(
      duelVictor({
        actors: [A, B],
        data: { end: "first_blood", hits: [...hits, { t: 5, to: A }] },
      }),
    ).toBeUndefined();
  });
});
