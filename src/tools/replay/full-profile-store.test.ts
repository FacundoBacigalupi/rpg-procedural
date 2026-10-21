// Almacenamiento y adaptación reales; solo la creación de mundos se reemplaza por un doble.
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventLog, Ledger, loadContent } from "../../core/index.ts";
import {
  defaultGameSetup,
  FULL_PROFILE,
  LIFE_ENGINE,
  Life,
  lifeReplayGame,
  optionsOf,
} from "../../game/index.ts";
import { LifeStore, openSqlite } from "../../persistence/index.ts";
import { hashState, WorldTruth } from "../../sim/index.ts";
import { replay, replayInputFromStore } from "./index.ts";

describe("perfil completo guardado y entregado al replay sin crear mundos", () => {
  afterEach(() => vi.restoreAllMocks());
  const content = loadContent([], []);
  const setup = { game: defaultGameSetup("realistic"), life: FULL_PROFILE };
  const versions = { engine: LIFE_ENGINE, content: content.hash, format: 1 };
  const emptyState = (tick: number) => ({
    truth: new WorldTruth(),
    log: new EventLog(),
    ledger: new Ledger({ externals: {} }),
    ids: {},
    scheduler: { now: tick, seq: 0, queue: [] },
  });
  const fakeLife = (state: ReturnType<typeof emptyState>) =>
    ({
      advanceTo: vi.fn(),
      submit: vi.fn(),
      hash: () => hashState(state),
    }) as unknown as Life;

  it("SQLite conserva todos los flags y el adaptador los entrega a Life.create", () => {
    const db = openSqlite(":memory:");
    try {
      const store = LifeStore.open(db);
      store.setMeta("seed", 7);
      store.setMeta("versions", versions);
      store.setMeta("setup", setup);
      const { input } = replayInputFromStore(store);
      // Comprueba la frontera JSON real de SQLite, no una referencia a FULL_PROFILE.
      expect(input.setup).toEqual(setup);
      expect(input.setup).not.toBe(setup);
      const create = vi.spyOn(Life, "create").mockReturnValue(fakeLife(emptyState(0)));
      replay(input, lifeReplayGame(content, versions), { until: 0 });
      expect(create).toHaveBeenCalledOnce();
      expect(create.mock.calls[0]?.[0]).toBe(7);
      expect(create.mock.calls[0]?.[2]).toEqual(optionsOf(setup));
      expect(create.mock.calls[0]?.[2]).toMatchObject(FULL_PROFILE);
    } finally {
      db.close();
    }
  });

  it("el límite de motor retoma con el perfil almacenado y el ancla sin regenerar el mundo", () => {
    const db = openSqlite(":memory:");
    try {
      const store = LifeStore.open(db);
      const state = emptyState(3600);
      const anchor = { marker: "saved-anchor" };
      store.setMeta("seed", 7);
      store.setMeta("versions", versions);
      store.setMeta("setup", setup);
      store.setMeta("anchor", anchor);
      store.saveSnapshot(state);
      store.setMeta("replayLimits", [
        { tick: 3600, from: { ...versions, engine: "life-1" }, to: versions },
      ]);
      const { input, checkpoints } = replayInputFromStore(store);
      const create = vi.spyOn(Life, "create").mockImplementation(() => {
        throw new Error("no debe regenerar el mundo");
      });
      const resume = vi.spyOn(Life, "resume").mockReturnValue(fakeLife(state));
      const result = replay(input, lifeReplayGame(content, versions), { checkpoints, until: 3600 });
      expect(result.divergence).toBeUndefined();
      expect(result.checked).toBe(1);
      expect(create).not.toHaveBeenCalled();
      expect(resume).toHaveBeenCalledOnce();
      expect(resume.mock.calls[0]?.[3]).toMatchObject(FULL_PROFILE);
      expect(resume.mock.calls[0]?.[4]).toEqual(anchor);
    } finally {
      db.close();
    }
  });
});

describe("itemClaims guardado y entregado al replay (opt-in, fuera del perfil)", () => {
  afterEach(() => vi.restoreAllMocks());
  const content = loadContent([], []);
  const setup = { game: defaultGameSetup("realistic"), life: { itemClaims: true } };
  const versions = { engine: LIFE_ENGINE, content: content.hash, format: 1 };

  it("no está en el perfil completo y SQLite lo conserva hasta Life.create", () => {
    expect(FULL_PROFILE).not.toHaveProperty("itemClaims");
    const db = openSqlite(":memory:");
    try {
      const store = LifeStore.open(db);
      store.setMeta("seed", 7);
      store.setMeta("versions", versions);
      store.setMeta("setup", setup);
      const { input } = replayInputFromStore(store);
      expect(input.setup).toEqual(setup);
      const life = {
        advanceTo: vi.fn(),
        submit: vi.fn(),
        hash: () => "",
      } as unknown as Life;
      const create = vi.spyOn(Life, "create").mockReturnValue(life);
      replay(input, lifeReplayGame(content, versions), { until: 0 });
      expect(create.mock.calls[0]?.[2]).toEqual(optionsOf(setup));
      expect(create.mock.calls[0]?.[2]).toMatchObject({ itemClaims: true });
    } finally {
      db.close();
    }
  });
});
