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
  type ActionPlan,
  checkInvariants,
  HARVEST,
  LOCATION,
  PERSON,
  PERSON_SUBSTANCE,
  ROTTED,
  type SubstanceDef,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { OPEN_DEALS } from "./converse.ts";
import { Life } from "./life.ts";
import type { ConsumableDef } from "./substances.ts";
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
const grain = ledgerUnit("good:grain");
const tea = ledgerUnit("good:tea");

const MILD: SubstanceDef = {
  id: "mild-tea",
  routes: { ingest: { bioavailability: 0.9, halfHours: 2 } },
  halfLifeHours: 6,
  ec50: 5,
  hill: 1,
  latencyHours: 6,
  toxicThreshold: Number.POSITIVE_INFINITY,
  damagePerHourAtDouble: 0,
  repairHalfHours: 24,
};
const consumables: ConsumableDef[] = [{ good: "tea", def: MILD, route: "ingest", amount: 1 }];

const plan = (actor: AgentId, root: ActionPlan["root"]): ActionPlan => ({
  actor,
  source: "player",
  root,
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});
const say = (actor: AgentId, to: AgentId, text: string) =>
  plan(actor, {
    kind: "do",
    verb: "speak",
    args: [
      { role: "to", entity: to },
      { role: "content", text },
    ],
    manner: [],
  });

describe("sustancias: entregar lo tratado (vida completa)", () => {
  it("al aceptar, el té pasa a la despensa del vecino por el ledger y nadie toma dosis hasta consume", () => {
    const life = Life.create(7, content, { consumables });
    const w = life.world;
    const me = life.player;
    const mine = w.truth.get(PERSON, me)?.household;
    const npc = living(w.truth).find(
      (id) => id !== me && w.truth.get(PERSON, id)?.household !== mine,
    ) as AgentId;
    const home = w.truth.get(PERSON, npc)?.household as string;
    const larder = holderAccount(home as unknown as HolderRef);
    const pocket = holderAccount(me as unknown as HolderRef);
    const first = w.log.all()[0] as NonNullable<ReturnType<typeof w.log.all>[number]>;
    const post = (transfers: Parameters<typeof w.ledger.post>[0]["transfers"]) =>
      w.ledger.post({ tick: first.tick, eventId: first.id, transfers });
    post([{ unit: grain, from: externalAccount(HARVEST), to: larder, amount: 30000 }]);
    const stock = w.ledger.holdings(larder).find((h) => h.unit === tea)?.amount ?? 0;
    if (stock > 0) post([{ unit: tea, from: larder, to: externalAccount(ROTTED), amount: stock }]);
    post([{ unit: tea, from: externalAccount("seed"), to: pocket, amount: 3000 }]);
    const here = w.truth.get(LOCATION, me);
    if (here) w.truth.set(LOCATION, npc, here);
    w.truth.set(OPEN_DEALS, npc, {
      with: me,
      deal: { gets: { good: "tea", grams: 1000 }, gives: { good: "grain", grams: 20 } },
      at: life.now,
      rounds: 0,
    });

    const total = { tea: w.ledger.total(tea), grain: w.ledger.total(grain) };
    const report = life.turn(say(me, npc, "Trato hecho"), 1);
    const reply = report.events.find((e) => e.kind === "action.speak" && e.actors[0] === npc);
    const line = (reply?.data as { effect: { reply: string } } | undefined)?.effect.reply;
    expect(line).toBe("accept.thanks");
    expect(w.ledger.balance(larder, tea)).toBe(1000);
    expect(w.ledger.balance(pocket, tea)).toBe(2000);
    expect(w.ledger.total(tea)).toBe(total.tea);
    expect(w.ledger.total(grain)).toBe(total.grain);
    expect(w.truth.get(OPEN_DEALS, npc)).toBeUndefined();
    // Recibir el té no es tomarlo: ninguna dosis hasta que `consume` lo gaste.
    expect(w.truth.get(PERSON_SUBSTANCE, npc)?.held ?? []).toEqual([]);
    expect(w.truth.get(PERSON_SUBSTANCE, me)?.held ?? []).toEqual([]);

    life.turn(
      plan(me, { kind: "do", verb: "consume", args: [{ role: "what", text: "té" }], manner: [] }),
      1,
    );
    expect(w.truth.get(PERSON_SUBSTANCE, me)?.held.length ?? 0).toBeGreaterThan(0);
    expect(w.ledger.balance(pocket, tea)).toBeLessThan(2000);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 120_000);
});
