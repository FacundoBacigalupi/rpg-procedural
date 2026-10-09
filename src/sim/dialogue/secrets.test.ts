import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Rng } from "../../core/index.ts";
import {
  askSecret,
  type ElicitMove,
  type KeeperState,
  leakChance,
  noticesProbing,
  type ObserverState,
  observeTell,
  SUSPICION_CAP,
  selfControl,
  type Tell,
  techniquePressure,
} from "./secrets.ts";

const calm: KeeperState = {
  stakes: 0.6,
  discipline: 0.7,
  arousal: 0,
  intoxication: 0,
  fatigue: 0,
  pain: 0,
  trust: 0,
  affection: 0,
  believesKnown: 0,
  insight: 0.5,
};
const direct: ElicitMove = { technique: "direct", skill: 0.5 };
const watcher: ObserverState = {
  perception: 0.8,
  attention: 0.9,
  familiarity: 0.8,
  priorSuspicion: 0,
};
const flinch: Tell = { kind: "flinch", magnitude: 0.8 };

describe("secretos que se escapan", () => {
  it("emoción, alcohol y cansancio bajan el control y suben la chance", () => {
    const drunk = { ...calm, intoxication: 0.8, arousal: 0.6, fatigue: 0.5 };
    expect(selfControl(drunk)).toBeLessThan(selfControl(calm));
    expect(leakChance(drunk, direct)).toBeGreaterThan(leakChance(calm, direct));
  });

  it("confianza, afecto y creer que ya lo saben suben la chance; lo que cuesta, la baja", () => {
    const base = leakChance(calm, direct);
    expect(leakChance({ ...calm, trust: 0.9 }, direct)).toBeGreaterThan(base);
    expect(leakChance({ ...calm, affection: 0.9 }, direct)).toBeGreaterThan(base);
    expect(leakChance({ ...calm, believesKnown: 0.9 }, direct)).toBeGreaterThan(base);
    expect(leakChance({ ...calm, stakes: 1 }, direct)).toBeLessThan(
      leakChance({ ...calm, stakes: 0.1 }, direct),
    );
  });

  it("las técnicas suman presión; la directa no", () => {
    expect(techniquePressure(direct, calm)).toBe(0);
    const trade: ElicitMove = { technique: "trade_secret", skill: 0.7, offered: 0.8 };
    expect(leakChance(calm, trade)).toBeGreaterThan(leakChance(calm, direct));
    const worn1: ElicitMove = { technique: "wear_down", skill: 0.5, attempts: 1 };
    const worn6: ElicitMove = { technique: "wear_down", skill: 0.5, attempts: 6 };
    expect(techniquePressure(worn6, calm)).toBeGreaterThan(techniquePressure(worn1, calm));
  });

  it("el farol funciona más si el otro ya lo creía y tiene poco olfato", () => {
    const bluff: ElicitMove = { technique: "feign_knowledge", skill: 0.8 };
    const dull = { ...calm, believesKnown: 0.5, insight: 0.1 };
    const sharp = { ...calm, believesKnown: 0.5, insight: 0.9 };
    expect(techniquePressure(bluff, dull)).toBeGreaterThan(techniquePressure(bluff, sharp));
  });

  it("el olfato nota la maniobra; preguntar de frente no es maniobra", () => {
    const side: ElicitMove = { technique: "sideways", skill: 0.2 };
    expect(noticesProbing(direct, calm)).toBe(0);
    expect(noticesProbing(side, { ...calm, insight: 0.9 })).toBeGreaterThan(
      noticesProbing(side, { ...calm, insight: 0.1 }),
    );
  });

  it("chance acotada y resultados coherentes con ella", () => {
    fc.assert(
      fc.property(
        fc.nat(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        (seed, x, t) => {
          const k: KeeperState = { ...calm, arousal: x, intoxication: x, trust: t, stakes: x };
          const r = askSecret(k, direct, x, Rng.root(seed));
          expect(r.chance).toBeGreaterThanOrEqual(0);
          expect(r.chance).toBeLessThanOrEqual(0.95);
          expect(["revealed", "partial", "evaded", "refused"]).toContain(r.outcome);
          expect(r.noticedProbing).toBe(false);
          expect(r.trustDelta).toBe(0);
        },
      ),
    );
  });

  it("sin control casi siempre suelta; con control total y mucho en juego casi nunca", () => {
    const loose = {
      ...calm,
      discipline: 0,
      intoxication: 1,
      stakes: 0,
      trust: 1,
      believesKnown: 1,
    };
    const stone = { ...calm, discipline: 1, stakes: 1, trust: -1 };
    let leaked = 0;
    let kept = 0;
    for (let i = 0; i < 200; i++) {
      const a = askSecret(loose, direct, 1, Rng.root(i)).outcome;
      const b = askSecret(stone, direct, 1, Rng.root(i)).outcome;
      if (a === "revealed" || a === "partial") leaked++;
      if (b === "evaded" || b === "refused") kept++;
    }
    expect(leaked).toBeGreaterThan(165);
    expect(kept).toBeGreaterThan(190);
  });

  it("si nota la maniobra pierde confianza y se cuida", () => {
    const sharp = { ...calm, insight: 1 };
    const clumsy: ElicitMove = { technique: "sideways", skill: 0 };
    const rs = Array.from({ length: 60 }, (_, i) => askSecret(sharp, clumsy, 0.5, Rng.root(i)));
    const caught = rs.find((r) => r.noticedProbing);
    expect(caught).toBeDefined();
    expect(caught?.trustDelta).toBeLessThan(0);
    expect(caught?.wariness).toBeGreaterThan(0.3);
  });

  it("es determinista", () => {
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        const m: ElicitMove = { technique: "flatter", skill: 0.6, vanity: 0.7 };
        expect(askSecret(calm, m, 0.7, Rng.root(seed))).toEqual(
          askSecret(calm, m, 0.7, Rng.root(seed)),
        );
      }),
    );
  });
});

describe("filtración sin decirlo", () => {
  it("el que mira con atención sospecha, pero nunca con certeza", () => {
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        const r = observeTell(flinch, { ...watcher, priorSuspicion: 0.9 }, Rng.root(seed));
        expect(r.suspicion).toBeLessThanOrEqual(Math.max(SUSPICION_CAP, 0.9));
      }),
    );
    const r = observeTell(flinch, watcher, Rng.root(1));
    expect(r.noticed).toBe(true);
    expect(r.suspicion).toBeGreaterThan(0);
    expect(r.suspicion).toBeLessThanOrEqual(SUSPICION_CAP);
    expect(r.seen).toBe("flinch");
  });

  it("el distraído no lo ve; sin señal no hay sospecha nueva", () => {
    const blind: ObserverState = { ...watcher, perception: 0, attention: 0, familiarity: 0 };
    expect(observeTell(flinch, blind, Rng.root(2)).noticed).toBe(false);
    const none = observeTell(null, { ...watcher, priorSuspicion: 0.2 }, Rng.root(3));
    expect(none).toEqual({ noticed: false, suspicion: 0.2, seen: null });
  });
});
