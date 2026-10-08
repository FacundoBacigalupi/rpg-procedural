import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, Rng } from "../../core/index.ts";
import type { Belief } from "../knowledge/index.ts";
import {
  type DetectionInput,
  decidesToLie,
  judgeStatement,
  lieInclination,
  recordCaught,
  sincerityOf,
  suspicion,
  toldConfidence,
} from "./lies.ts";
import {
  advanceTopics,
  answer,
  changeTopic,
  EMPTY_TOPICS,
  mention,
  openQuestions,
  resolveReference,
  TOPIC_CAPACITY,
  TOPIC_LIFETIME,
  type TopicRef,
} from "./topics.ts";

const ana = "agent:1" as AgentId;
const bruno = "agent:2" as AgentId;
const carla = "agent:3" as AgentId;

const believes = (alive: boolean, confidence: number): Belief => ({
  prop: { kind: "attr", subject: bruno, attr: "alive" },
  value: alive,
  confidence,
  asOf: 0,
  learnedAt: 0,
  sources: [],
  salience: 1,
  measured: 0,
});

const base: DetectionInput = {
  lying: true,
  control: 0.3,
  nerves: 0.5,
  insight: 0.5,
  familiarity: 0.5,
  conflict: 0.2,
  implausibility: 0.2,
  trust: 0.3,
  wariness: 0.3,
};
const HARD: DetectionInput = {
  ...base,
  conflict: 1,
  implausibility: 1,
  insight: 1,
  nerves: 1,
  control: 0,
  trust: 0,
};

const unit = fc.double({ min: 0, max: 1, noNaN: true });
const detection = fc.record({
  lying: fc.boolean(),
  control: unit,
  nerves: unit,
  insight: unit,
  familiarity: unit,
  conflict: unit,
  implausibility: unit,
  trust: unit,
  wariness: unit,
});

describe("sinceridad contra lo que se cree", () => {
  it("decir lo que se cree es sincero, aunque sea falso en el mundo", () => {
    expect(sincerityOf({ value: true, own: believes(true, 0.9) }, 0)).toBe("sincere");
  });
  it("decir lo contrario de lo que se cree con convicción es mentir", () => {
    expect(sincerityOf({ value: false, own: believes(true, 0.9) }, 0)).toBe("lie");
  });
  it("sin convicción o sin saber, no es mentir sino hablar a ciegas", () => {
    expect(sincerityOf({ value: false, own: believes(true, 0.3) }, 0)).toBe("blind");
    expect(sincerityOf({ value: false, own: undefined }, 0)).toBe("blind");
  });
});

describe("querer mentir", () => {
  const motive = { honesty: 0.5, gain: 0.5, exposure: 0.5, selfBelief: 0.5 };
  it("el honesto miente menos y el que gana más miente más", () => {
    expect(lieInclination({ ...motive, honesty: 0.9 })).toBeLessThan(lieInclination(motive));
    expect(lieInclination({ ...motive, gain: 0.9 })).toBeGreaterThan(lieInclination(motive));
  });
  it("lo verificable frena; creerse buen mentiroso anima", () => {
    expect(lieInclination({ ...motive, checkable: true })).toBeLessThan(lieInclination(motive));
    expect(lieInclination({ ...motive, selfBelief: 0.9 })).toBeGreaterThan(lieInclination(motive));
  });
  it("sin ganancia ni motivo no miente nunca", () => {
    const m = { honesty: 1, gain: 0, exposure: 1, selfBelief: 0 };
    for (let i = 0; i < 50; i++) expect(decidesToLie(m, Rng.root(i))).toBe(false);
  });
});

describe("detectar la mentira", () => {
  it("más control del mentiroso, menos sospecha; más percepción del oyente, más", () => {
    expect(suspicion({ ...base, control: 0.95 })).toBeLessThan(
      suspicion({ ...base, control: 0.1 }),
    );
    expect(suspicion({ ...base, insight: 0.9 })).toBeGreaterThan(
      suspicion({ ...base, insight: 0.1 }),
    );
  });
  it("lo que choca con lo que el oyente sabe sospecha aunque no haya señales", () => {
    const calm = { ...base, nerves: 0, control: 1 };
    expect(suspicion({ ...calm, conflict: 1 })).toBeGreaterThan(
      suspicion({ ...calm, conflict: 0 }),
    );
  });
  it("la confianza baja la guardia y el desconfiado sospecha más", () => {
    expect(suspicion({ ...base, trust: 0.9 })).toBeLessThan(suspicion({ ...base, trust: 0 }));
    expect(suspicion({ ...base, wariness: 1 })).toBeGreaterThan(
      suspicion({ ...base, wariness: 0 }),
    );
  });
  it("un sincero levanta menos sospecha que un mentiroso con todo igual", () => {
    expect(suspicion({ ...base, lying: false })).toBeLessThan(suspicion({ ...base, lying: true }));
  });
  it("la sospecha siempre está entre 0 y 1", () => {
    fc.assert(
      fc.property(detection, (d) => {
        const s = suspicion(d);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }),
    );
  });
  it("un mentiroso torpe es sorprendido más seguido que uno hábil", () => {
    const caught = (control: number) => {
      let n = 0;
      for (let i = 0; i < 300; i++) {
        const j = judgeStatement(
          { ...base, control, insight: 0.8, nerves: 0.7, trust: 0, conflict: 0.5, wariness: 0.5 },
          Rng.root(i).fork("judge"),
        );
        if (j.verdict === "caught") n++;
      }
      return n;
    };
    expect(caught(0.05)).toBeGreaterThan(caught(0.95));
  });
  it("a un sincero también se lo acusa a veces, y entonces el veredicto no acierta", () => {
    const wary = { ...HARD, lying: false, wariness: 1 };
    const wrong = Array.from({ length: 300 }, (_, i) =>
      judgeStatement(wary, Rng.root(i).fork("judge")),
    ).filter((j) => !j.correct);
    expect(wrong.every((j) => j.verdict !== "believed")).toBe(true);
    const calm = { ...base, lying: false, nerves: 0.2, conflict: 0, implausibility: 0 };
    const calmWrong = Array.from({ length: 300 }, (_, i) =>
      judgeStatement(calm, Rng.root(i).fork("judge")),
    ).filter((j) => !j.correct);
    expect(calmWrong.length).toBeLessThan(wrong.length + 1);
  });
  it("sorprendido: baja la confianza y no entra la creencia; creído: entra", () => {
    const caught = judgeStatement(HARD, Rng.root(1));
    expect(caught.verdict).toBe("caught");
    expect(caught.trustDelta).toBeLessThan(0);
    expect(toldConfidence(0.5, 0.5, caught)).toBe(0);
    const easy = judgeStatement(
      { ...base, conflict: 0, implausibility: 0, nerves: 0, trust: 1, wariness: 0 },
      Rng.root(1),
    );
    expect(easy.verdict).toBe("believed");
    expect(toldConfidence(0.5, 0.5, easy)).toBeGreaterThan(0);
  });
  it("lo sorprendido deja registro, cierto si era mentira", () => {
    const liar = judgeStatement(HARD, Rng.root(1));
    expect(recordCaught(ana, bruno, 5, liar)?.certain).toBe(true);
    const none = judgeStatement({ ...base, conflict: 0, nerves: 0, trust: 1 }, Rng.root(1));
    expect(recordCaught(ana, bruno, 5, none)).toBeNull();
  });
  it("determinismo: mismo seed y entrada, mismo juicio", () => {
    fc.assert(
      fc.property(fc.nat(), detection, (seed, d) => {
        expect(judgeStatement(d, Rng.root(seed).fork("judge"))).toEqual(
          judgeStatement(d, Rng.root(seed).fork("judge")),
        );
      }),
    );
  });
});

describe("TopicStack", () => {
  const person = (id: AgentId): TopicRef => ({ kind: "person", id });
  const thing: TopicRef = { kind: "good", id: "arroz" };

  it("él es la última persona nombrada que no es de la charla", () => {
    let s = mention(EMPTY_TOPICS, person(bruno));
    s = advanceTopics(s);
    s = mention(s, person(carla));
    s = mention(s, thing);
    expect(resolveReference(s, { cls: "person", not: [ana] })).toEqual({
      status: "resolved",
      ref: person(carla),
    });
    expect(resolveReference(s, { cls: "thing" })).toEqual({ status: "resolved", ref: thing });
    expect(resolveReference(s, { cls: "place" })).toEqual({ status: "none" });
  });
  it("el filtro del que entiende cambia a quién se refiere (malentendido con causa)", () => {
    let s = mention(EMPTY_TOPICS, person(bruno));
    s = advanceTopics(s);
    s = mention(s, person(carla));
    const res = resolveReference(s, { cls: "person", fits: (id) => id === bruno });
    expect(res).toEqual({ status: "resolved", ref: person(bruno) });
  });
  it("dos nombrados en el mismo turno son ambiguos; nombrar de nuevo desempata", () => {
    let s = mention(mention(EMPTY_TOPICS, person(bruno)), person(carla));
    expect(resolveReference(s, { cls: "person" }).status).toBe("ambiguous");
    s = mention(s, person(bruno));
    expect(resolveReference(s, { cls: "person" })).toEqual({
      status: "resolved",
      ref: person(bruno),
    });
  });
  it("lo nombrado hace rato se olvida, pero la pregunta abierta queda", () => {
    const q: TopicRef = { kind: "question", about: person(bruno), asker: ana };
    let s = mention(mention(EMPTY_TOPICS, person(bruno)), q);
    for (let i = 0; i <= TOPIC_LIFETIME; i++) s = advanceTopics(s);
    expect(resolveReference(s, { cls: "person" })).toEqual({ status: "none" });
    expect(openQuestions(s)).toEqual([q]);
  });
  it("contestar cierra la pregunta; cambiar de tema deja las abiertas atrás", () => {
    const q: TopicRef = { kind: "question", about: person(bruno), asker: ana };
    const s = mention(EMPTY_TOPICS, q);
    expect(openQuestions(answer(s, person(bruno), ana))).toEqual([]);
    const moved = changeTopic(s, thing);
    expect(openQuestions(moved)).toEqual([]);
    expect(resolveReference(moved, { cls: "thing" }).status).toBe("resolved");
  });
  it("nunca pasa de la capacidad y es determinista", () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 30 }), { maxLength: 60 }), (ids) => {
        const run = () =>
          ids.reduce(
            (s, n) => advanceTopics(mention(s, { kind: "good", id: `g${n}` })),
            EMPTY_TOPICS,
          );
        expect(run().entries.length).toBeLessThanOrEqual(TOPIC_CAPACITY);
        expect(run()).toEqual(run());
      }),
    );
  });
});
