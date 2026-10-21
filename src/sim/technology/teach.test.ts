import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loadContent, makeId, Rng } from "../../core/index.ts";
import { GOODS } from "../economy/index.ts";
import {
  type Learned,
  learnFromManual,
  type ProcessKnowledge,
  type Student,
  TECH_PROCESSES,
  TechCatalog,
  teachProcess,
} from "./index.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [GOODS, TECH_PROCESSES],
  [
    { kind: "goods", file: "g.json", data: json("content/goods/core.json") },
    { kind: "goods", file: "c.json", data: json("content/goods/catalog.json") },
    { kind: "techprocesses", file: "t.json", data: json("content/techprocesses/mortal.json") },
  ],
);
const catalog = new TechCatalog(content.all(TECH_PROCESSES));
const need = (id: string) => {
  const d = catalog.get(id);
  if (!d) throw new Error(`sin ${id}`);
  return d;
};

const teacherId = makeId("agent", 1);
const pupil = (talent = 0, existing?: ProcessKnowledge): Student => ({
  id: makeId("agent", 2),
  talent,
  ...(existing ? { existing } : {}),
});
const master = (process: string, over: Partial<ProcessKnowledge> = {}): ProcessKnowledge => ({
  process,
  fidelity: 0.95,
  skill: 0.8,
  source: makeId("event", 1),
  secret: false,
  learnedAt: 0,
  ...over,
});
const ctx = (seed = 7, n = 10) => ({ rng: Rng.root(seed), event: makeId("event", n), tick: 100 });
const learned = (r: Learned) => {
  if (r.kind !== "learned") throw new Error(`rechazado: ${r.reason}`);
  return r;
};

describe("aprender con maestro", () => {
  const forge = need("iron-forging");

  it("deja fuente, maestro y causa; la fidelidad no pasa de la del maestro y la mano de la fidelidad", () => {
    const r = learned(
      teachProcess(
        forge,
        { teacherId, teacher: master("iron-forging"), hours: 200 },
        pupil(),
        ctx(),
      ),
    );
    expect(r.knowledge.source).toBe(makeId("event", 10));
    expect(r.knowledge.taughtBy).toBe(teacherId);
    expect(r.knowledge.fidelity).toBeLessThanOrEqual(0.95);
    expect(r.knowledge.fidelity).toBeGreaterThan(0);
    expect(r.knowledge.skill).toBeLessThanOrEqual(r.knowledge.fidelity);
    expect(r.knowledge.skill).toBeLessThanOrEqual(0.8);
  });

  it("más horas, más saber; y la fidelidad llega antes que la mano", () => {
    const t = { teacherId, teacher: master("iron-forging") };
    const a = learned(teachProcess(forge, { ...t, hours: 50 }, pupil(), ctx()));
    const b = learned(teachProcess(forge, { ...t, hours: 600 }, pupil(), ctx()));
    expect(b.knowledge.fidelity).toBeGreaterThan(a.knowledge.fidelity);
    expect(b.knowledge.skill).toBeGreaterThan(a.knowledge.skill);
    expect(a.knowledge.fidelity / 0.95).toBeGreaterThan(a.knowledge.skill / 0.8);
  });

  it("el talento acelera y un maestro opaco copia peor que uno claro", () => {
    const t = { teacherId, teacher: master("iron-forging"), hours: 150 };
    const dull = learned(teachProcess(forge, t, pupil(-1.5), ctx()));
    const sharp = learned(teachProcess(forge, t, pupil(1.5), ctx()));
    expect(sharp.knowledge.skill).toBeGreaterThan(dull.knowledge.skill);
    const worst = fc
      .sample(fc.integer({ min: 1, max: 200 }), 40)
      .map((s) => learned(teachProcess(forge, { ...t, clarity: 0 }, pupil(), ctx(s))).copyError);
    const best = fc
      .sample(fc.integer({ min: 1, max: 200 }), 40)
      .map((s) => learned(teachProcess(forge, { ...t, clarity: 1 }, pupil(), ctx(s))).copyError);
    expect(Math.max(...best)).toBe(0);
    expect(Math.max(...worst)).toBeGreaterThan(0);
    expect(Math.max(...worst)).toBeLessThanOrEqual(0.12);
  });

  it("el maestro que guarda el secreto no enseña si no quiere; el que no tiene mano tampoco", () => {
    const secret = master("iron-forging", { secret: true });
    const base = { teacherId, hours: 100 };
    expect(teachProcess(forge, { ...base, teacher: secret }, pupil(), ctx())).toEqual({
      kind: "refused",
      reason: "secret",
    });
    const ok = learned(
      teachProcess(forge, { ...base, teacher: secret, willing: true }, pupil(), ctx()),
    );
    expect(ok.knowledge.secret).toBe(true);
    expect(
      teachProcess(
        forge,
        { ...base, teacher: master("iron-forging", { skill: 0.1 }) },
        pupil(),
        ctx(),
      ),
    ).toEqual({ kind: "refused", reason: "unskilled" });
    expect(
      teachProcess(forge, { ...base, teacher: master("iron-forging"), hours: 0 }, pupil(), ctx()),
    ).toEqual({
      kind: "refused",
      reason: "no-time",
    });
  });

  it("no se desaprende: seguir con el maestro nunca baja lo que ya se sabía", () => {
    const had = master("iron-forging", { fidelity: 0.9, skill: 0.7 });
    const r = learned(
      teachProcess(
        forge,
        { teacherId, teacher: master("iron-forging", { fidelity: 0.5, skill: 0.4 }), hours: 80 },
        pupil(0, had),
        ctx(),
      ),
    );
    expect(r.knowledge.fidelity).toBeGreaterThanOrEqual(0.9);
    expect(r.knowledge.skill).toBeGreaterThanOrEqual(0.7);
  });

  it("es determinista y no depende del orden en que se consumió el rng de afuera", () => {
    const t = { teacherId, teacher: master("iron-forging"), hours: 90 };
    const a = teachProcess(forge, t, pupil(0.5), ctx(3));
    const rng = Rng.root(3);
    rng.float();
    rng.float();
    const b = teachProcess(forge, t, pupil(0.5), { rng, event: makeId("event", 10), tick: 100 });
    expect(b).toEqual(a);
    expect(teachProcess(forge, t, pupil(0.5), ctx(4))).not.toEqual(a);
  });

  it("propiedad: los números quedan en 0-1 y la mano nunca supera la fidelidad", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.double({ min: 0.01, max: 3000, noNaN: true }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: 0.2, max: 1, noNaN: true }),
        fc.double({ min: 0.3, max: 1, noNaN: true }),
        (seed, hours, talent, skill, fid) => {
          const r = learned(
            teachProcess(
              forge,
              { teacherId, teacher: master("iron-forging", { skill, fidelity: fid }), hours },
              pupil(talent),
              ctx(seed),
            ),
          );
          const k = r.knowledge;
          expect(k.fidelity).toBeGreaterThanOrEqual(0);
          expect(k.fidelity).toBeLessThanOrEqual(fid);
          expect(k.skill).toBeGreaterThanOrEqual(0);
          expect(k.skill).toBeLessThanOrEqual(k.fidelity);
        },
      ),
    );
  });
});

describe("aprender de un manual", () => {
  it("los oficios tácitos casi no se aprenden de un libro; los explícitos bastante más", () => {
    const text = { fidelity: 0.9, hours: 300, reading: 0.9 };
    const forge = learned(learnFromManual(need("iron-forging"), text, pupil(), ctx()));
    const salting = learned(learnFromManual(need("salting"), text, pupil(), ctx()));
    expect(salting.knowledge.fidelity).toBeGreaterThan(forge.knowledge.fidelity);
    expect(salting.knowledge.skill).toBeGreaterThan(forge.knowledge.skill);
    expect(forge.knowledge.taughtBy).toBeUndefined();
  });

  it("el manual da poca mano frente al maestro con las mismas horas", () => {
    const def = need("salting");
    const book = learned(
      learnFromManual(def, { fidelity: 0.95, hours: 100, reading: 1 }, pupil(), ctx()),
    );
    const teacher = learned(
      teachProcess(def, { teacherId, teacher: master("salting"), hours: 100 }, pupil(), ctx()),
    );
    expect(book.knowledge.skill).toBeLessThan(teacher.knowledge.skill);
  });

  it("sin lectura no dice nada; la fidelidad del texto es un techo", () => {
    expect(
      learnFromManual(need("salting"), { fidelity: 0.9, hours: 50, reading: 0 }, pupil(), ctx()),
    ).toEqual({
      kind: "refused",
      reason: "illiterate",
    });
    const r = learned(
      learnFromManual(need("salting"), { fidelity: 0.5, hours: 5000, reading: 1 }, pupil(), ctx()),
    );
    expect(r.knowledge.fidelity).toBeLessThanOrEqual(0.5);
  });
});
