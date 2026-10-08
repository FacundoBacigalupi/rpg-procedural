import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import {
  defaultGameSetup,
  GAME_CONTENT_KINDS,
  type GameMode,
  LIFE_ENGINE,
  type LifeSetup,
  lifeReplayGame,
} from "../../game/index.ts";
import {
  type LlmConfig,
  LlmError,
  LlmJobs,
  type LlmProvider,
  MockLLM,
  offlineLlmConfig,
} from "../../llm/index.ts";
import { LifeStore, openSqlite, type SqlDriver } from "../../persistence/index.ts";
import { checkInvariants, hashState } from "../../sim/index.ts";
import { type ReplayInput, replay, replayInputFromStore } from "../../tools/index.ts";
import { elapsed, plain } from "../render.ts";
import { runCli, VERSIONS } from "./loop.ts";

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

async function* feed(lines: readonly string[]) {
  for (const l of lines) yield l;
}

const opened: SqlDriver[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

function memory(): LifeStore {
  const db = openSqlite(":memory:");
  opened.push(db);
  return LifeStore.open(db);
}

async function session(
  store: LifeStore,
  lines: readonly string[],
  seed = 5,
  mode: GameMode = "realistic",
  llm?: LlmJobs,
): Promise<string> {
  let out = "";
  const setup: LifeSetup = { game: defaultGameSetup(mode) };
  await runCli(feed(lines), (t) => (out += t), store, { seed, setup, content, llm });
  return out;
}

/** Un modelo (de mentira) para el parser y el narrador, con las plantillas detrás. */
function jobsWith(client: MockLLM): LlmJobs {
  const local: LlmProvider = { kind: "local", runtime: "ollama", model: "mock" };
  const chain = [local, { kind: "templates" } as const];
  const base = offlineLlmConfig();
  const config: LlmConfig = { ...base, jobs: { ...base.jobs, parser: chain, narrator: chain } };
  return new LlmJobs({ config, clientFor: (p) => (p.kind === "local" ? client : undefined) });
}

const SCRIPT = ["miro alrededor", "espero dos horas", "volar", "ayuda", "", "como", "descanso"];
const PLANS = 4;

describe("runCli", () => {
  it("juega, guarda cada turno y el replay llega al mismo estado", async () => {
    const store = memory();
    const out = await session(store, [...SCRIPT, "salir", "espero"]);
    expect(out).toMatch(/^Empieza una vida en modo realista\./);
    expect(out).toContain("Eso todavía no se entiende.");
    expect(out).toContain(
      "Fuera del personaje (no pasa el tiempo): personaje, inventario, hipótesis, bitácora, pensar sobre X, ayuda, salir.",
    );
    expect(out).toMatch(/La vida queda guardada\.\n$/);
    expect(out).not.toContain("{{");

    // Lo que no es un plan no se guarda; lo de después de salir no se lee.
    expect(store.plans()).toHaveLength(PLANS);
    expect(checkInvariants(store.load())).toEqual([]);

    const { input, checkpoints } = replayInputFromStore(store);
    expect(checkpoints).toHaveLength(PLANS);
    const end = store.load().scheduler.now;
    const report = replay(
      input as ReplayInput<LifeSetup, never>,
      lifeReplayGame(content, VERSIONS) as never,
      { checkpoints, until: end },
    );
    expect(report.divergence).toBeUndefined();
    expect(report.checked).toBe(PLANS);
    expect(report.hash).toEqual(hashState(store.load()));
  }, 300_000);

  it("al volver sigue la misma vida, y da lo mismo que jugar de un tirón", async () => {
    const split = memory();
    await session(split, [...SCRIPT.slice(0, 2), "salir"]);
    const back = await session(split, SCRIPT.slice(2), 999);
    expect(back).toMatch(/^Seguís donde quedaste\./);

    const straight = memory();
    await session(straight, SCRIPT);
    expect(split.load().scheduler).toEqual(straight.load().scheduler);
    expect(split.plans()).toEqual(straight.plans());
    expect(split.checkpoints()).toEqual(straight.checkpoints());
  }, 300_000);

  it("los paneles no pasan el tiempo y la bitácora guarda lo narrado", async () => {
    const store = memory();
    const out = await session(store, ["personaje", "inventario", "espero una hora", "bitácora"]);
    expect(out).toContain("Tenés ");
    expect(out).toContain("En la despensa:");
    expect(store.plans()).toHaveLength(1);
    const journal = store.narrations();
    expect(journal).toHaveLength(2);
    expect(out).toContain(journal[1]?.text as string);
    // Al volver no se repite la escena inicial en la bitácora.
    await session(store, ["salir"]);
    expect(store.narrations()).toHaveLength(2);
  }, 300_000);

  it("el inspector no pasa el tiempo, no toca el estado y marca la vida", async () => {
    const store = memory();
    expect(store.getMeta("inspected")).toBeUndefined();
    const out = await session(store, ["inspector tables", "god invariants"]);
    expect(out).toContain("body.state");
    expect(out).toContain("Sin violaciones.");
    expect(store.plans()).toHaveLength(0);
    expect(store.getMeta("inspected")).toBe(true);
  }, 300_000);

  it("guarda el modo y no lo cambia a mitad de la vida", async () => {
    const store = memory();
    const out = await session(store, ["miro", "salir"], 5, "novel");
    expect(out).toMatch(/^Empieza una vida en modo novela\./);
    expect(store.getMeta("mode")).toBe("novel");
    expect((store.getMeta("setup") as LifeSetup).game.mode).toBe("novel");

    const back = await session(store, ["salir"], 5, "realistic");
    expect(back).toContain("Esta vida es en modo novela: el modo no se cambia");
    expect(store.getMeta("mode")).toBe("novel");
  }, 300_000);

  it("no sigue una vida de otra versión", async () => {
    const store = memory();
    await session(store, ["salir"]);
    store.setMeta("versions", { ...VERSIONS, engine: `${LIFE_ENGINE}-viejo` });
    await expect(session(store, [])).rejects.toThrow(/otra versión/);
  }, 300_000);
});

describe("runCli con el modelo", () => {
  const WAIT = JSON.stringify({
    kind: "act",
    plan: {
      kind: "do",
      verb: "wait",
      args: [{ role: "for", duration: { amount: 2, unit: "hour" } }],
    },
  });

  it("el parser usa al modelo; si el narrador no valida, narran las plantillas", async () => {
    // La gramática no entiende «aguardo un par de horitas»: solo el modelo lo lee como esperar.
    const model = new MockLLM((req) =>
      req.schema ? WAIT : "Texto sin ninguna referencia marcada.",
    );
    const store = memory();
    const out = await session(
      store,
      ["aguardo un par de horitas", "salir"],
      5,
      "realistic",
      jobsWith(model),
    );
    expect(out).toContain("Pasan 2 horas.");
    expect(out).not.toContain("Eso todavía no se entiende");
    expect(out).not.toContain("Texto sin ninguna referencia");
    expect(store.plans()).toHaveLength(1);
    // El pedido del parser lleva la escena que ya vio el jugador y el texto de este turno.
    const parse = model.calls.find((c) => c.schema);
    expect(parse?.messages.at(-1)?.content).toContain("Player: aguardo un par de horitas");
    expect(parse?.messages.at(-1)?.content).toContain("What the character perceives:");
  }, 300_000);

  it("con el modelo caído, la gramática y las plantillas dan el mismo turno que sin red", async () => {
    const down = new MockLLM(() => new LlmError("network", "fetch failed"));
    const withModel = memory();
    const offline = memory();
    const lines = ["espero dos horas", "como", "salir"];
    const a = await session(withModel, lines, 5, "realistic", jobsWith(down));
    const b = await session(offline, lines);
    expect(a).toEqual(b);
    expect(withModel.checkpoints()).toEqual(offline.checkpoints());
  }, 300_000);
});

describe("render", () => {
  it.each([
    [60, "Pasa un minuto."],
    [3600, "Pasa una hora."],
    [7200 + 60, "Pasan 2 horas y un minuto."],
    [86400 * 3 + 3600, "Pasan 3 días y una hora."],
    [30, "No pasa nada de tiempo."],
  ])("%i segundos: %s", (s, text) => {
    expect(elapsed(s)).toBe(text);
  });

  it("plain deja el texto de las marcas", () => {
    expect(plain("Ves a {{e1|tu madre}} y {{e2|un hombre}}.")).toBe("Ves a tu madre y un hombre.");
  });
});
