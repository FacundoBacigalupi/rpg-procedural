import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EventId,
  type HolderRef,
  holderAccount,
  loadContent,
} from "../../core/index.ts";
import {
  BODY_STATE,
  type BuildingRecord,
  CORE_NORMAL_C,
  EMOTIONS,
  goodUnit,
  LOCATION,
  type Percept,
  THERMAL,
  unitGrams,
  VILLAGE_SQUARE,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import {
  dangerOf,
  dayPhase,
  hudPanel,
  LOAD_BANDS,
  loadOf,
  MAX_SEEN_BUILDINGS,
  moonPhaseName,
  nightSky,
  seenBuildings,
  warmthOf,
} from "./hud.ts";
import { Life } from "./life.ts";
import { characterPanel, inventoryPanel } from "./panels.ts";
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
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

describe("la barra de arriba (hudPanel)", () => {
  it("el momento del día sigue los crepúsculos de daylight", () => {
    expect([0, 5, 6.9, 7, 16.9, 17, 18.9, 19, 23].map(dayPhase)).toEqual([
      "night",
      "dawn",
      "dawn",
      "day",
      "day",
      "dusk",
      "dusk",
      "night",
      "night",
    ]);
  });

  it("sale de la escena percibida y del panel, sin tocar el mundo", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    let seen: readonly Percept[] = [];
    playerView(w, [], { intro: true, onSeen: (p) => (seen = p) });
    const before = [w.scheduler.now, w.log.all().length];
    const character = characterPanel(w);
    const hud = hudPanel(w, character, inventoryPanel(w).coins, seen);
    expect([w.scheduler.now, w.log.all().length]).toEqual(before);
    expect(hud.people.around).toBe(seen.length);
    expect(hud.people.known).toBeLessThanOrEqual(hud.people.around);
    expect(hud.place.home).toBe(character.where.home);
    // Bajo techo el cielo no se ve: solo se oye si llueve o nieva.
    if (hud.place.indoor) expect(["unknown", "rain", "snow"]).toContain(hud.sky);
    expect(hudPanel(w, character, 0, [])).toMatchObject({ people: { around: 0, known: 0 } });
    // Cada silueta lleva solo lo que leyó la mirada: sin figura leída, ni edad ni sexo.
    expect(hud.people.figures).toHaveLength(seen.length);
    seen.forEach((p, i) => {
      const f = hud.people.figures[i];
      expect(f?.known).toBe(p.detail === "identified");
      if (p.fields.figure === undefined) expect(f?.age).toBeUndefined();
      else expect(f?.age).toBe((p.fields.figure.value as { age: string }).age);
    });
    // La aldea por defecto no simula fuegos: no se sabe si hay uno encendido.
    expect(hud.place.fire).toBeUndefined();
  });

  it("el frío o el calor sale del núcleo, en bandas; sin fila, normal", () => {
    expect([undefined, 34, 36, 37, 38, 39.5].map(warmthOf)).toEqual([
      "normal",
      "freezing",
      "cold",
      "normal",
      "hot",
      "burning",
    ]);
  });

  it("el ánimo es la emoción propia que todavía dura y se apaga con el tiempo", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const character = characterPanel(w);
    expect(hudPanel(w, character, 0, []).mood).toEqual({
      feeling: null,
      strength: 0,
      burden: null,
    });
    w.truth.set(EMOTIONS, w.player, {
      signals: [
        {
          owner: w.player,
          emotion: "sadness",
          intensity: 0.9,
          originEventId: "e:test" as EventId,
          at: w.scheduler.now,
          appraisalTheme: "loss",
        },
        {
          owner: w.player,
          emotion: "joy",
          intensity: 0.3,
          originEventId: "e:test" as EventId,
          at: w.scheduler.now,
          appraisalTheme: "success",
        },
      ],
    });
    w.truth.set(THERMAL, w.player, { coreC: CORE_NORMAL_C - 1, at: w.scheduler.now });
    const hud = hudPanel(w, character, 0, []);
    expect(hud.mood).toMatchObject({ feeling: "sadness", strength: 2 });
    expect(hud.warmth).toBe("cold");
    // Una semana después la tristeza ya no se nota.
    const old = w.scheduler.now - 7 * 24 * 3600;
    const signals = w.truth.get(EMOTIONS, w.player)?.signals ?? [];
    w.truth.set(EMOTIONS, w.player, { signals: signals.map((x) => ({ ...x, at: old })) });
    expect(hudPanel(w, character, 0, []).mood.feeling).toBeNull();
  });

  it("la fase de la luna en ocho tramos, con la llena en el medio", () => {
    expect([0, 0.06, 0.13, 0.25, 0.4, 0.5, 0.6, 0.75, 0.88, 0.95].map(moonPhaseName)).toEqual([
      "new",
      "new",
      "waxing_crescent",
      "first_quarter",
      "waxing_gibbous",
      "full",
      "waning_gibbous",
      "last_quarter",
      "waning_crescent",
      "new",
    ]);
  });

  it("la luna y las estrellas solo se ven afuera, con el cielo abierto y la luna arriba", () => {
    const full = { phase: 0.5, illumination: 1, altitude: 1 };
    const night = { indoor: false, sky: "clear", phase: "night" } as const;
    expect(nightSky(night, full)).toEqual({ moon: { phase: "full", high: true }, stars: "few" });
    expect(nightSky(night, { ...full, altitude: 0.2 }).moon).toEqual({
      phase: "full",
      high: false,
    });
    // Bajo el horizonte no está; sin luna (o nueva), el cielo despejado se llena de estrellas.
    expect(nightSky(night, { ...full, altitude: -0.1 })).toEqual({ moon: null, stars: "many" });
    expect(nightSky(night, { phase: 0, illumination: 0, altitude: 1 })).toEqual({
      moon: null,
      stars: "many",
    });
    expect(nightSky(night, null)).toEqual({ moon: null, stars: "many" });
    // Una luna fina no apaga las estrellas.
    expect(nightSky(night, { phase: 0.15, illumination: 0.2, altitude: 1 }).stars).toBe("many");
    // Con nubes, algunas; nublado, lloviendo o bajo techo, nada.
    expect(nightSky({ ...night, sky: "cloudy" }, null).stars).toBe("few");
    for (const look of [
      { ...night, sky: "overcast" },
      { ...night, sky: "rain" },
      { ...night, indoor: true },
    ] as const)
      expect(nightSky(look, full)).toEqual({ moon: null, stars: "none" });
    // De día la luna puede estar arriba; las estrellas no.
    expect(nightSky({ ...night, phase: "day" }, full)).toEqual({
      moon: { phase: "full", high: true },
      stars: "none",
    });
  });
});

describe("edificios en el fondo", () => {
  const building = (x: number, y: number, extra: Partial<BuildingRecord> = {}): BuildingRecord =>
    ({
      type: "cottage",
      at: { x, y },
      graph: { spaces: [], edges: [], entrance: "e", door: "doorway" },
      components: [
        {
          part: "walls",
          area: 30,
          materials: [
            { material: "clay", grams: 900, origin: "e:x" },
            { material: "timber", grams: 100, origin: "e:x" },
          ],
          condition: 0.1,
          quality: 0.5,
          defects: [],
        },
        {
          part: "roof",
          area: 30,
          materials: [{ material: "thatch", grams: 300, origin: "e:x" }],
          condition: 0.7,
          quality: 0.5,
          defects: [],
        },
      ],
      ...extra,
    }) as unknown as BuildingRecord;

  it("ve los cercanos a la luz que hay, de oeste a este, con material, desgaste, ruina y fuego", () => {
    const rows = [
      { id: "b:1", b: building(40, 0) },
      { id: "b:2", b: building(-60, 10, { type: "granary" }) },
      { id: "b:3", b: building(0, 300) },
      {
        id: "b:4",
        b: building(10, -20, {
          ruin: { cause: "fire", rebuild: "same" },
          fire: { intensity: 0.5 } as NonNullable<BuildingRecord["fire"]>,
        }),
      },
    ];
    const seen = seenBuildings(rows, { x: 0, y: 0 }, 250);
    expect(seen.map((b) => b.x)).toEqual([-60, 10, 40]);
    expect(seen[0]).toMatchObject({ type: "granary", wall: "clay", roof: "thatch", worn: 2 });
    expect(seen[1]).toMatchObject({ ruin: true, burning: true, d: 20 });
    // De noche, solo lo que está encima; el propio no se cuenta.
    expect(seenBuildings(rows, { x: 0, y: 0 }, 30).map((b) => b.x)).toEqual([10]);
    expect(seenBuildings(rows, { x: 0, y: 0 }, 30, "b:4")).toEqual([]);
  });

  it("en la vida: adentro sabe en qué edificio está; en la plaza ve los de alrededor", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const at = w.truth.get(LOCATION, w.player);
    const character = characterPanel(w);
    const hud = hudPanel(w, character, 0, []);
    if (hud.place.indoor) expect(hud.place.building?.type).toBeTruthy();
    if (!at) return;
    w.truth.set(LOCATION, w.player, { ...at, space: VILLAGE_SQUARE });
    const out = hudPanel(w, characterPanel(w), 0, []);
    expect(out.place.indoor).toBe(false);
    expect(out.place.building).toBeUndefined();
    expect(Array.isArray(out.place.buildings)).toBe(true);
    expect(out.place.buildings?.length ?? 0).toBeLessThanOrEqual(MAX_SEEN_BUILDINGS);
  });
});

describe("peligro en la barra", () => {
  const percept = (
    id: string,
    fields: Percept["fields"],
    detail: Percept["detail"] = "clear",
  ): Percept =>
    ({
      id,
      observer: "agent:yo",
      tick: 0,
      channels: ["sight"],
      detail,
      fields,
    }) as unknown as Percept;
  const read = (value: unknown, confidence = 1) => ({ value, confidence, mistaken: false });
  const risk = (a: string) => (a === "action.kill" ? 0.7 : a === "action.hit" ? 0.3 : 0);

  it("sin nadie, o con gente tranquila, no hay peligro", () => {
    expect(dangerOf([], () => 1, risk)).toEqual({ level: 0, from: 0 });
    const calm = percept("p1", { presence: read(true), action: read("action.give") });
    expect(dangerOf([calm], () => 0, risk)).toEqual({ level: 0, from: 0 });
  });

  it("lo que lee que hace un desconocido asusta por la apuesta del verbo y la confianza", () => {
    const kill = percept("p1", { action: read("action.kill") });
    expect(dangerOf([kill], () => 0, risk).level).toBe(3);
    const blurry = percept("p1", { action: read("action.kill", 0.5) });
    expect(dangerOf([blurry], () => 0, risk).level).toBe(1);
    const hit = percept("p2", { action: read("action.hit") });
    expect(dangerOf([hit], () => 0, risk)).toEqual({ level: 1, from: 1 });
  });

  it("a quien reconoce lo teme por lo que cree de él, no por quién es de verdad", () => {
    const feared = percept(
      "p1",
      { identity: read("agent:malo"), action: read("action.give") },
      "identified",
    );
    const threat = (who: AgentId) => ((who as string) === "agent:malo" ? 0.6 : 0);
    expect(dangerOf([feared], threat, risk)).toEqual({ level: 2, from: 1 });
    // El mismo conocido en dos percepts cuenta una vez; una cara que lee mal no asusta como tal.
    const again = percept("p2", { identity: read("agent:malo") }, "identified");
    expect(dangerOf([feared, again], threat, risk).from).toBe(1);
    const unsure = percept("p3", { identity: read("agent:malo", 0.3) }, "identified");
    expect(dangerOf([unsure], threat, risk).level).toBe(0);
  });

  it("la barra lee el catálogo: ver pelear es amenaza; un recado, nada", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const character = characterPanel(w);
    expect(hudPanel(w, character, 0, []).danger).toEqual({ level: 0, from: 0 });
    const strike = [percept("p1", { action: read("action.strike") })];
    expect(hudPanel(w, character, 0, strike).danger).toEqual({ level: 2, from: 1 });
    const work = [percept("p1", { action: read("action.work") })];
    expect(hudPanel(w, character, 0, work).danger.level).toBe(0);
  });
});

describe("la carga en la barra (play-hud-load)", () => {
  it("una moneda pesa por pieza; un bien ya está en gramos", () => {
    const goods = Life.create(7, content, { frequency: 8 }).world.goods;
    expect(unitGrams(goods, goodUnit({ id: "grain", form: "good" }), 500)).toBe(500);
    expect(unitGrams(goods, goodUnit({ id: "copper", form: "coin" }), 10)).toBeCloseTo(37);
  });

  it("sube por bandas sobre el peso del cuerpo con lo que lleva encima", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const massKg = w.truth.get(BODY_STATE, w.player)?.massKg ?? 0;
    expect(massKg).toBeGreaterThan(0);
    const mine = holderAccount(w.player as unknown as HolderRef);
    // Se le pasa de a poco el bien que más tiene otro (una casa con su granero).
    const richest = w.ledger
      .balances()
      .filter(
        (r) => r.account !== mine && r.unit.startsWith("good:") && !r.account.startsWith("ext:"),
      )
      .sort((a, b) => b.amount - a.amount)[0];
    if (richest === undefined) throw new Error("nadie tiene bienes");
    let evn = 900_000;
    const give = (g: number) =>
      w.ledger.post({
        tick: 0,
        eventId: `event:${++evn}` as EventId,
        transfers: [{ from: richest.account, to: mine, unit: richest.unit, amount: g }],
      });
    const carried = () =>
      w.ledger
        .holdings(mine)
        .reduce((n, h) => n + (h.amount > 0 ? unitGrams(w.goods, h.unit, h.amount) : 0), 0);
    const band = () => LOAD_BANDS.filter((b) => carried() / 1000 / massKg >= b).length;
    expect(loadOf(w)).toBe(band());
    const toward = (fraction: number) => {
      const missing = Math.ceil(fraction * massKg * 1000 - carried());
      if (missing > 0) give(Math.min(missing, w.ledger.balance(richest.account, richest.unit)));
    };
    toward(0.3);
    expect(loadOf(w)).toBe(band());
    expect(hudPanel(w, characterPanel(w), 0, []).load).toBe(loadOf(w));
    toward(0.5);
    expect(loadOf(w)).toBe(band());
    if (carried() / 1000 / massKg >= 0.45) expect(loadOf(w)).toBe(3);
  });
});
