import { describe, expect, it } from "vitest";
import type { AgentId, EventId, Tick } from "../../core/index.ts";
import {
  type Amends,
  admitsIt,
  avoidsVictim,
  CONFESS_SHIFT,
  didDeed,
  heaviestGuilt,
  honestyShift,
  KEPT_OWN_DEEDS,
  type OwnDeeds,
  rememberOwn,
  type Stance,
} from "./conscience.ts";
import type { Conscience, OwnDeed } from "./testimony.ts";

const a = "agent:1" as AgentId;
const b = "agent:2" as AgentId;
const deed = (n: number, over: Partial<OwnDeed> = {}): OwnDeed => ({
  kind: "theft",
  victim: b,
  at: 0 as Tick,
  event: `event:${n}` as EventId,
  harm: 0.8,
  ...over,
});
const soul: Conscience = {
  bondToVictim: 0.8,
  moralWeight: 0.9,
  justification: 0,
  fearOfExposure: 0,
};
const stance = (response: Stance["response"]): Stance => ({
  response,
  guilt: 0.5,
  decided: 0 as Tick,
});

describe("hechos propios", () => {
  it("no repite el mismo evento y olvida los más viejos", () => {
    let own: OwnDeeds | undefined;
    own = rememberOwn(own, deed(1));
    expect(rememberOwn(own, deed(1))).toBe(own);
    for (let i = 2; i < KEPT_OWN_DEEDS + 5; i++) own = rememberOwn(own, deed(i));
    expect(own.deeds.length).toBe(KEPT_OWN_DEEDS);
    expect(own.deeds[0]?.event).not.toBe("event:1");
  });

  it("didDeed busca por clase y víctima, y sin víctima por cualquiera", () => {
    const own = rememberOwn(undefined, deed(1));
    expect(didDeed(own, "theft", b)).toBeDefined();
    expect(didDeed(own, "theft", null)).toBeDefined();
    expect(didDeed(own, "theft", a)).toBeUndefined();
    expect(didDeed(own, "assault", b)).toBeUndefined();
    expect(didDeed(undefined, "theft", null)).toBeUndefined();
  });
});

describe("la carga de la culpa", () => {
  it("el peor hecho manda y con el tiempo pesa menos", () => {
    const own = rememberOwn(rememberOwn(undefined, deed(1, { kind: "default" })), deed(2));
    const now = heaviestGuilt(own, () => soul, 0 as Tick);
    expect(now?.deed.event).toBe("event:2");
    const later = heaviestGuilt(own, () => soul, (200 * 86_400) as Tick);
    expect(later?.guilt ?? 0).toBeLessThan(now?.guilt ?? 0);
  });

  it("sin hechos no hay carga", () => {
    expect(heaviestGuilt(undefined, () => soul, 0 as Tick)).toBeNull();
  });
});

describe("qué hace con la culpa", () => {
  it("confesar sube la honestidad y desviar la baja; reconocer es confesar o reparar", () => {
    expect(honestyShift(stance("confess"))).toBe(CONFESS_SHIFT);
    expect(honestyShift(stance("deflect"))).toBe(-CONFESS_SHIFT);
    expect(honestyShift(stance("avoid"))).toBe(0);
    expect(honestyShift(undefined)).toBe(0);
    expect(admitsIt(stance("confess"))).toBe(true);
    expect(admitsIt(stance("repair"))).toBe(true);
    expect(admitsIt(stance("deflect"))).toBe(false);
    expect(admitsIt(undefined)).toBe(false);
  });

  it("evita a la víctima solo si decidió evitar o desviar", () => {
    const own = rememberOwn(undefined, deed(1));
    const amends = (r: Stance["response"]): Amends => ({ byDeed: { "event:1": stance(r) } });
    expect(avoidsVictim(own, amends("avoid"), b)).toBe(true);
    expect(avoidsVictim(own, amends("deflect"), b)).toBe(true);
    expect(avoidsVictim(own, amends("confess"), b)).toBe(false);
    expect(avoidsVictim(own, amends("avoid"), a)).toBe(false);
    expect(avoidsVictim(own, undefined, b)).toBe(false);
  });
});
