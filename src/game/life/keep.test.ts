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
  Rng,
} from "../../core/index.ts";
import {
  type ActionPlan,
  believePledge,
  checkInvariants,
  ENTITY,
  HARVEST,
  KNOWN_DEEDS,
  MEMORIES,
  makePledge,
  OWN_DEEDS,
  PERSON,
  PLEDGE,
  PLEDGE_BOOK,
  ROTTED,
  remember,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
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

const rest = (actor: AgentId): ActionPlan => ({
  actor,
  source: "player",
  root: { kind: "do", verb: "rest", args: [], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

const DAY = 86_400;

/** El personaje prometió grano hace mucho y no lo dio: pasada la gracia, la promesa queda rota. */
function overdue(seed: number) {
  const life = Life.create(seed, content);
  const w = life.world;
  const me = life.player;
  const house = w.truth.get(PERSON, me)?.household;
  const other = living(w.truth).find(
    (id) => id !== me && w.truth.get(PERSON, id)?.household === house,
  ) as AgentId;
  const id = "commitment:9999";
  const at = life.now - 60 * DAY;
  const pledge = makePledge({
    promisor: me,
    promisee: other,
    term: { kind: "give", unit: "good:grain" as never, grams: 500 },
    at,
    dueInDays: 10,
    weight: 0.3,
  });
  w.truth.set(PLEDGE, id as never, pledge);
  for (const [who, role] of [
    [me, "promisor"],
    [other, "promisee"],
  ] as const) {
    const belief = believePledge(id, pledge, role, Rng.root(1).fork("t"));
    w.truth.set(PLEDGE_BOOK, who, remember(undefined, belief, life.now));
  }
  return { life, w, me, other, id };
}

describe("cerrar promesas", () => {
  it("vencida y pasada la gracia, la del personaje queda rota con evento con causa", () => {
    const { life, w, me, other, id } = overdue(7);
    const events = [];
    for (let i = 0; i < 3 && w.truth.get(PLEDGE, id as never)?.status === "open"; i++) {
      events.push(...life.turn(rest(me), i + 1).events);
    }
    expect(w.truth.get(PLEDGE, id as never)?.status).toBe("broken");
    const e = events.find((x) => x.kind === "contract.pledge_broken");
    expect(e?.actors).toEqual([me, other]);
    expect(e?.causes.length).toBeGreaterThan(0);
    expect(w.truth.get(PLEDGE_BOOK, other)?.items[0]?.status).toBe("broken");
  }, 120_000);

  it("la promesa rota queda como hecho conocido, culpa propia y memoria de los dos", () => {
    const { life, w, me, other, id } = overdue(7);
    let broke: { id: string } | undefined;
    for (let i = 0; i < 6 && !broke; i++) {
      broke = life.turn(rest(me), i + 1).events.find((x) => x.kind === "contract.pledge_broken");
    }
    expect(broke).toBeDefined();
    expect(w.truth.get(PLEDGE, id as never)?.status).toBe("broken");
    life.turn(rest(me), 9);
    const known = w.truth.get(KNOWN_DEEDS, other)?.deeds ?? [];
    expect(known.some((d) => d.kind === "default" && d.by === me && d.victim === other)).toBe(true);
    expect(w.truth.get(OWN_DEEDS, me)?.deeds.some((d) => d.event === broke?.id)).toBe(true);
    for (const who of [me, other]) {
      expect(w.truth.get(MEMORIES, who)?.items.some((m) => m.eventId === broke?.id)).toBe(true);
    }
  }, 120_000);
});

const grain = ledgerUnit("good:grain");

/** El vecino prometió 500 g de grano al personaje hace mucho; su despensa y bolsillo quedan como se pida. */
function neighborOwes(seed: number, withGrain: boolean) {
  const life = Life.create(seed, content);
  const w = life.world;
  const me = life.player;
  const mine = w.truth.get(PERSON, me)?.household;
  const npc = living(w.truth).find(
    (id) => id !== me && w.truth.get(PERSON, id)?.household !== mine,
  ) as AgentId;
  const home = w.truth.get(PERSON, npc)?.household as string;
  const larder = holderAccount(home as unknown as HolderRef);
  const pocket = holderAccount(npc as unknown as HolderRef);
  const first = w.log.all()[0] as NonNullable<ReturnType<typeof w.log.all>[number]>;
  const post = (transfers: Parameters<typeof w.ledger.post>[0]["transfers"]) => {
    if (transfers.length > 0) w.ledger.post({ tick: first.tick, eventId: first.id, transfers });
  };
  for (const from of [larder, pocket]) {
    post(
      w.ledger
        .holdings(from)
        .filter((h) => h.unit === grain && h.amount > 0)
        .map((h) => ({ unit: h.unit, from, to: externalAccount(ROTTED), amount: h.amount })),
    );
  }
  if (withGrain) {
    post([{ unit: grain, from: externalAccount(HARVEST), to: larder, amount: 30000 }]);
  }
  const id = "commitment:9998";
  const pledge = makePledge({
    promisor: npc,
    promisee: me,
    term: { kind: "give", unit: grain, grams: 500 },
    at: life.now - 60 * DAY,
    dueInDays: 10,
    weight: 0.3,
  });
  w.truth.set(PLEDGE, id as never, pledge);
  for (const [who, role] of [
    [npc, "promisor"],
    [me, "promisee"],
  ] as const) {
    const belief = believePledge(id, pledge, role, Rng.root(1).fork("t"));
    w.truth.set(PLEDGE_BOOK, who, remember(undefined, belief, life.now));
  }
  return { life, w, me, npc, id };
}

const settle = (life: Life, me: AgentId, id: string) => {
  const events = [];
  for (let i = 0; i < 4 && life.world.truth.get(PLEDGE, id as never)?.status === "open"; i++) {
    events.push(...life.turn(rest(me), i + 1).events);
  }
  return events;
};

describe("cerrar promesas: cumplimiento con ledger auditado", () => {
  it("el vecino con grano o la cumple entregando o la rompe, sin romper la conservación", () => {
    const { life, w, me, npc, id } = neighborOwes(7, true);
    const pocket = holderAccount(me as unknown as HolderRef);
    const before = w.ledger.balance(pocket, grain);
    const events = settle(life, me, id);
    const status = w.truth.get(PLEDGE, id as never)?.status;
    expect(["kept", "broken"]).toContain(status);
    if (status === "kept") {
      expect(w.ledger.balance(pocket, grain)).toBe(before + 500);
      const kept = events.find((e) => e.kind === "contract.pledge_kept");
      expect(kept?.actors).toEqual([npc, me]);
      expect(kept?.causes.length).toBeGreaterThan(0);
    } else {
      expect(w.ledger.balance(pocket, grain)).toBe(before);
    }
    expect(w.ledger.audit()).toEqual([]);
  }, 120_000);

  it("sin grano en la despensa se cierra (imposible, rota o, si la aldea le dio grano, cumplida) sin romper el ledger", () => {
    const { life, w, me, id } = neighborOwes(7, false);
    const pocket = holderAccount(me as unknown as HolderRef);
    const before = w.ledger.balance(pocket, grain);
    settle(life, me, id);
    const status = w.truth.get(PLEDGE, id as never)?.status;
    expect(["impossible", "broken", "kept"]).toContain(status);
    if (status !== "kept") expect(w.ledger.balance(pocket, grain)).toBe(before);
    expect(w.ledger.audit()).toEqual([]);
  }, 120_000);

  it("si el destinatario murió queda dispensada, sin culpable ni grano movido", () => {
    const { life, w, me, id } = neighborOwes(7, true);
    const pledge = w.truth.get(PLEDGE, id as never);
    const dead = w.truth.get(ENTITY, pledge?.promisee as never);
    expect(dead).toBeDefined();
    // Se dispensa a mano marcando muerto al destinatario en un tercero: se usa a un vecino distinto.
    const other = living(w.truth).find((x) => x !== me && x !== pledge?.promisor) as AgentId;
    const p2 = { ...(pledge as NonNullable<typeof pledge>), promisee: other };
    w.truth.set(PLEDGE, id as never, p2);
    const ent = w.truth.get(ENTITY, other);
    w.truth.set(ENTITY, other, { ...(ent as NonNullable<typeof ent>), endedAt: life.now });
    const events = settle(life, me, id);
    expect(w.truth.get(PLEDGE, id as never)?.status).toBe("released");
    expect(events.some((e) => e.kind === "contract.pledge_broken")).toBe(false);
    expect(w.ledger.audit()).toEqual([]);
  }, 120_000);
});
