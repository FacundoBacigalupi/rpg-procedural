import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  externalAccount,
  type HolderRef,
  holderAccount,
  ledgerUnit,
  loadContent,
} from "../../core/index.ts";
import { type ActionPlan, LOCATION } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../index.ts";
import { groundHolder, withGround } from "./ground.ts";
import { Life } from "./index.ts";

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
const grain = ledgerUnit("good:grain");

function plan(me: string, verb: string, what?: string): ActionPlan {
  return {
    actor: me as never,
    source: "player",
    root: {
      kind: "do",
      verb,
      args: what === undefined ? [] : [{ role: "what", text: what }],
      manner: [],
    },
    manner: [],
    causes: [{ kind: "state", entity: me as never, key: "intent" }],
  };
}

describe("soltar en el suelo (drop)", () => {
  it("lo soltado queda a nombre del lugar con el acto como origen y `take` lo levanta de ahí", () => {
    const life = Life.create(7, content);
    const w = life.world;
    const me = life.player;
    const first = w.log.all()[0];
    if (!first) throw new Error("sin eventos");
    w.ledger.post({
      tick: first.tick,
      eventId: first.id,
      transfers: [
        {
          unit: grain,
          from: externalAccount("seed"),
          to: holderAccount(me as HolderRef),
          amount: 2000,
        },
      ],
    });
    const hex = w.truth.get(LOCATION, me)?.hex as number;
    const ground = holderAccount(groundHolder(w.truth, w.map, hex));
    const carried = () => w.ledger.balance(holderAccount(me as HolderRef), grain);
    const before = w.ledger.balance(ground, grain);
    const total = w.ledger.total(grain);
    const carriedBefore = carried();

    const report = life.turn(plan(me, "drop", "1 kilo de grano"), 1);
    const ev = report.events.find((e) => e.kind === "action.drop");
    expect(ev).toBeDefined();
    expect(carried()).toBe(carriedBefore - 1000);
    expect(w.ledger.balance(ground, grain)).toBe(before + 1000);
    // El lote del suelo tiene origen: el asiento cita el evento del acto.
    const posted = w.ledger
      .journal()
      .filter((t) => t.to === ground && t.unit === grain && t.from === holderAccount(me));
    expect(posted.map((t) => [t.amount, t.eventId])).toEqual([[1000, ev?.id]]);
    expect(w.ledger.total(grain)).toBe(total);

    // Nombrar lo que no lleva no suelta otra cosa.
    const miss = life.turn(plan(me, "drop", "hongos"), 2);
    const missEv = miss.events.find((e) => e.kind === "action.drop");
    const missData = missEv?.data as { effect?: { got?: unknown[] } } | undefined;
    expect(missData?.effect?.got).toEqual([]);
    expect(carried()).toBe(carriedBefore - 1000);

    // `take` sin `from` levanta del mismo lugar.
    life.turn(plan(me, "take", "grano"), 3);
    expect(carried() + w.ledger.balance(ground, grain)).toBe(carriedBefore + before);
    expect(w.ledger.audit()).toEqual([]);
  }, 120_000);

  it("`withGround` conserva los puestos y no pisa un suelo que ya venía", () => {
    const life = Life.create(7, content);
    const w = life.world;
    const stalls = () => [];
    const own = () => [];
    expect(withGround({ stalls }, w.truth, w.map).stalls).toBe(stalls);
    expect(withGround({ ground: own }, w.truth, w.map).ground).toBe(own);
    const hex = w.truth.get(LOCATION, life.player)?.hex as number;
    expect(withGround(undefined, w.truth, w.map).ground?.(hex, undefined)).toEqual([
      groundHolder(w.truth, w.map, hex),
    ]);
  }, 120_000);
});
