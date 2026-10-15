import { describe, expect, it } from "vitest";
import {
  type AgentId,
  externalAccount,
  type HolderRef,
  holderAccount,
  Ledger,
  ledgerUnit,
  makeId,
  type PlanetClock,
} from "../../core/index.ts";
import {
  LOCATION,
  type Location,
  PERSON_SUBSTANCE,
  type PersonSubstances,
  PLACE,
  WorldTruth,
} from "../../sim/index.ts";
import { substancePanel } from "./substance-panel.ts";
import type { LifeWorld } from "./world.ts";

describe("substancePanel con objetos vistos", () => {
  const me = "agent:1" as AgentId;
  const present = "agent:2" as AgentId;
  const ground = { kind: "cell", cell: makeId("cell", 7) } as HolderRef;
  const clock = { day: 24_000 } as PlanetClock;

  function build() {
    const truth = new WorldTruth();
    truth.set(LOCATION, me, { hex: 5, space: "room:1" } satisfies Location);
    truth.set(LOCATION, present, { hex: 5, space: "room:1" } satisfies Location);
    truth.set(PERSON_SUBSTANCE, me, {
      held: [],
      at: 1000,
      cues: [
        { substance: "secret-tonic", kind: "object", key: "obj:wine", strength: 0.6, at: 1000 },
      ],
    } satisfies PersonSubstances);
    const ledger = new Ledger({ externals: { stock: ["good:wine"] } });
    const wine = ledgerUnit("good:wine");
    const deposit = (holder: HolderRef, event: number) =>
      ledger.post({
        tick: 1000,
        eventId: makeId("event", event),
        transfers: [
          { unit: wine, from: externalAccount("stock"), to: holderAccount(holder), amount: 1 },
        ],
      });
    deposit(present, 1);
    deposit(ground, 3);
    let holdingsCalls = 0;
    const realHoldings = ledger.holdings.bind(ledger);
    const countedLedger = {
      holdings(account: Parameters<typeof realHoldings>[0]) {
        holdingsCalls++;
        return realHoldings(account);
      },
    };
    const w = {
      truth,
      player: me,
      clock,
      map: { lonDeg: 0, cell: makeId("cell", 7) },
      scheduler: { now: 1000 },
      ledger: countedLedger,
    } as unknown as LifeWorld;
    return { w, truth, ground, calls: () => holdingsCalls };
  }

  it("el bien que lleva una persona viva en el mismo hex y espacio despierta el ansia", () => {
    const { w } = build();
    const panel = substancePanel(w, { cueLocal: true, objectCues: ["wine"], viewCues: {} });
    expect(panel.urge).toBe("pressing");
    expect(JSON.stringify(panel)).not.toContain("secret-tonic");
  });

  it("no cuenta bienes de personas presentes en otro hex", () => {
    const { w, truth } = build();
    truth.set(LOCATION, present, { hex: 6, space: "room:1" } satisfies Location);
    const panel = substancePanel(w, { cueLocal: true, objectCues: ["wine"], viewCues: {} });
    expect(panel.urge).toBeUndefined();
  });

  it("no cuenta bienes de personas en otro espacio del mismo hex", () => {
    const { w, truth } = build();
    truth.set(LOCATION, present, { hex: 5, space: "room:2" } satisfies Location);
    const panel = substancePanel(w, { cueLocal: true, objectCues: ["wine"], viewCues: {} });
    expect(panel.urge).toBeUndefined();
  });

  it("pide el suelo del hex y espacio correctos y el lote real despierta el ansia", () => {
    const { w, truth, ground, calls } = build();
    truth.set(LOCATION, present, { hex: 6, space: "room:1" } satisfies Location);
    const seenAt: unknown[][] = [];
    const panel = substancePanel(w, {
      cueLocal: true,
      objectCues: ["wine"],
      viewCues: {
        ground: (hex, space) => {
          seenAt.push([hex, space]);
          return [ground];
        },
      },
    });
    expect(seenAt).toEqual([[5, "room:1"]]);
    expect(calls()).toBeGreaterThan(0);
    expect(panel.urge).toBe("pressing");
    expect(JSON.stringify(panel)).not.toContain("secret-tonic");
  });

  it("con `groundCues` lee del ledger el lugar del hex, sin callback", () => {
    const { w, truth } = build();
    truth.set(LOCATION, present, { hex: 6, space: "room:1" } satisfies Location);
    // Fuera de todo lugar con nombre, lo soltado está a nombre de la celda (donde hay 1 de vino).
    const panel = substancePanel(w, { cueLocal: true, objectCues: ["wine"], groundCues: true });
    expect(panel.urge).toBe("pressing");
    // Un lugar con nombre que cubre el hex tiene su propia cuenta, vacía: no hay nada a la vista.
    truth.set(PLACE, makeId("place", 1), { kind: "fields", hexes: [5] });
    const elsewhere = substancePanel(w, { cueLocal: true, objectCues: ["wine"], groundCues: true });
    expect(elsewhere.urge).toBeUndefined();
  });

  it("el suelo vacío no despierta una señal por objeto", () => {
    const { w, truth } = build();
    truth.set(LOCATION, present, { hex: 6, space: "room:1" } satisfies Location);
    const panel = substancePanel(w, {
      cueLocal: true,
      objectCues: ["wine"],
      viewCues: { ground: () => [] },
    });
    expect(panel.urge).toBeUndefined();
  });

  it("sin viewCues no consulta lotes ajenos aunque estén activas las señales", () => {
    const { w, calls } = build();
    const panel = substancePanel(w, { cueLocal: true, objectCues: ["wine"] });
    expect(panel).toEqual({ self: [], others: [] });
    expect(panel.urge).toBeUndefined();
    expect(calls()).toBe(1);
  });

  it("sin opt-in conserva la salida del panel y no consulta ledger ni suelo", () => {
    const { w, calls } = build();
    let groundCalls = 0;
    const panel = substancePanel(w, {
      objectCues: ["wine"],
      viewCues: {
        ground: () => {
          groundCalls++;
          return [ground];
        },
      },
    });
    expect(panel).toEqual({ self: [], others: [] });
    expect(calls()).toBe(0);
    expect(groundCalls).toBe(0);
  });
});
