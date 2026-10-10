import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  externalAccount,
  type HolderRef,
  holderAccount,
  loadContent,
  type Tick,
} from "../../core/index.ts";
import {
  checkInvariants,
  ENTITY,
  PERSON,
  type ReadonlyWorldTruth,
  ROTTED,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { NPC_DECISION } from "./decide.ts";
import { Life } from "./life.ts";
import { COMMITMENTS } from "./loans.ts";
import { MOLD_RUMORS } from "./moldgossip.ts";
import { householdsOf } from "./spoilage.ts";

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

const membersOf = (truth: ReadonlyWorldTruth, home: string): AgentId[] =>
  truth
    .ids(PERSON)
    .filter(
      (id) =>
        truth.get(PERSON, id)?.household === home && truth.get(ENTITY, id)?.endedAt === undefined,
    )
    .sort() as AgentId[];

const acct = (h: string) => holderAccount(h as unknown as HolderRef);

/** Una casa ajena al jugador con la despensa vacía; con `ruin`, todos los vecinos la creen en la ruina (rumor). */
function starved(ruin: boolean) {
  const life = Life.create(1, content, { creditHeed: { broke: 0 } });
  const w = life.world;
  const mine = w.truth.get(PERSON, life.player)?.household;
  const homes = householdsOf(w.truth).map((h) => h as unknown as string);
  const home = homes.find((h) => h !== mine) as string;
  const first = w.log.all()[0];
  if (!first) throw new Error("sin eventos");
  const rows = w.ledger.holdings(acct(home)).filter((h) => h.amount > 0);
  w.ledger.post({
    tick: first.tick,
    eventId: first.id,
    transfers: rows.map((h) => ({
      unit: h.unit,
      from: acct(home),
      to: externalAccount(ROTTED),
      amount: h.amount,
    })),
  });
  if (ruin) {
    for (const h of homes) {
      if (h === home) continue;
      for (const p of membersOf(w.truth, h)) {
        w.truth.set(MOLD_RUMORS, p, {
          items: [
            {
              rumor: { mold: "attr", about: home, attr: "standing", value: "broke" },
              confidence: 1,
              hops: 0,
              heardAt: first.tick,
              teller: null,
            },
          ],
          told: [],
        });
      }
    }
  }
  return { life, w, home };
}

describe("fiado con creditHeed (Life real)", () => {
  it("sin creer en la ruina el vecino fía; creyéndola, no", () => {
    const calm = starved(false);
    calm.life.advanceTo((calm.life.now + 40 * calm.w.clock.day) as Tick);
    const asked = (s: typeof calm) =>
      s.w.log
        .all()
        .filter(
          (e) =>
            e.kind === "household.borrowed" && (e.data as { to?: string } | null)?.to === s.home,
        );
    expect(asked(calm).length).toBeGreaterThan(0);

    const ruined = starved(true);
    ruined.life.advanceTo((ruined.life.now + 40 * ruined.w.clock.day) as Tick);
    expect(asked(ruined)).toEqual([]);
    expect(ruined.w.ledger.audit()).toEqual([]);
  }, 400_000);
});

describe("empeño por decisión de punta a punta (Life real)", () => {
  it("pawn_decide -> action.give pawn -> pawn_open en el mismo tick, con asiento conservado", () => {
    const life = Life.create(1, content, {
      moldHintsFromCatalog: true,
      pawn: {
        unit: "coin:copper",
        lots: new Map(),
        open: { prices: { "good:tools": 30 }, advance: 0.5, rate: 0.1, termDays: 10 },
        want: {
          minDistress: 0.3,
          weight: 1,
          cash: "moneda de cobre",
          minValue: 10,
          valueOf: (u) => (u === "good:tools" ? 30 : undefined),
        },
      },
    });
    const w = life.world;
    const [a, b] = membersOf(w.truth, householdsOf(w.truth)[0] as never).filter(
      (p) => p !== life.player,
    ) as AgentId[];
    const other = householdsOf(w.truth)
      .flatMap((h) => membersOf(w.truth, h))
      .find((p) => p !== life.player && p !== a) as AgentId;
    const broker = (b ?? other) as AgentId;
    expect(a).toBeDefined();
    const first = w.log.all()[0];
    if (!first) throw new Error("sin eventos");
    const post = (to: AgentId, unit: string, amount: number) =>
      w.ledger.post({
        tick: first.tick,
        eventId: first.id,
        transfers: [
          { unit: unit as never, from: externalAccount("seed" as never), to: acct(to), amount },
        ],
      });
    post(a as AgentId, "good:tools", 2);
    post(broker, "coin:copper", 1000);
    const coinBefore = w.ledger.balance(acct(a as string), "coin:copper" as never);
    // El NPC ya decidió empeñarle las herramientas a quien cree con efectivo.
    w.truth.set(
      NPC_DECISION,
      a as AgentId,
      {
        at: life.now,
        id: `give:${broker}+pawn:herramientas de hierro`,
        verb: "give",
        target: broker,
        utility: 1,
        options: 2,
      } as never,
    );
    life.advanceTo((life.now + 3600) as Tick);
    life.advanceTo((life.now + 3600) as Tick);

    const give = w.log
      .all()
      .find((e) => e.kind === "action.give" && (e.data as { decided?: boolean } | null)?.decided);
    expect(give).toBeDefined();
    const opened = w.log.all().find((e) => e.kind === "credit.pawn_opened");
    expect(opened).toBeDefined();
    expect(opened?.tick).toBe(give?.tick);
    expect(opened?.causes.some((c) => c.kind === "event" && c.event === give?.id)).toBe(true);
    expect(w.ledger.balance(acct(broker), "good:tools" as never)).toBe(2);
    expect(w.ledger.balance(acct(a as string), "coin:copper" as never)).toBeGreaterThan(coinBefore);
    expect(w.truth.ids(COMMITMENTS).length).toBeGreaterThan(0);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants(w)).toEqual([]);
  }, 240_000);
});
