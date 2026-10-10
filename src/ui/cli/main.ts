// Punto de entrada de la CLI: `npm run dev -- [--seed N] [--mode realista|novela]
// [--sex mujer|hombre] [--age N] [--familia terrateniente|campesina|sirviente] (modo novela)
// [--frequency N] [--save archivo] [--llm modelo [--runtime ollama] [--llm-url URL] [--think]] [--famine] [--nickname]`.
// Sin `--save` la vida va a `saves/vida.sqlite`; si ese archivo ya tiene una, se sigue esa.
// Con `--llm`, un modelo local lee y narra (con la gramática y las plantillas de respaldo si no
// contesta); sin él, todo va sin red.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { GAME_CONTENT_KINDS } from "../../game/index.ts";
import { LifeStore, loadContentDir, openSqlite } from "../../persistence/index.ts";
import { LIFE_ARG_OPTIONS, lifeConfig } from "../config.ts";
import { runCli } from "./loop.ts";

const { values } = parseArgs({ options: LIFE_ARG_OPTIONS });
const config = lifeConfig(values);

mkdirSync(dirname(config.save), { recursive: true });
const db = openSqlite(config.save);
const rl = createInterface({ input: process.stdin, terminal: false });
try {
  await runCli(rl, (t) => process.stdout.write(t), LifeStore.open(db), {
    seed: config.seed,
    content: loadContentDir("content", GAME_CONTENT_KINDS),
    llm: config.llm,
    nickname: config.nickname,
    setup: config.setup,
  });
} finally {
  rl.close();
  db.close();
}
