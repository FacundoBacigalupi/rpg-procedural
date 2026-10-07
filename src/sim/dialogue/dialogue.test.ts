import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AgentId, Rng } from "../../core/index.ts";
import { understand } from "./acts.ts";
import { hear } from "./knowledge.ts";
import { SpeechLine } from "./lines.ts";
import { decideReply, GIFT_GRAMS, RESERVE_GRAMS_PER_MEMBER, type ReplyInput } from "./reply.ts";

const lines = (JSON.parse(readFileSync("content/speech/es.json", "utf8")) as unknown[]).map((l) =>
  SpeechLine.parse(l),
);
const ana = "agent:1" as AgentId;
const bruno = "agent:2" as AgentId;
const lex = {
  people: [{ id: bruno, names: ["Bruno", "hermano"] }],
  goods: [{ id: "grain", names: ["grano", "grain"] }],
};

function input(over: Partial<ReplyInput>): ReplyInput {
  return {
    act: { kind: "greet" },
    speaker: bruno,
    listener: ana,
    kin: true,
    formal: false,
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

describe("entender", () => {
  it("reconoce saludo, despedida, pregunta, pedido y noticia", () => {
    expect(understand("¡Hola, buen día!", lex).kind).toBe("greet");
    expect(understand("Chau, nos vemos", lex).kind).toBe("farewell");
    expect(understand("¿Sabés dónde está Bruno?", lex)).toEqual({ kind: "ask", about: bruno });
    expect(understand("Dame un poco de grano", lex)).toEqual({ kind: "request", good: "grain" });
    expect(understand("Te cuento que Bruno murió", lex)).toEqual({
      kind: "tell",
      about: bruno,
      claim: "dead",
    });
    expect(understand("el cielo está lindo", lex).kind).toBe("other");
  });

  it("con la voz turbia capta lo grueso pero no el detalle", () => {
    expect(understand("¿Dónde está Bruno?", lex, 0.1)).toEqual({ kind: "ask", about: null });
  });
});

describe("contestar", () => {
  it("sin creencias dice que no sabe, y si le contaron algo lo repite como dicho", () => {
    const ask = input({ act: { kind: "ask", about: bruno } });
    expect(decideReply(ask, 0).line).toBe("ask.unknown");
    const told = hear(undefined, { about: bruno, claim: "dead", from: ana, at: 5 });
    expect(decideReply({ ...ask, heard: told.claims }, 0).line).toBe("ask.heard_dead");
  });

  it("responde dónde está lo que ve de primera mano", () => {
    const r = decideReply(
      input({ act: { kind: "ask", about: bruno }, direct: () => ({ where: "yard" }) }),
      0,
    );
    expect(r.line).toBe("ask.at.yard");
    expect(r.text).toContain("Bruno");
  });

  it("duda de lo que contradice lo que ve, y toma como dicho lo que no", () => {
    const tell = input({ act: { kind: "tell", about: bruno, claim: "dead" } });
    const doubt = decideReply({ ...tell, direct: () => ({ where: "room" }) }, 0);
    expect(doubt.line).toBe("tell.doubt");
    expect(doubt.accepted).toBeUndefined();
    expect(decideReply(tell, 9).accepted).toEqual({
      about: bruno,
      claim: "dead",
      from: bruno,
      at: 9,
    });
  });

  it("da solo a la familia y solo lo que sobra después de la reserva", () => {
    const req = input({ act: { kind: "request", good: "grain" } });
    const rich = 4 * RESERVE_GRAMS_PER_MEMBER + GIFT_GRAMS;
    expect(decideReply({ ...req, held: () => rich }, 0).give).toEqual({
      good: "grain",
      grams: GIFT_GRAMS,
    });
    expect(decideReply({ ...req, held: () => rich - 1 }, 0).line).toBe("request.short");
    expect(decideReply({ ...req, held: () => rich, kin: false }, 0).line).toBe("request.stranger");
  });

  it("es determinista", () => {
    const a = input({ act: { kind: "greet" } });
    expect(decideReply(a, 0)).toEqual(decideReply(a, 0));
  });
});
