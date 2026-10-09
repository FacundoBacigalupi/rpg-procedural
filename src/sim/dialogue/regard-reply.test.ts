import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, Rng } from "../../core/index.ts";
import type { Vector } from "../relations/index.ts";
import { understand } from "./acts.ts";
import { SpeechLine } from "./lines.ts";
import { decideReply, type ReplyInput } from "./reply.ts";
import type { ThreatInput } from "./threats.ts";

const lines = (JSON.parse(readFileSync("content/speech/es.json", "utf8")) as unknown[]).map((l) =>
  SpeechLine.parse(l),
);
const ana = "agent:1" as AgentId;
const bruno = "agent:2" as AgentId;
const lex = { people: [{ id: bruno, names: ["Bruno"] }], goods: [] };
const FEEL: Vector = {
  trust: 0.2,
  respect: 0,
  affection: 0.2,
  fear: 0,
  attraction: 0,
  gratitude: 0,
  jealousy: 0,
  resentment: 0,
  familiarity: 0.5,
  dependency: 0,
};
const THREAT: ThreatInput = {
  credibility: 0.9,
  harm: 0,
  demandCost: 0.1,
  courage: 0.1,
  pride: 0.2,
  witnesses: 0,
  selfConfidence: 0.2,
  escape: 0,
  help: 0,
  recourse: 0,
};

function input(over: Partial<ReplyInput>): ReplyInput {
  return {
    act: { kind: "greet" },
    speaker: bruno,
    listener: ana,
    feel: FEEL,
    direct: () => null,
    heard: [],
    nameOf: () => "Bruno",
    goodName: () => "grano",
    held: () => 0,
    members: 4,
    lines,
    rng: Rng.root(1),
    ...over,
  };
}

describe("entender amenazas, halagos e insultos", () => {
  it("reconoce el daño prometido y gana sobre el pedido que lo acompaña", () => {
    expect(understand("Te voy a matar", lex)).toEqual({ kind: "threaten", harm: 1 });
    expect(understand("Te rompo la cara", lex)).toEqual({ kind: "threaten", harm: 0.5 });
    expect(understand("Dame grano o te mato", lex).kind).toBe("threaten");
    expect(understand("Me las vas a pagar", lex).kind).toBe("threaten");
  });

  it("reconoce halagos e insultos, y no confunde charla común", () => {
    expect(understand("Sos el mejor", lex).kind).toBe("flatter");
    expect(understand("No hay nadie como vos", lex)).toEqual({ kind: "flatter", excess: 0.8 });
    expect(understand("Sos un cobarde", lex)).toEqual({ kind: "insult", sting: 0.7 });
    expect(understand("Idiota", lex).kind).toBe("insult");
    expect(understand("el cielo está lindo", lex).kind).toBe("other");
    expect(understand("Hola", lex).kind).toBe("greet");
  });
});

describe("contestar a amenazas, halagos e insultos", () => {
  it("sin los insumos los toma como charla", () => {
    expect(decideReply(input({ act: { kind: "threaten", harm: 1 } }), 0).line).toBe("other");
    expect(decideReply(input({ act: { kind: "insult", sting: 0.7 } }), 0).line).toBe("other");
  });

  it("una amenaza creíble a un miedoso hace ceder y deja miedo y rencor", () => {
    const r = decideReply(
      input({ act: { kind: "threaten", harm: 1 }, regard: { threat: THREAT } }),
      0,
    );
    expect(r.line.startsWith("threat.")).toBe(true);
    expect(r.threat?.verdict.fear).toBeGreaterThan(0.3);
    expect(r.threat?.aftermath.fearDelta).toBeGreaterThan(0);
    expect(r.threat?.aftermath.trustDelta).toBeLessThan(0);
  });

  it("un farol ante un valiente se desafía", () => {
    const brave: ThreatInput = { ...THREAT, credibility: 0.05, courage: 0.9, selfConfidence: 0.9 };
    const r = decideReply(
      input({ act: { kind: "threaten", harm: 0.5 }, regard: { threat: brave } }),
      0,
    );
    expect(r.line).toBe("threat.defy");
  });

  it("un halago hueco a un perspicaz baja la confianza; uno sincero a un vanidoso gusta", () => {
    const base = {
      vanity: 0.9,
      excess: 0,
      insight: 0.1,
      trust: 0.5,
      motiveKnown: false,
      recent: 0,
    };
    const nice = decideReply(
      input({ act: { kind: "flatter", excess: 0.2 }, regard: { flattery: base } }),
      0,
    );
    expect(nice.line).toBe("flatter.pleased");
    const sly = decideReply(
      input({
        act: { kind: "flatter", excess: 0.9 },
        regard: { flattery: { ...base, insight: 0.9, motiveKnown: true } },
      }),
      0,
    );
    expect(sly.line).toBe("flatter.hollow");
    expect(sly.flattery?.trustDelta).toBeLessThan(0);
  });

  it("un insulto es una ofensa que crece con los testigos y la brecha", () => {
    const at = (witnesses: number, gap: number) =>
      decideReply(
        input({
          act: { kind: "insult", sting: 0.5 },
          regard: { insult: { sting: 0, truth: 0.2, gap, witnesses } },
        }),
        0,
      );
    expect(at(3, 1).offense?.size).toBeGreaterThan(at(0, 0).offense?.size ?? 1);
    expect(at(0, 0).line).toBe("insult.hurt");
  });

  it("es determinista: mismo rng, misma respuesta", () => {
    fc.assert(
      fc.property(fc.nat({ max: 1000 }), (seed) => {
        const mk = () =>
          decideReply(
            input({
              act: { kind: "threaten", harm: 0.5 },
              regard: { threat: THREAT, vindictiveness: 0.5 },
              rng: Rng.root(seed),
            }),
            0,
          );
        expect(mk()).toEqual(mk());
      }),
    );
  });
});

describe("amenazas con exigencia", () => {
  const scared = { ...FEEL, fear: 0.9 };
  const yielding: ThreatInput = { ...THREAT, courage: 0, pride: 0, credibility: 1 };
  const grain = { people: [], goods: [{ id: "good:grain", names: ["grano"] }] };

  it("«dame grano o te mato» guarda la exigencia", () => {
    expect(understand("Dame grano o te mato", grain)).toEqual({
      kind: "threaten",
      harm: 1,
      demand: "good:grain",
    });
  });

  it("quien cede entrega lo exigido si le sobra, y si no, dice que no tiene", () => {
    const act = { kind: "threaten", harm: 1, demand: "good:grain" } as const;
    const run = (held: number) =>
      decideReply(
        input({
          act,
          feel: scared,
          held: () => held,
          regard: { threat: yielding, vindictiveness: 0.5 },
        }),
        0,
      );
    const rich = run(100000);
    expect(rich.line).toBe("threat.yield.give");
    expect(rich.give).toEqual({ good: "good:grain", grams: 500 });
    const poor = run(100);
    expect(poor.give).toBeUndefined();
    expect(poor.line).toBe("request.short");
  });
});
