// Tragar píldoras (novel2-pills-take): con cultivo, `consume` gasta una píldora del libro mayor y
// `life.meditate` la aplica. La de reunir da qi hasta llenar el recipiente (lo demás se escapa al
// lugar); la de romper deja una ayuda que sube la preparación del próximo intento y se gasta en él.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EventId,
  externalAccount,
  HOUR,
  type HolderRef,
  holderAccount,
  ledgerUnit,
  loadContent,
} from "../../core/index.ts";
import {
  type ActionPlan,
  BODY_STATE,
  BREAKTHROUGH_EVENT,
  CULTIVATION_LAW,
  CULTIVATION_STATE,
  PILL_TAKEN_EVENT,
  TALENT,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { playerView } from "./view.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

const plan = (me: AgentId, root: ActionPlan["root"]): ActionPlan => ({
  actor: me,
  source: "player",
  root,
  manner: [],
  causes: [{ kind: "state", entity: me, key: "intent" }],
});

const swallow = (me: AgentId, what: string): ActionPlan =>
  plan(me, { kind: "do", verb: "consume", args: [{ role: "what", text: what }], manner: [] });

const doFor = (me: AgentId, verb: string, hours: number): ActionPlan =>
  plan(me, { kind: "do", verb, args: [{ role: "for", seconds: hours * HOUR }], manner: [] });

describe("tragar píldoras (novel2-pills-take)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  /** Una vida con cultivo, el jugador con raíz, sintiendo el qi y `n` píldoras de `good` encima. */
  const setup = (good: string, n: number, qiShare: number, stage = 0) => {
    const life = Life.create(3, content, { cultivation: true });
    const w = life.world;
    const me = life.player;
    const plane = w.truth.ids(CULTIVATION_LAW)[0];
    const law = plane ? w.truth.get(CULTIVATION_LAW, plane) : undefined;
    const threshold = law?.paths[0]?.thresholds[stage];
    const t = w.truth.get(TALENT, me);
    if (!threshold || !t) throw new Error("sin ley o sin talento");
    w.truth.set(TALENT, me, {
      ...t,
      innate: { ...t.innate, spirit_root: 3, root_wood: 3, comprehension: 0.7 },
    });
    const first = w.log.all()[0];
    if (!first) throw new Error("sin eventos");
    w.truth.set(CULTIVATION_STATE, me, {
      sensitivity: 2,
      hours: 500,
      sensed: { at: life.now, event: first.id as EventId },
      stage,
      qi: Math.round(threshold.capacity * qiShare),
      purity: 0.5,
      foundation: 1,
    });
    w.ledger.post({
      tick: first.tick,
      eventId: first.id,
      transfers: [
        {
          unit: ledgerUnit(`good:${good}`),
          from: externalAccount("seed"),
          to: holderAccount(me as unknown as HolderRef),
          amount: n,
        },
      ],
    });
    return { life, w, me, capacity: threshold.capacity };
  };

  const held = (w: Life["world"], me: AgentId, good: string) =>
    w.ledger.balance(holderAccount(me as unknown as HolderRef), ledgerUnit(`good:${good}`));

  it("la de reunir llena el recipiente y lo que sobra se escapa", () => {
    const { life, w, me, capacity } = setup("pill-qi-gathering", 2, 0.5);
    const before = w.truth.get(CULTIVATION_STATE, me);
    const from = life.now;
    life.turn(swallow(me, "píldora de reunir qi"), 1);
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("pill_qi");
    expect(held(w, me, "pill-qi-gathering")).toBe(1);
    const took = w.log.all().find((e) => e.kind === PILL_TAKEN_EVENT);
    expect(took?.data).toMatchObject({ pill: "qi-gathering", effect: "gather", taken: 20 });
    // La causa es el consumo.
    const consumed = w.log.all().find((e) => e.kind === "action.consume");
    expect(took?.causes).toContainEqual({ kind: "event", event: consumed?.id });
    const after = w.truth.get(CULTIVATION_STATE, me);
    expect(after?.qi).toBe((before?.qi ?? 0) + 20);
    // Pureza entre la de antes (0,5) y la de la píldora (0,7).
    expect(after?.purity).toBeGreaterThan(0.5);
    expect(after?.purity).toBeLessThan(0.7);

    // Casi lleno: lo que no cabe se escapa.
    const full = setup("pill-spirit-gathering", 1, 0.95);
    full.life.turn(swallow(full.me, "píldora de reunir espíritu"), 1);
    const spill = full.w.log.all().find((e) => e.kind === PILL_TAKEN_EVENT)?.data as {
      taken: number;
      spilled: number;
    };
    expect(spill.taken + spill.spilled).toBe(120);
    expect(spill.spilled).toBeGreaterThan(0);
    expect(full.w.truth.get(CULTIVATION_STATE, full.me)?.qi).toBe(full.capacity);
  }, 600_000);

  it("la de romper deja una ayuda que sube la preparación y se gasta al intentar", () => {
    const rompe = (pill: boolean) => {
      const s = setup("pill-foundation", 1, 1);
      if (pill) {
        const from = s.life.now;
        s.life.turn(swallow(s.me, "píldora de fundamento"), 1);
        expect(s.w.truth.get(CULTIVATION_STATE, s.me)?.aid?.pill).toBe("foundation");
        expect(playerView(s.w, [], { heardSince: from }).self.cues).toContain("pill_aid");
      }
      const body = s.w.truth.get(BODY_STATE, s.me);
      s.life.turn(doFor(s.me, "breakthrough", 1), 2);
      for (let i = 3; i < 14 && !s.w.log.all().some((e) => e.kind === BREAKTHROUGH_EVENT); i++) {
        if (body) s.w.truth.set(BODY_STATE, s.me, body);
        s.life.turn(doFor(s.me, "wait", 1), i);
      }
      const b = s.w.log.all().find((e) => e.kind === BREAKTHROUGH_EVENT);
      if (!b) throw new Error("no rompió");
      expect(s.w.truth.get(CULTIVATION_STATE, s.me)?.aid).toBeUndefined();
      return b.data as { prep: number; aid?: string };
    };
    const plain = rompe(false);
    const aided = rompe(true);
    expect(aided.aid).toBe("foundation");
    expect(plain.aid).toBeUndefined();
    expect(aided.prep).toBeGreaterThan(plain.prep);
  }, 600_000);
});
