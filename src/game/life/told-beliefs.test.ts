import { describe, expect, it } from "vitest";
import type { AgentId, Event, EventId } from "../../core/index.ts";
import {
  type Beliefs,
  believed,
  type Heard,
  type ProcessContext,
  WorldTruth,
} from "../../sim/index.ts";
import { heardClaimsOf } from "./heardclaims.ts";
import {
  learnToldClaims,
  TOLD_ALIVE_CONFIDENCE,
  TOLD_CLAIMS_KEY,
  toldAliveClaims,
  toldClaimsProcess,
} from "./knowing.ts";

const A = "agent:a" as AgentId;
const B = "agent:b" as AgentId;
const C = "agent:c" as AgentId;
const HOUR = 3_600;

const heard = (claim: "dead" | "alive", at: number): Heard => ({
  claims: [{ about: B, claim, from: C, at }],
});

describe("lo oído como creencia told (HEARD → BELIEFS)", () => {
  it("«murió» queda como alive=false con fuente told y la confianza de oídas", () => {
    const b = learnToldClaims(undefined, A, heard("dead", 10 * HOUR), 9 * HOUR + 1, 10 * HOUR);
    const belief = believed(b, B, "alive");
    expect(belief?.value).toBe(false);
    expect(belief?.confidence).toBe(TOLD_ALIVE_CONFIDENCE);
    expect(belief?.sources).toEqual([{ kind: "told", from: C, tick: 10 * HOUR }]);
  });

  it("la misma afirmación no suma dos veces ni fuera de la última hora", () => {
    const h = heard("alive", 10 * HOUR);
    const once = learnToldClaims(undefined, A, h, 9 * HOUR + 1, 10 * HOUR);
    expect(learnToldClaims(once, A, h, 9 * HOUR + 1, 10 * HOUR)).toBe(once);
    expect(learnToldClaims(once, A, h, 10 * HOUR, 11 * HOUR)).toBe(once);
  });

  it("choca con lo que ya creía: una creencia firme no cae por un solo «murió»", () => {
    const firm: Beliefs = {
      items: [
        {
          prop: { kind: "attr", subject: B, attr: "alive" },
          value: true,
          confidence: 0.95,
          asOf: 10 * HOUR,
          learnedAt: 0,
          sources: [],
          salience: 1,
          measured: 10 * HOUR,
        },
      ],
    };
    const after = learnToldClaims(firm, A, heard("dead", 10 * HOUR), 9 * HOUR + 1, 10 * HOUR);
    expect(believed(after, B, "alive")?.value).toBe(true);
    expect(believed(after, B, "alive")?.confidence).toBeLessThan(0.95);
  });

  it("nadie guarda lo que le cuentan de sí mismo", () => {
    const mine: Heard = { claims: [{ about: A, claim: "dead", from: C, at: 10 * HOUR }] };
    expect(learnToldClaims(undefined, A, mine, 0, 10 * HOUR)).toBeUndefined();
  });
});

describe("leer lo oído desde BELIEFS (life-38)", () => {
  it("toldAliveClaims devuelve lo contado: quién, qué dijo, de quién y cuándo", () => {
    const b = learnToldClaims(undefined, A, heard("dead", 10 * HOUR), 9 * HOUR + 1, 10 * HOUR);
    expect(toldAliveClaims(b)).toEqual([{ about: B, claim: "dead", from: C, at: 10 * HOUR }]);
  });

  it("lo que no se contó (sin fuente told) no cuenta como oído", () => {
    const seen: Beliefs = {
      items: [
        {
          prop: { kind: "attr", subject: B, attr: "alive" },
          value: true,
          confidence: 0.9,
          asOf: 0,
          learnedAt: 0,
          sources: [{ kind: "percept", percept: "x", tick: 0 }],
          salience: 1,
          measured: 0,
        },
      ],
    };
    expect(toldAliveClaims(seen)).toEqual([]);
    expect(toldAliveClaims(undefined)).toEqual([]);
  });
});

describe("el evento de la charla alimenta BELIEFS (life-39)", () => {
  it("toldClaimsProcess vuelca cada afirmación de action.speak como creencia told en el tick del evento", () => {
    const truth = new WorldTruth();
    const event = {
      id: "event:1" as EventId,
      tick: 10 * HOUR,
      kind: "action.speak",
      actors: [A, C],
      place: { space: "x" },
      data: {
        [TOLD_CLAIMS_KEY]: [{ actor: A, claim: { about: B, claim: "dead", from: C, at: 0 } }],
      },
      emissions: {},
      causes: [],
      resolution: "local",
    } as unknown as Event;
    const out = toldClaimsProcess().run({ truth, recent: [event] } as unknown as ProcessContext);
    const change = out.changes?.[0];
    expect(change).toBeDefined();
    const beliefs = (change as unknown as { value: Beliefs }).value;
    const belief = believed(beliefs, B, "alive");
    expect(belief?.value).toBe(false);
    expect(belief?.sources).toEqual([{ kind: "told", from: C, tick: 10 * HOUR }]);
    expect(toldAliveClaims(beliefs)).toEqual([{ about: B, claim: "dead", from: C, at: 10 * HOUR }]);
  });

  it("sin afirmaciones no cambia nada", () => {
    const truth = new WorldTruth();
    const event = { kind: "action.speak", tick: 1, data: {} } as unknown as Event;
    const out = toldClaimsProcess().run({ truth, recent: [event] } as unknown as ProcessContext);
    expect(out.changes).toBeUndefined();
  });
});

describe("«dicen que…» en la vista (heard-4)", () => {
  const names = new Map<AgentId, string>([
    [B, "Marta"],
    [C, "el herrero"],
  ]);
  const nameOf = (id: AgentId) => names.get(id);

  it("cita a quién se refiere y quién lo contó, solo lo llegado desde since", () => {
    const b = learnToldClaims(undefined, A, heard("dead", 10 * HOUR), 9 * HOUR + 1, 10 * HOUR);
    expect(heardClaimsOf(b, 9 * HOUR, A, nameOf)).toEqual([
      { about: "Marta", claim: "dead", from: "el herrero", sure: true },
    ]);
    expect(heardClaimsOf(b, 10 * HOUR, A, nameOf)).toEqual([]);
  });

  it("sin nombre conocido de la persona no entra; sin el del que contó, queda anónimo", () => {
    const b = learnToldClaims(undefined, A, heard("alive", 10 * HOUR), 9 * HOUR + 1, 10 * HOUR);
    expect(heardClaimsOf(b, 0, A, (id) => (id === B ? "Marta" : undefined))).toEqual([
      { about: "Marta", claim: "alive", sure: true },
    ]);
    expect(heardClaimsOf(b, 0, A, () => undefined)).toEqual([]);
  });

  it("lo percibido (sin fuente told) no se cita como oído", () => {
    const seen: Beliefs = {
      items: [
        {
          prop: { kind: "attr", subject: B, attr: "alive" },
          value: true,
          confidence: 0.9,
          asOf: 0,
          learnedAt: 0,
          sources: [{ kind: "percept", percept: "x", tick: 5 * HOUR }],
          salience: 1,
          measured: 0,
        },
      ],
    };
    expect(heardClaimsOf(seen, 0, A, nameOf)).toEqual([]);
  });
});
