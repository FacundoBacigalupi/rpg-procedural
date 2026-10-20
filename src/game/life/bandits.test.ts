import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type HolderRef,
  holderAccount,
  Ledger,
  loadContent,
  makeId,
  Rng,
} from "../../core/index.ts";
import {
  BANDS,
  type Band,
  bandViolations,
  checkInvariants,
  ENTITY,
  goodUnit,
  HOUSEHOLD,
  LOCATION,
  PERSON,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { type BanditsOptions, banditsProcess, bandRows, inAnyBand } from "./bandits.ts";
import { FAMINE } from "./famineRow.ts";
import { Life } from "./life.ts";

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
const DAY = 10;

const ag = (n: number) => makeId("agent", n);
const ev = (n: number) => makeId("event", n);
const goods = [{ id: "grain", name: "grano", form: "good" }] as never;
const GRAIN = goodUnit({ id: "grain", form: "good" });
const acct = (h: string) => holderAccount(h as unknown as HolderRef);
const S = makeId("settlement", 1);

const opts = (over: Partial<BanditsOptions> = {}): BanditsOptions => ({
  day: DAY,
  year: 1000,
  placeOf: () => ({ kind: "cell" }) as never,
  goods,
  ...over,
});

/** Aldea: h1 con 5 adultos sin grano (la hambruna), h2 y h3 con grano de sobra. */
function setup(ages = [25, 27, 30, 33, 36], famine = true) {
  const t = new WorldTruth();
  const ledger = new Ledger({ externals: { mint: [GRAIN] } });
  t.set(ENTITY, S, { id: S, originEventId: ev(1), createdAt: 0 } as never);
  const homes = [makeId("household", 1), makeId("household", 2), makeId("household", 3)];
  const mk = (h: (typeof homes)[number], ids: AgentId[], agesOf: number[]) => {
    t.set(ENTITY, h, { id: h, originEventId: ev(1), createdAt: 0 } as never);
    t.set(HOUSEHOLD, h, { settlement: S, members: ids });
    ids.forEach((id, i) => {
      t.set(ENTITY, id, { id, originEventId: ev(1), createdAt: 0 } as never);
      t.set(PERSON, id, { household: h, born: -(agesOf[i] ?? 30) * 1000 } as never);
    });
  };
  mk(homes[0] as never, [1, 2, 3, 4, 5].map(ag), ages);
  mk(homes[1] as never, [ag(6), ag(7)], [38, 36]);
  mk(homes[2] as never, [ag(8), ag(9)], [41, 39]);
  for (const h of [homes[1], homes[2]])
    ledger.post({
      tick: 0,
      eventId: ev(1),
      transfers: [
        { from: "ext:mint" as never, to: acct(h as string), unit: GRAIN, amount: 900_000 },
      ],
    });
  if (famine)
    t.setRaw(FAMINE.name, S, {
      state: "famine",
      value: 1,
      since: 0,
      pricePush: 1,
      migrationPull: 0,
    });
  return { t, ledger, homes: homes as string[] };
}

let nid = 0;
let evn = 100;
function step(w: ReturnType<typeof setup>, day: number, o: BanditsOptions, seed = 5) {
  const now = day * DAY;
  const r = banditsProcess(o).run({
    truth: w.t,
    now,
    recent: [],
    ledger: w.ledger,
    rng: Rng.root(seed as never).fork("test", now),
    newId: () => makeId("org", ++nid),
  } as never);
  for (const c of r.changes ?? []) {
    const x = c as unknown as { table: string; id: never; value: unknown };
    w.t.setRaw(x.table, x.id, x.value);
  }
  for (const p of r.postings ?? [])
    w.ledger.post({ tick: now, eventId: ev(++evn), transfers: p.transfers });
  return (r.events ?? []) as never as {
    kind: string;
    emissions: Record<string, number>;
    data: Record<string, unknown>;
    causes: { kind: string; key?: string }[];
  }[];
}

const bandIn = (w: ReturnType<typeof setup>): Band | undefined => bandRows(w.t)[0]?.band;
const vault = () => acct("org:1");
const total = (w: ReturnType<typeof setup>) =>
  [...w.homes, "org:1"].reduce((n, h) => n + w.ledger.balance(acct(h), GRAIN), 0);

/** Primer seed donde la banda nace (el juramento sortea). */
function born(over: Partial<BanditsOptions> = {}, ages?: number[]) {
  for (let seed = 1; seed <= 40; seed++) {
    nid = 0;
    const w = setup(ages);
    const evs = step(w, 0, opts(over), seed);
    if (bandIn(w)) return { w, seed, evs };
  }
  throw new Error("nunca nació");
}

describe("life.bandits: nacimiento (proceso aislado)", () => {
  it("nace de la hambruna con causa en la escasez, cabecilla y juramentados reales", () => {
    const { w, evs } = born();
    const b = bandIn(w) as Band;
    const f = evs.find((e) => e.kind === "band.founded");
    expect(f).toBeDefined();
    expect(f?.causes).toEqual([expect.objectContaining({ kind: "state", key: "food-scarcity" })]);
    expect(b.org.members.length).toBeGreaterThanOrEqual(3);
    for (const m of b.org.members)
      expect(["1", "2", "3", "4", "5"]).toContain(String(m.agent).split(":")[1]);
    expect(w.t.get(ENTITY, b.org.id as never)?.originEventId).toBe(b.org.originEventId);
    expect(bandViolations(b, 0)).toEqual([]);
    expect(inAnyBand(w.t, ag(1)) || inAnyBand(w.t, ag(2))).toBe(true);
  });

  it("sin hambruna no nace nada, y los niños y los viejos no se unen", () => {
    nid = 0;
    const w = setup(undefined, false);
    for (let d = 0; d < 30; d++) step(w, d, opts());
    expect(bandRows(w.t)).toHaveLength(0);
    nid = 0;
    const w2 = setup([10, 12, 70, 14, 60]);
    for (let d = 0; d < 5; d++) step(w2, d, opts());
    expect(bandRows(w2.t)).toHaveLength(0);
  });

  it("no hay segunda banda en el mismo lugar mientras la primera está activa", () => {
    const { w, seed } = born();
    for (let d = 1; d < 4; d++) step(w, d, opts(), seed);
    expect(bandRows(w.t)).toHaveLength(1);
  });
});

describe("life.bandits: asaltos, reparto y disolución (proceso aislado)", () => {
  it("solo el opt-in con presencia física emite un asalto perceptible", () => {
    for (const [enabled, local] of [
      [false, true],
      [true, false],
      [true, true],
    ]) {
      const { w, seed } = born();
      const leader = bandIn(w)?.org.positions[0]?.holder as AgentId;
      for (const id of w.t.ids(PERSON)) w.t.set(LOCATION, id, { hex: 1 });
      if (!local) w.t.set(LOCATION, leader, { hex: 2 });
      const events = Array.from({ length: 12 }, (_, i) =>
        step(
          w,
          i + 1,
          opts({
            ...(enabled === undefined ? {} : { witnesses: enabled }),
            rules: { raidEveryDays: 1, captureChance: 0 },
          }),
          seed,
        ),
      ).flat();
      const raids = events.filter((e) => e.kind === "band.raided");
      expect(raids.length).toBeGreaterThan(0);
      for (const raid of raids) {
        expect(raid.data["perceptibleRaid"]).toBe(enabled && local ? true : undefined);
        expect(raid.emissions).toEqual(enabled && local ? { sight: 0.9, sound: 0.8 } : {});
      }
      expect(w.ledger.audit()).toEqual([]);
    }
  });
  it("el botín sale de un hogar y entra al tesoro; el ledger audita y se conserva", () => {
    const { w, seed } = born();
    const before = total(w);
    const kinds = new Set<string>();
    for (let d = 1; d <= 40; d++)
      for (const e of step(w, d, opts(), seed)) {
        kinds.add(e.kind);
        if (e.kind === "band.raided") {
          expect(e.causes.length).toBeGreaterThan(0);
          expect(e.data["amount"]).toBeGreaterThan(0);
        }
      }
    expect(kinds.has("band.raided") || kinds.has("band.raid_repulsed")).toBe(true);
    expect(w.ledger.audit()).toEqual([]);
    expect(total(w)).toBe(before);
    const b = bandIn(w) as Band;
    expect(bandViolations(b, w.ledger.balance(vault(), GRAIN))).toEqual([]);
    // El hogar asaltado nunca queda por debajo de lo que conserva.
    for (const h of w.homes.slice(1))
      expect(w.ledger.balance(acct(h), GRAIN)).toBeGreaterThanOrEqual(Math.min(900_000, 90_000));
  });

  it("con sucesión, la muerte causa el relevo sin repartir ni perder tesoro", () => {
    const options = {
      succession: true,
      rules: { minFounders: 2, raidEveryDays: 100, shareEveryDays: 100 },
    };
    const { w, seed } = born(options);
    const b0 = bandIn(w) as Band;
    w.ledger.post({
      tick: 0,
      eventId: ev(899),
      transfers: [{ from: acct(w.homes[1] as string), to: vault(), unit: GRAIN, amount: 1234 }],
    });
    w.t.set(BANDS, b0.org.id, { ...b0, looted: 1234 });
    const leader = b0.org.positions[0]?.holder as AgentId;
    const death = ev(900);
    w.t.set(ENTITY, leader, {
      id: leader,
      originEventId: ev(1),
      createdAt: 0,
      endedAt: DAY,
      endEventId: death,
    } as never);
    const before = total(w);
    const events = step(w, 1, opts(options), seed);
    const b = bandIn(w) as Band;
    expect(events.find((e) => e.kind === "band.leader_succeeded")?.causes).toEqual([
      { kind: "event", event: death },
    ]);
    expect(b.org.status).toBe("active");
    expect(b.org.positions[0]?.holder).not.toBe(leader);
    expect(w.t.get(PERSON, b.org.positions[0]?.holder as AgentId)).toBeDefined();
    expect(b.org.members.find((m) => m.agent === leader)?.exitEventId).toBe(death);
    expect(total(w)).toBe(before);
    expect(w.ledger.balance(vault(), GRAIN)).toBe(1234);
    expect(w.ledger.audit()).toEqual([]);
    expect(bandViolations(b, w.ledger.balance(vault(), GRAIN))).toEqual([]);
  });

  it("si cae el cabecilla se disuelve, el tesoro vuelve a los hogares y la causa es su muerte", () => {
    const { w, seed } = born({ rules: { raidEveryDays: 1, captureChance: 0 } });
    for (let d = 1; d <= 12; d++)
      step(w, d, opts({ rules: { raidEveryDays: 1, captureChance: 0 } }), seed);
    const b0 = bandIn(w) as Band;
    const leader = b0.org.positions[0]?.holder as AgentId;
    const death = ev(900);
    w.t.set(ENTITY, leader, {
      id: leader,
      originEventId: ev(1),
      createdAt: 0,
      endedAt: 120,
      endEventId: death,
    } as never);
    const before = total(w);
    const evs = step(w, 13, opts({ rules: { raidEveryDays: 1, captureChance: 0 } }), seed);
    const d = evs.find((e) => e.kind === "band.dissolved");
    expect(d?.data["reason"]).toBe("leader_fell");
    expect(d?.causes).toEqual([{ kind: "event", event: death }]);
    const b = bandIn(w) as Band;
    expect(b.org.status).toBe("dissolved");
    expect(w.ledger.balance(vault(), GRAIN)).toBe(0);
    expect(total(w)).toBe(before);
    expect(w.ledger.audit()).toEqual([]);
    expect(bandViolations(b, 0)).toEqual([]);
  });

  it("cuando la hambruna termina y pasa la paz, la gente vuelve a casa", () => {
    const { w, seed } = born();
    w.t.setRaw(FAMINE.name, S, {
      state: "none",
      value: 0,
      since: 3,
      pricePush: 1,
      migrationPull: 0,
    });
    let reason: unknown;
    for (let d = 1; d <= 60 && reason === undefined; d++)
      reason = step(w, d, opts(), seed).find((e) => e.kind === "band.dissolved")?.data["reason"];
    expect(["famine_over", "starved", "too_few", "leader_fell"]).toContain(reason);
    expect(bandIn(w)?.org.status).toBe("dissolved");
    expect(w.ledger.balance(vault(), GRAIN)).toBe(0);
    expect(w.ledger.audit()).toEqual([]);
  });

  it("después de disolverse espera antes de que nazca otra, y luego puede volver a nacer", () => {
    const { w, seed } = born({ rules: { dissolveUnfedDays: 1, raidEveryDays: 1000 } });
    const o = opts({ rules: { dissolveUnfedDays: 1, raidEveryDays: 1000, rebirthDays: 30 } });
    let d = 1;
    for (; d <= 40 && bandIn(w)?.org.status !== "dissolved"; d++) step(w, d, o, seed);
    expect(bandIn(w)?.org.status).toBe("dissolved");
    for (let k = 0; k < 5; k++) step(w, d + k, o, seed);
    expect(bandRows(w.t).filter((r) => r.band.org.status === "active")).toHaveLength(0);
  });

  it("determinista y con las reglas del mundo, para cualquier seed y composición", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.array(fc.integer({ min: 14, max: 70 }), { minLength: 5, maxLength: 5 }),
        (seed, ages) => {
          const run = () => {
            nid = 0;
            const w = setup(ages);
            const log: string[] = [];
            for (let d = 0; d <= 50; d++)
              for (const e of step(w, d, opts(), seed))
                log.push(`${e.kind}:${JSON.stringify(e.data)}`);
            for (const r of bandRows(w.t))
              expect(bandViolations(r.band, w.ledger.balance(acct(r.id), GRAIN))).toEqual([]);
            expect(w.ledger.audit()).toEqual([]);
            expect(total(w)).toBe(1_800_000);
            return JSON.stringify([log, bandRows(w.t)]);
          };
          expect(run()).toBe(run());
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe("life.bandits: en la vida", () => {
  const lifeWith = (on: boolean) => {
    const life = Life.create(3, content, {
      famine: { staple: "grain", horizonDays: 100000 },
      ...(on ? { bandits: {} } : {}),
    });
    life.advanceTo(life.now + 86400 * 40);
    return life;
  };

  it("bandits exige famine", () => {
    expect(() => Life.create(3, content, { bandits: {} })).toThrow(/famine/);
  });

  it("encendido es determinista, con el ledger limpio e invariantes del mundo", () => {
    const a = lifeWith(true);
    expect(a.hash().total).toBe(lifeWith(true).hash().total);
    const { truth, log, ledger } = a.world;
    expect(ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth, log })).toEqual([]);
    for (const id of truth.ids(BANDS)) {
      const b = truth.get(BANDS, id) as Band;
      expect(
        bandViolations(b, ledger.balance(holderAccount(id as unknown as HolderRef), GRAIN)),
      ).toEqual([]);
    }
    for (const e of log.all().filter((x) => x.kind.startsWith("band.")))
      expect(e.causes.length).toBeGreaterThan(0);
  });

  it("sin `bandits` no hay tabla ni eventos", () => {
    const life = lifeWith(false);
    expect(life.world.truth.ids(BANDS)).toHaveLength(0);
    expect(life.world.log.all().some((e) => e.kind.startsWith("band."))).toBe(false);
  });
});
