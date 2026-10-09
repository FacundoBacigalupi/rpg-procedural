import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, Rng } from "../../core/index.ts";
import {
  acquire,
  acquireChance,
  ascribeGroup,
  type CopyBias,
  copyPull,
  groupBias,
  identityGap,
  informalSanction,
  ownIdentity,
  seedPersonCulture,
  sensitivity,
  type TraitHolding,
} from "./person.ts";
import type { CommunityCulture } from "./seed.ts";
import type { TraitDef } from "./trait.ts";

const ev = "event:1" as EventId;
const mom = "agent:1" as AgentId;
const kid = "agent:2" as AgentId;
const traits: TraitDef[] = [
  {
    id: "food.staple",
    name: "n",
    domain: "food",
    variants: [
      { id: "flatbread", name: "a" },
      { id: "porridge", name: "b" },
    ],
    salience: 0.8,
    stickiness: 0.3,
    readBy: ["x"],
    requiresFoods: [],
  },
  {
    id: "funeral.rite",
    name: "n",
    domain: "funeral",
    variants: [
      { id: "bury", name: "a" },
      { id: "burn", name: "b" },
    ],
    salience: 0.4,
    stickiness: 0.9,
    readBy: ["x"],
    requiresFoods: [],
  },
];
const community = (culture: string, a: number): CommunityCulture => ({
  culture,
  name: culture,
  originEventId: ev,
  prevalence: {
    "food.staple": {
      variants: { flatbread: a, porridge: 1 - a },
      params: {},
      origin: "inertia",
      because: "b",
    },
    "funeral.rite": {
      variants: { bury: a, burn: 1 - a },
      params: {},
      origin: "inertia",
      because: "b",
    },
  },
});
const village = community("village", 0.9);
const coast = community("coast", 0.1);
const base = { community: village, traits, parents: [], since: 0, originEventId: ev };
const bias: CopyBias = { conformity: 0.5, prestige: 0.5, success: 0.5, content: 0.5 };

describe("seedPersonCulture", () => {
  it("es determinista y consume lo mismo con o sin padres", () => {
    fc.assert(
      fc.property(fc.nat(), (s) => {
        const a = seedPersonCulture(base, Rng.root(s));
        const b = seedPersonCulture(base, Rng.root(s));
        expect(a).toEqual(b);
        const r1 = Rng.root(s);
        const r2 = Rng.root(s);
        seedPersonCulture(base, r1);
        seedPersonCulture({ ...base, parents: [{ id: mom, culture: a }] }, r2);
        expect(r1.float()).toBe(r2.float());
      }),
    );
  });
  it("sigue a los padres más en lo tenaz y deja firmezas válidas", () => {
    const parent = seedPersonCulture({ ...base, community: coast }, Rng.root(1));
    let sameFuneral = 0;
    let sameFood = 0;
    const n = 300;
    for (let i = 0; i < n; i++) {
      const c = seedPersonCulture(
        { ...base, parents: [{ id: mom, culture: parent }] },
        Rng.root(i + 10),
      );
      if (c.holdings["funeral.rite"]?.variant === parent.holdings["funeral.rite"]?.variant) {
        sameFuneral++;
      }
      if (c.holdings["food.staple"]?.variant === parent.holdings["food.staple"]?.variant) {
        sameFood++;
      }
      for (const h of Object.values(c.holdings)) {
        expect(h.strength).toBeGreaterThanOrEqual(0);
        expect(h.strength).toBeLessThanOrEqual(1);
      }
    }
    expect(sameFuneral).toBeGreaterThan(sameFood);
  });
});

describe("transmisión", () => {
  const def = traits[0] as TraitDef;
  const held: TraitHolding = {
    variant: "porridge",
    shown: "porridge",
    strength: 0.5,
    learnedFrom: [mom],
    mode: "vertical",
    since: 0,
  };
  const input = {
    trait: def,
    candidate: "flatbread",
    mode: "vertical" as const,
    source: mom,
    bias,
    plasticity: 1,
    ageYears: 3,
    now: 5,
  };
  it("el período sensible pesa más que fuera de él", () => {
    expect(sensitivity("food", 3)).toBeGreaterThan(sensitivity("food", 40));
    expect(acquireChance(held, input)).toBeGreaterThan(
      acquireChance(held, { ...input, ageYears: 40 }),
    );
  });
  it("copyPull queda en 0-1", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (x) => {
        const p = copyPull({ conformity: x, prestige: x, success: x, content: x });
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }),
    );
  });
  it("la imposición cambia lo que muestra, no lo que sostiene", () => {
    const strong = { conformity: 1, prestige: 1, success: 1, content: 1 };
    let out: TraitHolding | undefined = held;
    for (let i = 0; i < 50 && out?.shown === "porridge"; i++) {
      out = acquire(held, { ...input, mode: "imposed", bias: strong, ageYears: 20 }, Rng.root(i));
    }
    expect(out?.shown).toBe("flatbread");
    expect(out?.variant).toBe("porridge");
  });
  it("copiar lo ya sostenido no cambia nada y es determinista", () => {
    fc.assert(
      fc.property(fc.nat(), (s) => {
        expect(acquire(held, { ...input, candidate: "porridge" }, Rng.root(s))).toBe(held);
        expect(acquire(held, input, Rng.root(s))).toEqual(acquire(held, input, Rng.root(s)));
      }),
    );
  });
});

describe("identidad y sesgo de grupo", () => {
  it("las marcas mostradas atribuyen el grupo con más confianza cuanto más se vio", () => {
    const groups = [village, coast];
    const one = ascribeGroup(mom, kid, { "food.staple": "flatbread" }, groups, traits);
    const two = ascribeGroup(
      mom,
      kid,
      { "food.staple": "flatbread", "funeral.rite": "bury" },
      groups,
      traits,
    );
    expect(one?.group).toBe("village");
    expect(two?.group).toBe("village");
    expect(two?.confidence ?? 0).toBeGreaterThan(one?.confidence ?? 1);
    expect(ascribeGroup(mom, kid, {}, groups, traits)).toBeUndefined();
  });
  it("la identidad propia y la adscripta pueden no coincidir", () => {
    const own = ownIdentity(kid, "village", true);
    const seen = { ...own, holder: mom, group: "coast", confidence: 0.6 };
    expect(identityGap(own, seen)).toBe(0.6);
    expect(identityGap(own, { ...own, holder: mom })).toBe(0);
  });
  it("favorece al propio grupo, desfavorece al ajeno y el estereotipo empuja", () => {
    const mine = ownIdentity(kid, "village", true);
    const theirs = { ...mine, group: "coast" };
    expect(groupBias("village", mine)).toBeGreaterThan(0);
    expect(groupBias("village", theirs)).toBeLessThan(0);
    expect(groupBias("village", theirs, -1)).toBeLessThan(groupBias("village", theirs, 0.5));
    expect(groupBias("village", undefined, -1)).toBe(0);
  });
});

describe("sanciones informales", () => {
  const input = {
    severity: 0.8,
    believed: 1,
    observerHolds: true,
    observerStrength: 1,
    belonging: 1,
    actorIsOutsider: false,
  };
  it("escalan con la gravedad y no castigan lo que no se cree ni lo que no se sostiene", () => {
    expect(informalSanction(input).kind).toBe("exclusion");
    expect(informalSanction({ ...input, severity: 0.25 }).kind).toBe("mockery");
    expect(informalSanction({ ...input, severity: 0.08 }).kind).toBe("gossip");
    expect(informalSanction({ ...input, believed: 0 }).weight).toBe(0);
    expect(informalSanction({ ...input, observerHolds: false }).weight).toBe(0);
    expect(informalSanction({ ...input, actorIsOutsider: true }).weight).toBeLessThan(
      informalSanction(input).weight,
    );
  });
  it("el peso queda en 0-1 y la reputación nunca sube", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (severity, believed) => {
          const s = informalSanction({ ...input, severity, believed });
          expect(s.weight).toBeGreaterThanOrEqual(0);
          expect(s.weight).toBeLessThanOrEqual(1);
          expect(s.reputation).toBeLessThanOrEqual(0);
        },
      ),
    );
  });
});
