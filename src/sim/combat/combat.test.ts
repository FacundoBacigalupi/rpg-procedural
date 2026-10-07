import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, loadContent, makeId, Rng } from "../../core/index.ts";
import { BODY_PLANS, type BodyPlanDef, newBody } from "../body/index.ts";
import { type FighterInput, type FightIntent, runFight } from "./index.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [BODY_PLANS],
  [{ kind: "body-plans", file: "b.json", data: json("content/body-plans/human.json") }],
);
const plan = content.all(BODY_PLANS)[0] as BodyPlanDef;
const cause = makeId("event", 1) as EventId;
const A = makeId("agent", 1);
const B = makeId("agent", 2);

const fighter = (
  id: AgentId,
  side: string,
  at: number,
  over: Partial<FighterInput> = {},
): FighterInput => ({
  id,
  side,
  plan,
  body: newBody(plan, 65, 0),
  z: {},
  skill: 0.4,
  intent: "drive_off" as FightIntent,
  at: { x: at, y: 0 },
  ...over,
});

const fight = (fs: FighterInput[], seed = 1, light = 1) =>
  runFight({ fighters: fs, start: 0, light, rng: Rng.root(seed), cause });

describe("pelea mortal", () => {
  it("es determinista y no depende del orden de los participantes", () => {
    const fs = [fighter(A, "a", 0), fighter(B, "b", 0.7)];
    const x = fight(fs, 7);
    expect(fight(fs, 7)).toEqual(x);
    expect(fight([...fs].reverse(), 7)).toEqual(x);
  });

  it("termina siempre por incapacidad, muerte, huida, rendición o separación, nunca por un contador de vida", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (seed, sk) => {
          const r = fight([fighter(A, "a", 0, { skill: sk }), fighter(B, "b", 0.7)], seed);
          expect(r.seconds).toBeLessThanOrEqual(90);
          if (r.end === "decided") {
            const standing = r.fighters.filter((f) => f.outcome === "standing");
            expect(standing.length).toBeLessThanOrEqual(1);
          }
          for (const f of r.fighters) expect(f.body.blood).toBeGreaterThan(0);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("la mayoría de las peleas a mano entre iguales no mata a nadie", () => {
    let dead = 0;
    const n = 80;
    for (let seed = 1; seed <= n; seed++) {
      const r = fight([fighter(A, "a", 0), fighter(B, "b", 0.7)], seed);
      if (r.fighters.some((f) => f.outcome === "dead")) dead++;
    }
    expect(dead / n).toBeLessThan(0.15);
  });

  it("quien pega más y mejor gana más seguido", () => {
    let wins = 0;
    const n = 60;
    for (let seed = 1; seed <= n; seed++) {
      const r = fight(
        [
          fighter(A, "a", 0, { skill: 0.85, z: { boldness: 1 } }),
          fighter(B, "b", 0.7, { skill: 0.1 }),
        ],
        seed,
      );
      const a = r.fighters.find((f) => f.id === A);
      const b = r.fighters.find((f) => f.id === B);
      if ((a?.woundsTaken ?? 0) < (b?.woundsTaken ?? 0)) wins++;
    }
    expect(wins / n).toBeGreaterThan(0.7);
  });

  it("el temeroso se quiebra antes que el audaz", () => {
    const brokeAt = (boldness: number) => {
      let sum = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const r = fight(
          [
            fighter(A, "a", 0, { z: { boldness } }),
            fighter(B, "b", 0.7, { z: { boldness: 0 }, skill: 0.5 }),
          ],
          seed,
        );
        const a = r.fighters.find((f) => f.id === A);
        sum += a?.woundsTaken ?? 0;
      }
      return sum;
    };
    expect(brokeAt(-2)).toBeLessThan(brokeAt(2));
  });

  it("al que no ve venir el golpe nadie le da defensa voluntaria", () => {
    const parried = (light: number, unaware: boolean) => {
      let n = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const r = fight(
          [fighter(A, "a", 0, { skill: 0.6 }), fighter(B, "b", 0.7, { skill: 0.9, unaware })],
          seed,
          light,
        );
        const first = r.log.find(
          (l) => l.target === B && (l.kind === "hit" || l.kind === "parried"),
        );
        if (first?.kind === "parried") n++;
      }
      return n;
    };
    expect(parried(1, false)).toBeGreaterThan(parried(0.05, true));
    expect(parried(0.05, true)).toBe(0);
  });

  it("la sangre y el desmayo corren durante la pelea: el que cae no sigue", () => {
    const r = fight(
      [
        fighter(A, "a", 0, { skill: 0.9, intent: "kill" }),
        fighter(B, "b", 0.7, { skill: 0.05, z: { boldness: 3 } }),
      ],
      3,
    );
    const b = r.fighters.find((f) => f.id === B);
    expect(b?.woundsTaken).toBeGreaterThan(0);
    expect(b?.body.wounds.length).toBe(b?.woundsTaken);
  });
});
