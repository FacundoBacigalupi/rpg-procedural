import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  externalAccount,
  type HolderRef,
  holderAccount,
  ledgerUnit,
  loadContent,
} from "../../core/index.ts";
import {
  BELIEFS,
  checkInvariants,
  ENTITY,
  LOCATION,
  PERSON,
  PERSON_SUBSTANCE,
  PLACE,
  SUBSTANCE,
  type SubstanceDef,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { MOLD_RUMORS } from "./moldgossip.ts";
import type { ConsumableDef } from "./substances.ts";
import { acuteOf } from "./substances.ts";
import { living } from "./world.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
const tea = ledgerUnit("good:tea");

/** Una infusión que engancha: con la dependencia alta y horas sin tomar, el cuerpo reclama la dosis. */
const HOOKING: SubstanceDef = {
  id: "hooking-tea",
  routes: { ingest: { bioavailability: 0.9, halfHours: 2 } },
  halfLifeHours: 6,
  ec50: 5,
  hill: 1,
  latencyHours: 6,
  toxicThreshold: Number.POSITIVE_INFINITY,
  damagePerHourAtDouble: 0,
  repairHalfHours: 24,
  dependence: {
    potential: 1,
    tolerancePerUse: 0.1,
    withdrawalOnsetHours: 6,
    withdrawalPeakHours: 24,
    recoveryHalfDays: 30,
  },
};
const consumables: ConsumableDef[] = [{ good: "tea", def: HOOKING, route: "ingest", amount: 1 }];

describe("ir hacia el prestamista, llegar y pedir (cadena completa, opt-in)", () => {
  it("el ansia empuja a ir adonde cree que está quien tiene té; llega y le pide una dosis por el ledger", () => {
    const life = Life.create(7, content, {
      consumables,
      moldHintsFromCatalog: true,
      borrowCraving: { minCraving: 0.2, weight: 3, approach: 1 },
      lendBorrowed: true,
      npcVerbs: ["move"],
      npcJourneyDays: 2,
    });
    const w = life.world;
    const adults = living(w.truth).filter(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    );
    const asker = adults[0] as AgentId;
    const askerHome = w.truth.get(PERSON, asker)?.household as unknown as HolderRef;
    const lender = adults.find(
      (x) => w.truth.get(PERSON, x)?.household !== w.truth.get(PERSON, asker)?.household,
    ) as AgentId;
    const lenderHome = w.truth.get(PERSON, lender)?.household as unknown as HolderRef;

    // El prestamista está en un lugar con nombre; el que pide, en otro hex, y lo sabe (creencia `at`).
    const places = w.truth
      .ids(PLACE)
      .map((p) => ({ id: p, hexes: (w.truth.get(PLACE, p)?.hexes ?? []) as number[] }));
    const home = places.find((p) => p.hexes.length > 0) as { id: string; hexes: number[] };
    const far = (w.map.neighbors[home.hexes[0] as number] ?? []).find(
      (n) => !home.hexes.includes(n),
    ) as number;
    w.truth.set(LOCATION, lender, { hex: home.hexes[0] as number });
    w.truth.set(LOCATION, asker, { hex: far });
    w.truth.set(BELIEFS, asker, {
      items: [
        {
          prop: { kind: "attr", subject: lender, attr: "at" },
          value: { hex: home.hexes[0] as number },
          confidence: 1,
          asOf: life.now,
          learnedAt: life.now,
          sources: [],
          salience: 1,
          measured: life.now,
        },
      ],
    } as never);
    w.truth.set(MOLD_RUMORS, asker, {
      items: [
        {
          rumor: { mold: "attr", about: lender, attr: "has", value: "té" },
          confidence: 0.9,
          hops: 1,
          heardAt: life.now,
          teller: null,
        },
      ],
      told: [],
    } as never);
    // Té en la despensa del prestamista y ninguno en la de quien pide; quien pide, con ansia.
    const first = w.log.all()[0] as NonNullable<ReturnType<typeof w.log.all>[number]>;
    const post = (transfers: Parameters<typeof w.ledger.post>[0]["transfers"]) =>
      w.ledger.post({ tick: first.tick, eventId: first.id, transfers });
    const mine = w.ledger.balance(holderAccount(askerHome), tea);
    if (mine > 0)
      post([
        { unit: tea, from: holderAccount(askerHome), to: externalAccount("rotted"), amount: mine },
      ]);
    post([
      { unit: tea, from: externalAccount("seed"), to: holderAccount(lenderHome), amount: 5000 },
    ]);
    // La sustancia es una entidad del mundo, con la causa del primer evento.
    w.truth.set(
      ENTITY,
      "substance:1" as never,
      {
        id: "substance:1",
        originEventId: first.id,
        createdAt: first.tick,
      } as never,
    );
    w.truth.set(SUBSTANCE, "substance:1" as never, { def: HOOKING, source: "prueba" });
    w.truth.set(PERSON_SUBSTANCE, asker, {
      held: [
        {
          substance: HOOKING.id,
          state: {
            depot: {},
            blood: 0,
            site: 0,
            damage: 0,
            tolerance: 0.3,
            dependence: 1,
            hoursSinceUse: 48,
          },
        },
      ],
      at: life.now,
    } as never);

    const total = w.ledger.total(tea);
    const t0 = life.now;
    life.advanceTo(t0 + 8 * 86_400);

    const decided = w.log
      .all()
      .filter((e) => e.kind === "npc.decided" && e.actors[0] === asker)
      .map((e) => (e.data as { choice: string }).choice);
    const kinds: Record<string, number> = {};
    for (const e of w.log.all())
      if (e.tick > t0 && e.actors[0] === asker) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    expect(kinds["action.move"]).toBeGreaterThan(0);
    expect(decided).toEqual(expect.arrayContaining([expect.stringContaining("toward:")]));
    const moved = w.log.all().filter((e) => e.kind === "action.move" && e.actors[0] === asker);
    expect(moved.length).toBeGreaterThan(0);
    const borrowed = w.log
      .all()
      .filter((e) => e.kind === "household.borrowed" && e.tick > t0 && e.actors[1] === asker);
    expect(borrowed.length).toBeGreaterThan(0);
    // Llegó al lugar del prestamista y, ya ahí, le pidió: el fiado llega con una dosis de su despensa.
    const arrived = w.log
      .all()
      .find(
        (e) =>
          e.kind === "npc.journey" &&
          e.actors[0] === asker &&
          (e.data as { what: string }).what === "arrived",
      );
    expect(arrived).toBeDefined();
    const after = borrowed.filter((e) => e.tick > (arrived?.tick ?? Number.POSITIVE_INFINITY));
    expect(after.length).toBeGreaterThan(0);
    expect(after[0]?.actors).toEqual([lender, asker]);
    expect(after[0]?.data).toMatchObject({ credit: { grams: 1 } });
    // Lo único que sale del libro es lo que se consumió (té tomado); nada se crea.
    expect(w.ledger.total(tea)).toBeLessThanOrEqual(total);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 540_000);
});
