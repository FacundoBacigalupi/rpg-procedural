// Punto de entrada de la CLI: `npm run dev -- [--seed N] [--mode realista|novela]
// [--sex mujer|hombre] [--age N] [--familia terrateniente|campesina|sirviente] (modo novela)
// [--frequency N] [--save archivo] [--llm modelo [--runtime ollama] [--llm-url URL] [--think]]`.
// Sin `--save` la vida va a `saves/vida.sqlite`; si ese archivo ya tiene una, se sigue esa.
// Con `--llm`, un modelo local lee y narra (con la gramática y las plantillas de respaldo si no
// contesta); sin él, todo va sin red.

import { randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import {
  defaultGameSetup,
  GAME_CONTENT_KINDS,
  type GameMode,
  type GameSetup,
  parseGameSetup,
} from "../../game/index.ts";
import {
  LlmConfig,
  LlmJobs,
  type LlmProvider,
  LOCAL_BASE_URLS,
  offlineLlmConfig,
  openAiClientFactory,
} from "../../llm/index.ts";
import { LifeStore, loadContentDir, openSqlite } from "../../persistence/index.ts";
import { runCli } from "./loop.ts";

const { values } = parseArgs({
  options: {
    seed: { type: "string" },
    mode: { type: "string", default: "realista" },
    frequency: { type: "string" },
    sex: { type: "string" },
    age: { type: "string" },
    familia: { type: "string" },
    save: { type: "string", default: "saves/vida.sqlite" },
    llm: { type: "string" },
    runtime: { type: "string", default: "ollama" },
    "llm-url": { type: "string" },
    think: { type: "boolean", default: false },
  },
});

const seed = values.seed === undefined ? randomInt(0, 0xffffffff) : Number(values.seed);
const frequency = values.frequency === undefined ? undefined : Number(values.frequency);
if (!Number.isSafeInteger(seed) || seed < 0) throw new Error(`seed inválido: ${values.seed}`);
const modes: Readonly<Record<string, GameMode>> = { realista: "realistic", novela: "novel" };
const mode = modes[values.mode];
if (!mode) throw new Error(`modo inválido: ${values.mode} (realista o novela)`);

/** El personaje que se pide en modo novela (game-modes §2.1); en el realista no se elige nada. */
function gameSetup(): GameSetup {
  const asked = values.sex ?? values.age ?? values.familia;
  if (asked === undefined) return defaultGameSetup(mode as GameMode);
  if (mode !== "novel") throw new Error("elegir al personaje es del modo novela (--mode novela)");
  const sexes: Record<string, "female" | "male"> = { mujer: "female", hombre: "male" };
  const positions: Record<string, "holder" | "common" | "dependent"> = {
    terrateniente: "holder",
    campesina: "common",
    sirviente: "dependent",
  };
  const sex = values.sex === undefined ? undefined : sexes[values.sex];
  const position = values.familia === undefined ? undefined : positions[values.familia];
  if (values.sex !== undefined && !sex) throw new Error(`--sex: mujer u hombre (${values.sex})`);
  if (values.familia !== undefined && !position) {
    throw new Error(`--familia: terrateniente, campesina o sirviente (${values.familia})`);
  }
  const base = defaultGameSetup("novel");
  return parseGameSetup({
    ...base,
    novel: {
      ...base.novel,
      character: {
        ...(sex ? { sex } : {}),
        ...(values.age === undefined ? {} : { entryAge: Number(values.age) }),
        ...(position ? { family: { position } } : {}),
      },
    },
  });
}

const runtime = values.runtime as keyof typeof LOCAL_BASE_URLS;
if (!(runtime in LOCAL_BASE_URLS)) throw new Error(`runtime desconocido: ${values.runtime}`);

/** Un modelo local residente para el parser y el narrador, con las plantillas detrás. */
function llmJobs(model: string): LlmJobs {
  const local: LlmProvider = {
    kind: "local",
    runtime,
    model,
    grammar: true,
    ...(values.think ? { think: true } : {}),
    ...(values["llm-url"] ? { baseUrl: values["llm-url"] } : {}),
  };
  const chain = [local, { kind: "templates" } as const];
  const config = LlmConfig.parse({
    ...offlineLlmConfig(),
    jobs: { ...offlineLlmConfig().jobs, parser: chain, narrator: chain },
  });
  return new LlmJobs({ config, clientFor: openAiClientFactory({ timeoutMs: 60_000 }) });
}

mkdirSync(dirname(values.save), { recursive: true });
const db = openSqlite(values.save);
const rl = createInterface({ input: process.stdin, terminal: false });
try {
  await runCli(rl, (t) => process.stdout.write(t), LifeStore.open(db), {
    seed,
    content: loadContentDir("content", GAME_CONTENT_KINDS),
    llm: values.llm === undefined ? undefined : llmJobs(values.llm),
    setup: { game: gameSetup(), ...(frequency === undefined ? {} : { frequency }) },
  });
} finally {
  rl.close();
  db.close();
}
