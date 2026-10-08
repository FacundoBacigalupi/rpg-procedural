import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AgentId, Rng } from "../../core/index.ts";
import type { Vector } from "../relations/index.ts";
import { understand } from "./acts.ts";
import { hear } from "./knowledge.ts";
import { SpeechLine } from "./lines.ts";
import {
  decideReply,
  GIFT_GRAMS,
  holdsGrudge,
  isFormal,
  RESERVE_GRAMS_PER_MEMBER,
  type ReplyInput,
  warmth,
} from "./reply.ts";

const STRANGER: Vector = {
  trust: 0.05,
  respect: 0,
  affection: 0,
  fear: 0,
  attraction: 0,
  gratitude: 0,
  jealousy: 0,
  resentment: 0,
  familiarity: 0,
  dependency: 0,
};
// Como un padre o un hijo: cariño, confianza y trato diario (content/relation-bonds).
const KIN: Vector = { ...STRANGER, trust: 0.35, respect: 0.3, affection: 0.4, familiarity: 0.9 };
// Alguien que solo vive en la misma casa.
const HOUSEMATE: Vector = { ...STRANGER, trust: 0.1, familiarity: 0.5 };

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
    feel: KIN,
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
    const neighbor = decideReply({ ...req, held: () => rich, feel: STRANGER }, 0);
    expect(neighbor.line).toBe("request.credit");
    expect(neighbor.give).toEqual({ good: "grain", grams: GIFT_GRAMS, credit: true });
    const owing = { grams: 800, overdue: false };
    expect(decideReply({ ...req, held: () => rich, feel: STRANGER, owes: owing }, 0).line).toBe(
      "request.refuse.limit",
    );
    const late = { grams: 300, overdue: true };
    expect(decideReply({ ...req, held: () => rich, feel: STRANGER, owes: late }, 0).line).toBe(
      "request.refuse.owes",
    );
  });

  it("da o fía según lo que siente por quien pide, no según el parentesco", () => {
    const rich = 4 * RESERVE_GRAMS_PER_MEMBER + GIFT_GRAMS;
    const req = input({ act: { kind: "request", good: "grain" }, held: () => rich });
    expect(decideReply({ ...req, feel: HOUSEMATE }, 0).line).toBe("request.credit");
    // Un desconocido que se ganó el cariño recibe como de la familia.
    const dear = { ...STRANGER, affection: 0.5, trust: 0.3 };
    expect(decideReply({ ...req, feel: dear }, 0).line).toBe("request.give");
    // Un pariente al que se le guarda rencor o no se le cree, no.
    expect(decideReply({ ...req, feel: { ...KIN, resentment: 0.5 } }, 0).line).toBe(
      "request.refuse.grudge",
    );
    expect(decideReply({ ...req, feel: { ...KIN, trust: -0.4 } }, 0).line).toBe(
      "request.refuse.grudge",
    );
    expect(warmth(KIN)).toBeGreaterThan(warmth(HOUSEMATE));
    expect(holdsGrudge(KIN)).toBe(false);
  });

  it("se habla de usted a quien se respeta o tiene rango y no se trata de cerca", () => {
    expect(isFormal(STRANGER)).toBe(false);
    expect(isFormal(STRANGER, true)).toBe(true);
    expect(isFormal({ ...STRANGER, respect: 0.6 })).toBe(true);
    // El hijo que respeta a su padre lo tutea: lo conoce demasiado.
    expect(isFormal(KIN, true)).toBe(false);
    const greet = input({ act: { kind: "greet" }, feel: STRANGER, rankAbove: true });
    const formalLines = lines.find((l) => l.id === "greet")?.formal ?? [];
    expect(formalLines).toContain(decideReply(greet, 0).text);
  });

  it("a quien sabe que robó o pegó no le da ni de familia, y lo saluda frío", () => {
    const rich = 4 * RESERVE_GRAMS_PER_MEMBER + GIFT_GRAMS;
    const req = input({ act: { kind: "request", good: "grain" }, held: () => rich });
    const refused = decideReply({ ...req, reproach: "theft" }, 0);
    expect(refused.line).toBe("request.refuse.theft");
    expect(refused.give).toBeUndefined();
    expect(decideReply({ ...req, reproach: "assault" }, 0).line).toBe("request.refuse.assault");
    expect(decideReply(input({ reproach: "assault" }), 0).line).toBe("greet.cold.assault");
    expect(decideReply({ ...req, reproach: null }, 0).give).toBeDefined();
  });

  it("es determinista", () => {
    const a = input({ act: { kind: "greet" } });
    expect(decideReply(a, 0)).toEqual(decideReply(a, 0));
  });
});
