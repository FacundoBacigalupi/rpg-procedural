import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, Rng } from "../../core/index.ts";
import type { ValueId } from "../mind/index.ts";
import {
  type ClientCues,
  CONCERNS,
  type Concern,
  castOmen,
  coldRead,
  DivinationMethodDef,
  type Diviner,
  type HeardProphecy,
  type HolderStake,
  MAX_LINEAGE,
  omenTone,
  PROPHECY_CAPACITY,
  type ProphecyClaim,
  prophecyDeltas,
  prophecyPull,
  receive,
  record,
  renown,
  streetConsult,
  transmit,
  utter,
} from "./index.ts";

const A = "agent:1" as unknown as AgentId; // el adivino
const B = "agent:2" as unknown as AgentId; // el cliente
const C = "agent:3" as unknown as AgentId;
const D = "agent:4" as unknown as AgentId;
const ev = (n: number) => n as unknown as EventId;

const methods = (
  JSON.parse(
    readFileSync(new URL("../../../content/divination/street.json", import.meta.url), "utf8"),
  ) as unknown[]
).map((m) => DivinationMethodDef.parse(m));
const bones = methods[0] as DivinationMethodDef;

const claim = (kind: ProphecyClaim["kind"], subject: AgentId, intensity = 0.8): ProphecyClaim => ({
  kind,
  subject,
  intensity,
});
const hearer = (id: AgentId, credulity = 0.8, trustInTeller = 0.6) => ({
  id,
  credulity,
  trustInTeller,
});

const values = (over: Partial<Record<ValueId, number>> = {}): Record<ValueId, number> => ({
  power: 0.09,
  safety: 0.09,
  family: 0.09,
  knowledge: 0.09,
  freedom: 0.09,
  justice: 0.09,
  wealth: 0.09,
  status: 0.09,
  pleasure: 0.09,
  tradition: 0.09,
  immortality: 0.09,
  ...over,
});
const holder = (id: AgentId, affection: number, over: Partial<Record<ValueId, number>> = {}) =>
  ({ id, affection, values: values(over) }) satisfies HolderStake;

const root = (c: ProphecyClaim, conviction = 0.7): HeardProphecy =>
  utter(A, c, bones.id, conviction, ev(10), 1000);

describe("el contenido de los adivinos", () => {
  it("valida contra el esquema y no tiene símbolos repetidos", () => {
    for (const m of methods) {
      expect(new Set(m.symbols.map((s) => s.id)).size).toBe(m.symbols.length);
      expect(m.source).toBe("ritual");
    }
  });
});

describe("profecías como creencias con linaje", () => {
  it("la raíz nunca se pierde y el linaje anota quién se la contó a quién", () => {
    const rng = Rng.root(1).fork("t");
    const p0 = root(claim("greatness", B));
    const p1 = transmit(p0, A, hearer(C), 0.5, ev(11), 2000, rng.fork(1));
    const p2 = transmit(p1, C, hearer(D), 0.5, ev(12), 3000, rng.fork(2));
    expect(p2.root).toEqual(p0.root);
    expect(p2.hops).toBe(2);
    expect(p2.lineage.map((h) => [h.from, h.to])).toEqual([
      [A, C],
      [C, D],
    ]);
  });

  it("al contarse se vuelve más dramática y se cree menos por cada salto", () => {
    const rng = Rng.root(2).fork("t");
    let p = root(claim("ruin", B, 0.4), 0.9);
    const first = p;
    for (let i = 0; i < 5; i++) {
      p = transmit(p, A, hearer(C, 0.9, 1), 1, ev(20 + i), 2000 + i, rng.fork(i));
    }
    expect(p.claim.intensity).toBeGreaterThan(first.claim.intensity);
    expect(p.credence).toBeLessThan(first.credence);
    expect(p.claim.subject).toBe(B);
  });

  it("sin dramatismo la intensidad no cambia", () => {
    const p0 = root(claim("fortune", B, 0.5));
    const p1 = transmit(p0, A, hearer(C), 0, ev(11), 2000, Rng.root(3).fork("t"));
    expect(p1.claim.intensity).toBe(0.5);
    expect(p1.claim.kind).toBe("fortune");
  });

  it("quien confía más y es más crédulo la cree más; lo bueno sobre uno se cree de más", () => {
    const base = claim("greatness", B);
    const mk = (h: ReturnType<typeof hearer>) =>
      transmit(root(base), A, h, 0, ev(11), 2000, Rng.root(4).fork("t")).credence;
    expect(mk(hearer(C, 0.9, 0.8))).toBeGreaterThan(mk(hearer(C, 0.2, 0.8)));
    expect(mk(hearer(C, 0.5, 0.9))).toBeGreaterThan(mk(hearer(C, 0.5, -0.5)));
    expect(mk(hearer(B, 0.5, 0.5))).toBeGreaterThan(mk(hearer(C, 0.5, 0.5)));
  });

  it("oírla por dos caminos la refuerza y conserva la versión de menos saltos", () => {
    const p0 = root(claim("greatness", B));
    const rng = Rng.root(5).fork("t");
    const near = transmit(p0, A, hearer(C), 0.5, ev(11), 2000, rng.fork(1));
    const far = transmit(near, D, hearer(C), 0.5, ev(12), 3000, rng.fork(2));
    const once = receive(undefined, far);
    const twice = receive(once, near);
    expect(twice.items).toHaveLength(1);
    expect((twice.items[0] as HeardProphecy).credence).toBeGreaterThan(far.credence);
    expect((twice.items[0] as HeardProphecy).hops).toBe(near.hops);
  });

  it("cada quien retiene un tope y olvida las de menos peso, en orden canónico", () => {
    let b = receive(undefined, root(claim("fortune", B, 0.01), 0.01));
    for (let i = 0; i < PROPHECY_CAPACITY + 5; i++) {
      b = receive(b, utter(A, claim("ruin", B, 0.9), bones.id, 0.9, ev(100 + i), 1000));
    }
    expect(b.items).toHaveLength(PROPHECY_CAPACITY);
    expect(b.items.some((p) => p.id === "prophecy@10")).toBe(false);
    const ids = b.items.map((p) => p.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("el linaje guardado tiene tope pero cuenta todos los saltos", () => {
    const rng = Rng.root(6).fork("t");
    let p = root(claim("ruin", B));
    for (let i = 0; i < MAX_LINEAGE + 4; i++) {
      p = transmit(p, A, hearer(C), 0.5, ev(30 + i), 2000 + i, rng.fork(i));
    }
    expect(p.lineage).toHaveLength(MAX_LINEAGE);
    expect(p.hops).toBe(MAX_LINEAGE + 4);
  });
});

describe("cómo una profecía cambia lo que se quiere", () => {
  it("un rival ambicioso le teme y le es hostil al elegido; quien lo quiere lo protege", () => {
    const p = root(claim("greatness", B), 0.9);
    const rival = prophecyPull(p, holder(C, -0.5, { power: 0.4, status: 0.2 }));
    const friend = prophecyPull(p, holder(D, 0.9, { power: 0.4, status: 0.2 }));
    expect(rival.hostility).toBeGreaterThan(0.1);
    expect(rival.fear).toBeGreaterThan(friend.fear);
    expect(friend.hostility).toBeLessThan(rival.hostility);
    expect(friend.devotion).toBeGreaterThan(rival.devotion);
    expect(rival.valueShifts.power).toBeGreaterThan(0);
  });

  it("quien no valora el poder casi no se mueve por una grandeza ajena", () => {
    const p = root(claim("greatness", B), 0.9);
    const humble = prophecyPull(p, holder(C, 0, { power: 0.01, status: 0.01, immortality: 0.01 }));
    expect(humble.hostility).toBeLessThan(0.05);
  });

  it("el sujeto espera lo bueno y teme lo malo de sí", () => {
    const good = prophecyPull(root(claim("fortune", B)), holder(B, 0));
    const bad = prophecyPull(root(claim("death", B)), holder(B, 0));
    expect(good.hope).toBeGreaterThan(0.3);
    expect(good.fear).toBe(0);
    expect(bad.fear).toBeGreaterThan(0.3);
    expect(bad.valueShifts.immortality).toBeGreaterThan(0);
  });

  it("la ruina del sujeto despierta hostilidad en quien valora la seguridad y no lo quiere", () => {
    const p = root(claim("ruin", B), 0.9);
    const cautious = prophecyPull(p, holder(C, -0.3, { safety: 0.4 }));
    const loving = prophecyPull(p, holder(D, 0.9, { safety: 0.4 }));
    expect(cautious.hostility).toBeGreaterThan(loving.hostility);
  });

  it("creer menos pesa menos: el efecto es proporcional al crédito", () => {
    const strong = prophecyPull(root(claim("ruin", B), 0.9), holder(C, 0, { safety: 0.4 }));
    const weak = prophecyPull(root(claim("ruin", B), 0.1), holder(C, 0, { safety: 0.4 }));
    expect(weak.hostility).toBeLessThan(strong.hostility);
    expect(prophecyPull(root(claim("ruin", B), 0), holder(C, 0, { safety: 0.4 })).hostility).toBe(
      0,
    );
  });

  it("los cambios de relación reflejan el miedo y la hostilidad", () => {
    const pull = prophecyPull(root(claim("greatness", B), 0.9), holder(C, -0.5, { power: 0.4 }));
    const d = prophecyDeltas(pull);
    expect(d.fear).toBeGreaterThan(0);
    expect(d.resentment).toBeGreaterThan(0);
    expect(d.trust).toBeLessThan(0);
  });

  it("propiedad: ningún insumo sale de [0, 1]", () => {
    const kinds = ["greatness", "ruin", "death", "fortune"] as const;
    fc.assert(
      fc.property(
        fc.constantFrom(...kinds),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.boolean(),
        (kind, intensity, conviction, affection, self) => {
          const p = root(claim(kind, B, intensity), conviction);
          const pull = prophecyPull(
            p,
            holder(self ? B : C, affection, { power: 0.5, safety: 0.5 }),
          );
          for (const x of [pull.fear, pull.hope, pull.hostility, pull.devotion]) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(1);
          }
        },
      ),
    );
  });
});

describe("adivinos de calle", () => {
  const diviner = (over: Partial<Diviner> = {}): Diviner => ({
    id: A,
    flattery: 0,
    insight: 0.5,
    school: 0,
    ...over,
  });

  it("el ritual no recibe la verdad: la tirada solo depende del instrumento, el deseo y el rng", () => {
    const a = castOmen(bones, 0, Rng.root(7).fork("q"));
    const b = castOmen(bones, 0, Rng.root(7).fork("q"));
    expect(a).toEqual(b);
    expect(a.signs).toHaveLength(bones.casts);
    for (const s of a.signs) expect(bones.symbols.some((x) => x.id === s)).toBe(true);
  });

  it("querer oír algo bueno inclina la tirada hacia lo auspicioso, sin forzarla", () => {
    const mean = (want: number) => {
      let s = 0;
      for (let i = 0; i < 400; i++)
        s += omenTone(bones, castOmen(bones, want, Rng.root(i).fork("q")));
      return s / 400;
    };
    expect(mean(1)).toBeGreaterThan(mean(0));
    expect(mean(0)).toBeGreaterThan(mean(-1));
    // Con deseo máximo todavía salen presagios malos.
    expect(mean(1)).toBeLessThan(1);
  });

  it("el ritual puro acierta lo esperable por azar (ni más ni menos)", () => {
    // Sin señales ni pregunta, la preocupación que «lee» es uniforme: ninguna se destaca.
    const counts = new Map<Concern, number>();
    const N = 1200;
    for (let i = 0; i < N; i++) {
      const c = coldRead({ signals: {} }, 0, Rng.root(i).fork("q")).concern;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    for (const c of CONCERNS) {
      const share = (counts.get(c) ?? 0) / N;
      expect(Math.abs(share - 1 / CONCERNS.length)).toBeLessThan(0.06);
    }
  });

  it("la lectura en frío acierta más cuanto más perspicaz es, y siempre más que el azar si hay señales", () => {
    const cues: ClientCues = { signals: { family: 0.9, money: 0.2 } };
    const rate = (insight: number) => {
      let hits = 0;
      for (let i = 0; i < 600; i++) {
        if (coldRead(cues, insight, Rng.root(i).fork("q")).concern === "family") hits++;
      }
      return hits / 600;
    };
    expect(rate(1)).toBeGreaterThan(rate(0));
    expect(rate(0)).toBeGreaterThan(1 / CONCERNS.length);
  });

  it("lo que el cliente pregunta pesa más que lo que se le ve", () => {
    let asked = 0;
    for (let i = 0; i < 300; i++) {
      const r = coldRead({ signals: { family: 1 }, asked: "love" }, 0.5, Rng.root(i).fork("q"));
      if (r.concern === "love") asked++;
    }
    expect(asked).toBeGreaterThan(150);
  });

  it("una consulta produce una profecía sobre el cliente, con vaguedad según cuán claro lo vio", () => {
    const sharp = streetConsult(
      bones,
      diviner({ insight: 1 }),
      B,
      { signals: { money: 1 } },
      0,
      Rng.root(8).fork("q"),
    );
    const blind = streetConsult(
      bones,
      diviner({ insight: 0 }),
      B,
      { signals: {} },
      0,
      Rng.root(8).fork("q"),
    );
    expect(sharp.utterance.claim.subject).toBe(B);
    expect(sharp.utterance.vagueness).toBeLessThan(blind.utterance.vagueness);
  });

  it("el adulador dice lo que el cliente quiere oír más seguido que el sincero", () => {
    const good = (flattery: number) => {
      let n = 0;
      for (let i = 0; i < 400; i++) {
        const c = streetConsult(
          bones,
          diviner({ flattery }),
          B,
          { signals: { ambition: 0.5 } },
          1,
          Rng.root(i).fork("q"),
        );
        if (c.utterance.claim.kind === "fortune" || c.utterance.claim.kind === "greatness") n++;
      }
      return n / 400;
    };
    expect(good(1)).toBeGreaterThan(good(0));
  });

  it("la fama recuerda los aciertos más que los fallos", () => {
    let r = { hits: 0, misses: 0 };
    for (let i = 0; i < 20; i++) r = record(r, i % 2 === 0);
    expect(renown(r)).toBeGreaterThan(0.5);
    expect(renown({ hits: 0, misses: 0 })).toBe(0.5);
    expect(renown({ hits: 10, misses: 0 })).toBeGreaterThan(renown({ hits: 5, misses: 5 }));
  });

  it("determinismo: misma consulta, mismas lecturas, símbolos y profecía", () => {
    const run = () =>
      streetConsult(
        bones,
        diviner({ flattery: 0.6, insight: 0.4 }),
        B,
        { signals: { health: 0.7 }, asked: "health" },
        0.5,
        Rng.root(99).fork("divination", A, 1, 5000),
      );
    expect(run()).toEqual(run());
  });

  it("la cadena completa: del adivino al cliente y de boca en boca, con el mismo origen", () => {
    const c = streetConsult(
      bones,
      diviner({ insight: 0.8 }),
      B,
      { signals: { ambition: 0.9 } },
      0.5,
      Rng.root(11).fork("q"),
    );
    const said = utter(A, c.utterance.claim, bones.id, 0.8, ev(50), 9000);
    const clientHeard = transmit(said, A, hearer(B), 0.3, ev(51), 9001, Rng.root(11).fork("t1"));
    const gossip = transmit(clientHeard, B, hearer(C), 0.7, ev(52), 9500, Rng.root(11).fork("t2"));
    expect(gossip.root.speaker).toBe(A);
    expect(gossip.id).toBe(said.id);
    expect(gossip.lineage.map((h) => h.to)).toEqual([B, C]);
  });
});
