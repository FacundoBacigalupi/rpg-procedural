import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, loadContent, makeId, Rng } from "../../core/index.ts";
import { BODY_PLANS, type BodyPlanDef, newBody } from "../body/index.ts";
import { refinementOf } from "../cultivation/index.ts";
import {
  type FighterInput,
  type FighterWeapon,
  type FightIntent,
  PAUSE_MIN_PULSES,
  runFight,
} from "./index.ts";

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

describe("pausas del jugador entre pulsos", () => {
  const duel = (seed: number, control?: AgentId) => {
    const fs = [fighter(A, "a", 0), fighter(B, "b", 0.7)];
    return runFight({
      fighters: fs,
      start: 0,
      light: 1,
      rng: Rng.root(seed),
      cause,
      ...(control ? { control } : {}),
    });
  };

  /** Sigue una pelea pausada hasta el final, devolviendo los tramos. */
  const follow = (seed: number) => {
    const slices = [duel(seed, A)];
    let fs = [fighter(A, "a", 0), fighter(B, "b", 0.7)];
    for (let last = slices[0]; last?.paused && slices.length < 40; last = slices.at(-1)) {
      const { snapshot } = last.paused;
      fs = fs.map((f) => ({
        ...f,
        body: last.fighters.find((x) => x.id === f.id)?.body ?? f.body,
      }));
      slices.push(
        runFight({
          fighters: fs,
          start: snapshot.next,
          light: 1,
          rng: Rng.root(seed),
          cause,
          control: A,
          resume: snapshot,
        }),
      );
    }
    return slices;
  };

  it("sin control no pausa nunca", () => {
    for (let seed = 1; seed <= 30; seed++) expect(duel(seed).paused).toBeUndefined();
  });

  it("pausa cuando el jugador siente una herida y retomada llega al mismo final", () => {
    let paused = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const slices = follow(seed);
      const whole = duel(seed);
      if (slices.length > 1) paused++;
      const last = slices.at(-1);
      expect(last?.paused).toBeUndefined();
      expect(last?.end).toBe(whole.end);
      expect(last?.fighters.map((f) => f.outcome)).toEqual(whole.fighters.map((f) => f.outcome));
      expect(slices.reduce((n, s) => n + s.seconds, 0)).toBe(whole.seconds);
    }
    expect(paused).toBeGreaterThan(5);
  });

  it("nunca pausa antes de PAUSE_MIN_PULSES ni cuando no hay quien decida", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = duel(seed, A);
      if (r.paused) expect(r.seconds).toBeGreaterThanOrEqual(PAUSE_MIN_PULSES);
    }
  });
});

describe("pelea con lectura", () => {
  const read = (fs: FighterInput[], seed: number) =>
    runFight({ fighters: fs, start: 0, light: 1, rng: Rng.root(seed), cause, reading: true });

  it("es determinista, termina y no depende del orden", () => {
    fc.assert(
      fc.property(fc.nat(5000), (seed) => {
        const fs = [fighter(A, "a", 0, { skill: 0.8 }), fighter(B, "b", 0.7)];
        const x = read(fs, seed);
        expect(read(fs, seed)).toEqual(x);
        expect(read([...fs].reverse(), seed)).toEqual(x);
        expect(x.seconds).toBeLessThanOrEqual(90);
      }),
    );
  });

  it("quien sabe pelear finta y el defensor la compra o la lee", () => {
    let feints = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = read(
        [fighter(A, "a", 0, { skill: 1 }), fighter(B, "b", 0.7, { skill: 0.2 })],
        seed,
      );
      feints += r.log.filter((l) => l.kind === "feint").length;
    }
    expect(feints).toBeGreaterThan(0);
  });

  it("sin la opción de lectura no hay fintas", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = fight([fighter(A, "a", 0, { skill: 1 }), fighter(B, "b", 0.7)], seed);
      expect(r.log.some((l) => l.kind === "feint")).toBe(false);
    }
  });
});

describe("cuerpo templado (novel3-refined-core)", () => {
  const wins = (refined?: FighterInput["refined"]) => {
    let won = 0;
    let wounds = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = fight([fighter(A, "a", 0, refined ? { refined } : {}), fighter(B, "b", 0.7)], seed);
      const a = r.fighters.find((f) => f.id === A);
      const b = r.fighters.find((f) => f.id === B);
      if (a?.outcome === "standing" && b?.outcome !== "standing") won++;
      wounds += a?.woundsTaken ?? 0;
    }
    return { won, wounds };
  };

  it("sin cultivo, la pelea es la misma con o sin el campo", () => {
    const fs = [fighter(A, "a", 0), fighter(B, "b", 0.7)];
    const mortal = [fighter(A, "a", 0, { refined: refinementOf(0) }), fs[1] as FighterInput];
    for (const seed of [1, 2, 3, 9]) expect(fight(mortal, seed)).toEqual(fight(fs, seed));
  });

  it("el tramo vuelve el cuerpo más rápido, duro, con aire y fuerza, con tope en la dureza", () => {
    expect(refinementOf(0)).toEqual({ speed: 1, hardness: 0, endurance: 1, might: 1 });
    const two = refinementOf(2);
    expect(two.speed).toBeGreaterThan(1);
    expect(two.hardness).toBeGreaterThan(0);
    expect(refinementOf(50).hardness).toBeLessThanOrEqual(0.8);
  });

  it("un cultivador le gana a un mortal igual de hábil más seguido y recibe menos, determinista", () => {
    const mortal = wins();
    const refined = wins(refinementOf(2));
    expect(refined.won).toBeGreaterThan(mortal.won);
    expect(refined.won).toBeGreaterThan(40);
    expect(refined.wounds).toBeLessThan(mortal.wounds);
    const fs = [fighter(A, "a", 0, { refined: refinementOf(3) }), fighter(B, "b", 0.7)];
    expect(fight([...fs].reverse(), 4)).toEqual(fight(fs, 4));
  });
});

describe("práctica (novel3-spar-core)", () => {
  const spar = (seed: number, over: Partial<FighterInput> = {}) =>
    fight(
      [fighter(A, "a", 0, { intent: "spar", ...over }), fighter(B, "b", 0.7, { intent: "spar" })],
      seed,
    );
  const real = (seed: number) =>
    fight(
      [fighter(A, "a", 0, { intent: "subdue" }), fighter(B, "b", 0.7, { intent: "subdue" })],
      seed,
    );
  const worst = (r: ReturnType<typeof fight>) =>
    Math.max(0, ...r.fighters.flatMap((f) => f.body.wounds.map((w) => w.severity)));

  it("es determinista y termina por concesión, nunca con muerte ni huida", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = spar(seed);
      expect(spar(seed)).toEqual(r);
      for (const f of r.fighters) expect(["standing", "yielded"]).toContain(f.outcome);
      expect(r.log.some((l) => l.kind === "flee")).toBe(false);
    }
  });

  it("los golpes frenados lastiman menos que una pelea de verdad, sin cabeza ni cuello", () => {
    let soft = 0;
    let hard = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = spar(seed, { skill: 0.9 });
      soft += worst(s);
      hard += worst(real(seed));
      for (const l of s.log) {
        if (l.kind === "hit" && l.zone) expect(["head", "neck"]).not.toContain(l.zone);
      }
    }
    expect(soft).toBeLessThan(hard / 2);
  });

  it("concede el que va perdiendo: el más hábil gana la mayoría", () => {
    let wins = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = spar(seed, { skill: 0.9 });
      if (r.fighters.find((f) => f.id === B)?.outcome === "yielded") wins++;
    }
    expect(wins).toBeGreaterThan(20);
  });
});

describe("armas (novel3-weapons-core)", () => {
  const sword: FighterWeapon = { reach: 1.4, mass: 1.2, wound: "cut", sharpness: 0.8, wear: 0 };
  const spear: FighterWeapon = { reach: 2.4, mass: 2, wound: "puncture", sharpness: 0.7, wear: 0 };
  const duel = (seed: number, a?: FighterWeapon, b?: FighterWeapon, gap = 3) =>
    fight(
      [
        fighter(A, "a", 0, { intent: "subdue", ...(a ? { weapon: a } : {}) }),
        fighter(B, "b", gap, { intent: "subdue", ...(b ? { weapon: b } : {}) }),
      ],
      seed,
    );

  it("sin arma, la pelea es la misma y el resultado no trae desgaste", () => {
    for (const seed of [1, 2, 5]) {
      const r = fight([fighter(A, "a", 0), fighter(B, "b", 0.7)], seed);
      for (const f of r.fighters) expect(f.weaponWear).toBeUndefined();
    }
    const broken = { ...sword, wear: 1 };
    const fs = [fighter(A, "a", 0), fighter(B, "b", 0.7)];
    const withBroken = [fighter(A, "a", 0, { weapon: broken }), fs[1] as FighterInput];
    const x = fight(withBroken, 3);
    const y = fight(fs, 3);
    expect(x.log).toEqual(y.log);
    expect(x.fighters.find((f) => f.id === A)?.weaponWear).toBe(1);
  });

  it("la espada corta y la lanza pincha: las heridas salen del tipo del arma", () => {
    const kinds = (w: FighterWeapon) => {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 20; seed++) {
        const b = duel(seed, w).fighters.find((f) => f.id === B);
        for (const wd of b?.body.wounds ?? []) seen.add(wd.kind);
      }
      return seen;
    };
    expect([...kinds(sword)]).toEqual(["cut"]);
    expect([...kinds(spear)]).toEqual(["puncture"]);
  });

  it("el arma se gasta con cada golpe y el filo más que el palo", () => {
    const stick: FighterWeapon = { reach: 1.3, mass: 1, wound: "blunt", sharpness: 0, wear: 0 };
    let edged = 0;
    let blunt = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = duel(seed, sword).fighters.find((f) => f.id === A);
      const k = duel(seed, stick).fighters.find((f) => f.id === A);
      edged += s?.weaponWear ?? 0;
      blunt += k?.weaponWear ?? 0;
      expect(s?.weaponWear).toBeGreaterThanOrEqual(0);
    }
    expect(edged).toBeGreaterThan(0);
    expect(blunt).toBeGreaterThan(0);
    expect(edged / 20).toBeGreaterThan(blunt / 20);
  });

  it("el alcance pesa: la lanza le gana al puño más seguido, y es determinista", () => {
    let withSpear = 0;
    let bare = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = duel(seed, spear).fighters;
      const n = duel(seed).fighters;
      if (
        r.find((f) => f.id === A)?.outcome === "standing" &&
        r.find((f) => f.id === B)?.outcome !== "standing"
      )
        withSpear++;
      if (
        n.find((f) => f.id === A)?.outcome === "standing" &&
        n.find((f) => f.id === B)?.outcome !== "standing"
      )
        bare++;
    }
    expect(withSpear).toBeGreaterThan(bare);
    const fs = [fighter(A, "a", 0, { weapon: spear }), fighter(B, "b", 3, { weapon: sword })];
    expect(fight([...fs].reverse(), 8)).toEqual(fight(fs, 8));
  });
});
