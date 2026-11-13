import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EntityRef,
  type EventId,
  HOUR,
  loadContent,
} from "../../core/index.ts";
import {
  type ActionPlan,
  BODY_STATE,
  BREAKTHROUGH_EVENT,
  CULTIVATION_LAW,
  CULTIVATION_STATE,
  ENTITY,
  guardShare,
  HEAVEN_LAW,
  LOCATION,
  MASTER_OF,
  MEMORIES,
  PERSON,
  QI_TAKEN,
  SECT,
  TALENT,
  TRIBULATION,
  TRIBULATION_GATHERS_EVENT,
  TRIBULATION_STRIKES_EVENT,
  TRIBULATION_WAVE_EVENT,
  tribulationDue,
  WAVES,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { playerView } from "./view.ts";
import { NPC_PERCEPTS } from "./witnessing.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

const doFor = (me: AgentId, verb: string, hours: number): ActionPlan => ({
  actor: me,
  source: "player",
  root: { kind: "do", verb, args: [{ role: "for", seconds: hours * HOUR }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: me, key: "intent" }],
});

/** Un turno con el cuerpo como al empezar: acá se mira el cultivo, no el hambre. */
function freshTurn(life: Life, plan: ActionPlan, seq: number): void {
  const body = life.world.truth.get(BODY_STATE, life.player);
  life.turn(plan, seq);
  if (body) life.world.truth.set(BODY_STATE, life.player, body);
}

describe("la tribulación se junta y cae en olas (novel2-trib-gather, novel2-trib-waves)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  it("un umbral que ofende al Cielo: nubes con qi de la reserva, y la ruptura se resuelve al caer", () => {
    const life = Life.create(3, content, { cultivation: true });
    const w = life.world;
    const me = life.player;
    const plane = w.truth.ids(CULTIVATION_LAW)[0];
    const law = plane ? w.truth.get(CULTIVATION_LAW, plane) : undefined;
    const heaven = plane ? w.truth.get(HEAVEN_LAW, plane) : undefined;
    if (!plane || !law || !heaven) throw new Error("sin ley o sin Cielo");
    const ts = law.paths[0]?.thresholds ?? [];
    // El último umbral siempre llama tribulación; el primero nunca.
    const stage = ts.length - 1;
    const threshold = ts[stage];
    if (!threshold) throw new Error("sin umbral");
    expect(tribulationDue(heaven, threshold.transgression)).toBe(true);
    const t = w.truth.get(TALENT, me);
    if (!t) throw new Error("sin talento");
    w.truth.set(TALENT, me, {
      ...t,
      innate: { ...t.innate, spirit_root: 3, root_wood: 3, comprehension: 0.7 },
    });
    const sensedBy = w.log.all()[0]?.id as EventId;
    w.truth.set(CULTIVATION_STATE, me, {
      sensitivity: 2,
      hours: 500,
      sensed: { at: life.now, event: sensedBy },
      stage,
      qi: threshold.capacity,
      purity: 1,
      foundation: 1,
    });
    w.truth.set(QI_TAKEN, plane, { taken: 0, drawn: 0, at: life.now });
    let seq = 1;
    const from = life.now;
    freshTurn(life, doFor(me, "breakthrough", 1), seq++);

    // Se juntan las nubes: la ruptura no se resolvió, el Cielo sacó energía de la reserva.
    const gathered = w.log.all().filter((e) => e.kind === TRIBULATION_GATHERS_EVENT);
    expect(gathered).toHaveLength(1);
    const g = gathered[0];
    if (!g) throw new Error("sin nubes");
    expect(g.actors).toEqual([me]);
    expect((g.emissions as { sight?: number }).sight).toBe(1);
    const cause = g.causes.find((c) => c.kind === "event");
    expect(cause?.kind === "event" ? w.log.get(cause.event)?.kind : undefined).toBe(
      "action.breakthrough",
    );
    const row = w.truth.get(TRIBULATION, me);
    expect(row?.threshold).toBe(threshold.id);
    expect(row?.energy).toBeGreaterThan(0);
    expect(row?.strikeAt).toBeGreaterThan(g.tick);
    expect(w.truth.get(QI_TAKEN, plane)?.taken).toBeCloseTo(row?.energy ?? -1, 3);
    expect(w.log.all().some((e) => e.kind === BREAKTHROUGH_EVENT)).toBe(false);
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("tribulation_gathers");

    // Otro intento mientras tanto no agrega nubes.
    freshTurn(life, doFor(me, "breakthrough", 1), seq++);
    expect(w.log.all().filter((e) => e.kind === TRIBULATION_GATHERS_EVENT)).toHaveLength(1);

    // Esperar a que caiga (sin restaurar el cuerpo: las olas hieren).
    const energy = row?.energy ?? 0;
    const beforeStrike = life.now;
    const woundsBefore = w.truth.get(BODY_STATE, me)?.wounds.length ?? 0;
    const meridianBefore = w.truth.get(CULTIVATION_STATE, me)?.meridianDamage ?? 0;
    for (let i = 0; i < 8 && w.truth.get(TRIBULATION, me); i++) {
      life.turn(doFor(me, "wait", 1), seq++);
    }
    const strikes = w.log.all().filter((e) => e.kind === TRIBULATION_STRIKES_EVENT);
    expect(strikes).toHaveLength(1);
    const s = strikes[0];
    expect(s?.tick).toBe(row?.strikeAt);
    expect((s?.emissions as { sight?: number } | undefined)?.sight).toBe(1);
    expect(w.truth.get(TRIBULATION, me)).toBeUndefined();
    // Las olas: tantas como dijo la fila, cada una causada por la caída, a la vista; hieren el cuerpo
    // y los meridianos.
    const waves = w.log.all().filter((e) => e.kind === TRIBULATION_WAVE_EVENT);
    expect(waves).toHaveLength(row?.waves ?? -1);
    expect(row?.waves).toBeGreaterThanOrEqual(WAVES[0]);
    for (const wave of waves) {
      const wc = wave.causes.find((c) => c.kind === "event");
      expect(wc?.kind === "event" ? wc.event : undefined).toBe(s?.id);
      expect((wave.data as { force: number }).force).toBeGreaterThan(0);
    }
    expect(w.truth.get(BODY_STATE, me)?.wounds.length ?? 0).toBe(woundsBefore + waves.length);
    expect(w.truth.get(CULTIVATION_STATE, me)?.meridianDamage ?? 0).toBeGreaterThan(meridianBefore);
    const breaks = w.log.all().filter((e) => e.kind === BREAKTHROUGH_EVENT);
    expect(breaks).toHaveLength(1);
    const bc = breaks[0]?.causes.find((c) => c.kind === "event");
    expect(bc?.kind === "event" ? bc.event : undefined).toBe(s?.id);
    // La energía volvió a la reserva (lo que queda debitado es menos que lo que se juntó).
    expect(w.truth.get(QI_TAKEN, plane)?.taken ?? 0).toBeLessThan(energy);
    const cues = playerView(w, [], { heardSince: beforeStrike }).self.cues;
    expect(cues).toContain("tribulation_strikes");
    expect(cues.some((c) => c.startsWith("break_"))).toBe(true);
  }, 600_000);

  it("con su maestro al lado, él carga parte de cada ola y se lleva su herida (novel2-master-guard)", () => {
    const life = Life.create(3, content, { cultivation: true });
    const w = life.world;
    const me = life.player;
    const plane = w.truth.ids(CULTIVATION_LAW)[0];
    const law = plane ? w.truth.get(CULTIVATION_LAW, plane) : undefined;
    if (!plane || !law) throw new Error("sin ley");
    const ts = law.paths[0]?.thresholds ?? [];
    const stage = ts.length - 1;
    const threshold = ts[stage];
    if (!threshold) throw new Error("sin umbral");
    const sensedBy = w.log.all()[0]?.id as EventId;
    w.truth.set(CULTIVATION_STATE, me, {
      sensitivity: 2,
      hours: 500,
      sensed: { at: life.now, event: sensedBy },
      stage,
      qi: threshold.capacity,
      purity: 1,
      foundation: 1,
    });
    // El maestro: alguien vivo, dos tramos más arriba, al lado.
    const home = w.truth.get(PERSON, me)?.household;
    const master = w.truth
      .ids(PERSON)
      .find(
        (id) =>
          id !== me &&
          w.truth.get(PERSON, id)?.household !== home &&
          w.truth.get(ENTITY, id)?.endedAt === undefined &&
          w.truth.has(BODY_STATE, id),
      ) as AgentId;
    w.truth.set(CULTIVATION_STATE, master, {
      sensitivity: 2,
      hours: 900,
      sensed: { at: life.now, event: sensedBy },
      stage: stage + 2,
      qi: threshold.capacity,
      purity: 1,
      foundation: 1,
    });
    const org = w.truth.ids(SECT)[0] as EntityRef;
    w.truth.set(MASTER_OF, me, { master, org, since: life.now });
    const keepNear = () => {
      const here = w.truth.get(LOCATION, me);
      if (here) w.truth.set(LOCATION, master, here);
    };
    keepNear();
    w.truth.set(QI_TAKEN, plane, { taken: 0, drawn: 0, at: life.now });
    let seq = 1;
    freshTurn(life, doFor(me, "breakthrough", 1), seq++);
    expect(w.truth.get(TRIBULATION, me)).toBeDefined();
    const masterWounds = w.truth.get(BODY_STATE, master)?.wounds.length ?? 0;
    for (let i = 0; i < 8 && w.truth.get(TRIBULATION, me); i++) {
      keepNear();
      life.turn(doFor(me, "wait", 1), seq++);
    }
    const waves = w.log.all().filter((e) => e.kind === TRIBULATION_WAVE_EVENT);
    expect(waves.length).toBeGreaterThan(0);
    const share = guardShare({ present: true, masterStage: stage + 2, discipleStage: stage });
    for (const wave of waves) {
      const guard = (wave.data as { guard?: { by: AgentId; share: number; force: number } }).guard;
      expect(guard?.by).toBe(master);
      expect(guard?.share).toBe(share);
      expect(guard?.force ?? 0).toBeGreaterThan(0);
      expect(wave.causes).toContainEqual({ kind: "state", entity: me, key: MASTER_OF.name });
    }
    // El riesgo se comparte: el maestro se lleva una herida por ola.
    expect(w.truth.get(BODY_STATE, master)?.wounds.length ?? 0).toBe(masterWounds + waves.length);
    expect(w.truth.get(CULTIVATION_STATE, master)?.meridianDamage ?? 0).toBeGreaterThan(0);
  }, 600_000);

  it("quien la ve caer la recuerda con quién fue (novel2-trib-seen)", () => {
    const life = Life.create(3, content, { cultivation: true });
    const w = life.world;
    const me = life.player;
    const plane = w.truth.ids(CULTIVATION_LAW)[0];
    const law = plane ? w.truth.get(CULTIVATION_LAW, plane) : undefined;
    const ts = law?.paths[0]?.thresholds ?? [];
    const last = ts[ts.length - 1];
    if (!plane || !last) throw new Error("sin ley");
    w.truth.set(CULTIVATION_STATE, me, {
      sensitivity: 2,
      hours: 500,
      sensed: { at: life.now, event: w.log.all()[0]?.id as EventId },
      stage: ts.length - 1,
      qi: last.capacity,
      purity: 1,
      foundation: 1,
    });
    let seq = 1;
    freshTurn(life, doFor(me, "breakthrough", 1), seq++);
    // Un vecino despierto al lado, cada hora, hasta que cae.
    const witness = [...w.truth.ids(PERSON)]
      .sort()
      .find((id) => id !== me && !w.truth.get(ENTITY, id)?.endedAt) as AgentId | undefined;
    if (!witness) throw new Error("sin vecinos");
    for (let i = 0; i < 8 && w.truth.get(TRIBULATION, me); i++) {
      const at = w.truth.get(LOCATION, me);
      if (at) w.truth.set(LOCATION, witness, at);
      const b = w.truth.get(BODY_STATE, witness);
      if (b) w.truth.set(BODY_STATE, witness, { ...b, activity: "idle" });
      life.turn(doFor(me, "wait", 1), seq++);
    }
    const strike = w.log.all().find((e) => e.kind === TRIBULATION_STRIKES_EVENT);
    if (!strike) throw new Error("no cayó");
    const mem = w.truth.get(MEMORIES, witness)?.items.find((m) => m.eventId === strike.id);
    expect(mem).toBeDefined();
    expect(mem?.source).toBe("witnessed");
    expect(mem?.valence).toBeLessThan(0);
  }, 600_000);

  it("las nubes se ven desde otro hex, vago y sin quién (novel2-trib-far-sight)", () => {
    const life = Life.create(3, content, { cultivation: true });
    const w = life.world;
    const me = life.player;
    expect(w.map.kmPerHex).toBeGreaterThan(0);
    const plane = w.truth.ids(CULTIVATION_LAW)[0];
    const law = plane ? w.truth.get(CULTIVATION_LAW, plane) : undefined;
    const ts = law?.paths[0]?.thresholds ?? [];
    const last = ts[ts.length - 1];
    if (!plane || !last) throw new Error("sin ley");
    w.truth.set(CULTIVATION_STATE, me, {
      sensitivity: 2,
      hours: 500,
      sensed: { at: life.now, event: w.log.all()[0]?.id as EventId },
      stage: ts.length - 1,
      qi: last.capacity,
      purity: 1,
      foundation: 1,
    });
    // El personaje sale a un hex vecino: los de la aldea quedan a un hex.
    const here = w.truth.get(LOCATION, me);
    if (!here) throw new Error("sin lugar");
    const next = (w.map.neighbors[here.hex] ?? [])[0];
    if (next === undefined) throw new Error("sin vecino de hex");
    w.truth.set(LOCATION, me, { hex: next });
    freshTurn(life, doFor(me, "breakthrough", 1), 1);
    const gathers = w.log.all().find((e) => e.kind === TRIBULATION_GATHERS_EVENT);
    if (!gathers) throw new Error("no se juntaron nubes");
    const far = [...w.truth.ids(NPC_PERCEPTS)].flatMap((id) =>
      w.truth.get(LOCATION, id as AgentId)?.hex === next
        ? []
        : (w.truth.get(NPC_PERCEPTS, id)?.recent ?? []).filter(
            (p) => p.sourceEventId === gathers.id,
          ),
    );
    expect(far.length).toBeGreaterThan(0);
    for (const seen of far) {
      expect(seen.detail).toBe("vague");
      expect(seen.fields.action?.value).toBe(TRIBULATION_GATHERS_EVENT);
      expect(seen.fields.identity).toBeUndefined();
    }
  }, 600_000);

  it("el primer umbral no llama tribulación: la ruptura se resuelve en el acto", () => {
    const life = Life.create(3, content, { cultivation: true });
    const w = life.world;
    const me = life.player;
    const plane = w.truth.ids(CULTIVATION_LAW)[0];
    const law = plane ? w.truth.get(CULTIVATION_LAW, plane) : undefined;
    const first = law?.paths[0]?.thresholds[0];
    if (!first) throw new Error("sin umbral");
    w.truth.set(CULTIVATION_STATE, me, {
      sensitivity: 2,
      hours: 50,
      sensed: { at: life.now, event: w.log.all()[0]?.id as EventId },
      qi: first.capacity,
      purity: 1,
    });
    freshTurn(life, doFor(me, "breakthrough", 1), 1);
    expect(w.log.all().some((e) => e.kind === TRIBULATION_GATHERS_EVENT)).toBe(false);
    expect(w.log.all().some((e) => e.kind === BREAKTHROUGH_EVENT)).toBe(true);
  }, 600_000);

  it("es determinista: la misma tribulación da el mismo hash", () => {
    const run = () => {
      const life = Life.create(3, content, { cultivation: true });
      const w = life.world;
      const plane = w.truth.ids(CULTIVATION_LAW)[0];
      if (!plane) throw new Error("sin ley");
      const law = w.truth.get(CULTIVATION_LAW, plane);
      const ts = law?.paths[0]?.thresholds ?? [];
      const last = ts[ts.length - 1];
      w.truth.set(CULTIVATION_STATE, life.player, {
        sensitivity: 2,
        hours: 500,
        sensed: { at: life.now, event: w.log.all()[0]?.id as EventId },
        stage: ts.length - 1,
        qi: last?.capacity ?? 0,
        purity: 1,
      });
      freshTurn(life, doFor(life.player, "breakthrough", 1), 1);
      for (let i = 2; i < 9; i++) freshTurn(life, doFor(life.player, "wait", 1), i);
      return life.hash().total;
    };
    expect(run()).toBe(run());
  }, 600_000);
});
