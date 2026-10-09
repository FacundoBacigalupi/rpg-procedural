import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, Rng } from "../../core/index.ts";
import type { Deed } from "../law/index.ts";
import type { Vector } from "../relations/index.ts";
import { type AccuseInput, decideDefense, hearAccusation } from "./accusations.ts";
import { understand } from "./acts.ts";
import { SpeechLine } from "./lines.ts";
import { decideReply, type ReplyInput } from "./reply.ts";

const ana = "agent:1" as AgentId;
const bruno = "agent:2" as AgentId;
const carla = "agent:3" as AgentId;

const lines = (JSON.parse(readFileSync("content/speech/es.json", "utf8")) as unknown[]).map((l) =>
  SpeechLine.parse(l),
);
const lex = {
  people: [
    { id: carla, names: ["Carla"] },
    { id: bruno, names: ["Bruno"] },
  ],
  goods: [],
};
const feel: Vector = {
  trust: 0.4,
  respect: 0,
  affection: 0,
  fear: 0,
  attraction: 0,
  gratitude: 0,
  jealousy: 0,
  resentment: 0,
  familiarity: 0.5,
  dependency: 0,
};
const cited: Deed = {
  kind: "theft",
  by: carla,
  victim: bruno,
  event: "event:9" as EventId,
  at: 0,
  via: "saw",
};
const view = {
  trustInAccuser: 0.9,
  affinityToAccused: 0,
  ownKnowledge: null,
  gullibility: 0.8,
  stake: 0,
};

const reply = (text: string, accuse: AccuseInput | undefined, seed = 1) =>
  decideReply(
    {
      act: understand(text, lex),
      speaker: bruno,
      listener: ana,
      feel,
      direct: () => null,
      heard: [],
      nameOf: () => "Carla",
      goodName: () => "grano",
      held: () => 0,
      members: 1,
      lines,
      rng: Rng.root(seed),
      ...(accuse ? { accuse } : {}),
    } satisfies ReplyInput,
    0,
  );

describe("acusar en el diálogo", () => {
  it("entiende a quién se acusa, de qué y con qué firmeza", () => {
    expect(understand("Carla me robó el grano", lex)).toEqual({
      kind: "accuse",
      accused: carla,
      deed: "theft",
      victim: "speaker",
      certainty: 0.7,
    });
    expect(understand("Creo que Carla le pegó a alguien", lex)).toMatchObject({
      kind: "accuse",
      accused: carla,
      deed: "assault",
      victim: null,
      certainty: 0.4,
    });
    expect(understand("Vos me robaste, lo vi", lex)).toMatchObject({
      accused: "you",
      victim: "speaker",
      certainty: 0.9,
    });
    expect(understand("Te voy a pegar", lex).kind).toBe("threaten");
  });

  it("quien oye un hecho respaldado de alguien confiable lo sopesa, y si ya lo sospechaba cree y guarda el hecho como contado", () => {
    const plain = reply("Carla me robó, lo vi", { as: "hearer", accused: carla, cited, view });
    expect(plain.line).toBe("accuse.weigh");
    const r = reply("Carla me robó, lo vi", {
      as: "hearer",
      accused: carla,
      cited,
      view: { ...view, ownKnowledge: cited },
    });
    expect(r.line).toBe("accuse.believe");
    expect(r.accusation?.unbacked).toBe(false);
    expect(r.accusation?.heard?.learned).toMatchObject({
      by: carla,
      via: "told",
      event: "event:9",
    });
  });

  it("sin hecho que mostrar y con interés, huele a calumnia y queda la huella sin respaldo", () => {
    const r = reply("Carla me robó", {
      as: "hearer",
      accused: carla,
      cited: null,
      view: { ...view, trustInAccuser: 0.2, stake: 0.9, affinityToAccused: 0.8 },
    });
    expect(r.line).toBe("accuse.slander");
    expect(r.accusation?.unbacked).toBe(true);
    expect(r.accusation?.heard?.learned).toBeNull();
  });

  it("el acusado se defiende según lo que es y lo que hizo", () => {
    const base = { guilty: true, honesty: 0.9, justification: 0, pride: 0.2, counterable: false };
    const rng = () => Rng.root(3).fork("x");
    expect(decideDefense({ ...base, honesty: 1 }, rng())).toBe("confess");
    expect(decideDefense({ ...base, justification: 0.8 }, rng())).toBe("justify");
    expect(decideDefense({ ...base, honesty: 0 }, rng())).toBe("deny");
    expect(decideDefense({ ...base, guilty: false }, rng())).toBe("protest");
    const r = reply("Vos me robaste", { as: "accused", defense: { ...base, guilty: false } });
    expect(r.line).toBe("accuse.protest");
    expect(r.accusation?.accused).toBe("listener");
  });

  it("sin entrada del cableado la toma como charla, y sin a quién pide que se aclare", () => {
    expect(reply("Carla me robó", undefined).line).toBe("other");
    expect(reply("Me robaron", { as: "accused", defense: { guilty: true } as never }).line).toBe(
      "accuse.unclear",
    );
  });

  it("la creencia está acotada", () => {
    fc.assert(
      fc.property(fc.nat(100), fc.nat(100), fc.nat(100), (t, g, c) => {
        const a = {
          accuser: bruno,
          accused: carla,
          kind: "theft" as const,
          victim: bruno,
          event: null,
          certainty: c / 100,
        };
        const heard = hearAccusation(
          a,
          { ...view, trustInAccuser: t / 100, gullibility: g / 100 },
          null,
        );
        expect(heard.belief).toBeGreaterThanOrEqual(0);
        expect(heard.belief).toBeLessThanOrEqual(1);
      }),
      { numRuns: 50 },
    );
  });
});
