// Punto de entrada de la CLI: `npm run dev -- [--seed N] [--mode realista|novela]
// [--frequency N] [--save archivo]`.
// Sin `--save` la vida va a `saves/vida.sqlite`; si ese archivo ya tiene una, se sigue esa.

import { randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { defaultGameSetup, GAME_CONTENT_KINDS, type GameMode } from "../../game/index.ts";
import { LifeStore, loadContentDir, openSqlite } from "../../persistence/index.ts";
import { runCli } from "./loop.ts";

const { values } = parseArgs({
  options: {
    seed: { type: "string" },
    mode: { type: "string", default: "realista" },
    frequency: { type: "string" },
    save: { type: "string", default: "saves/vida.sqlite" },
  },
});

const seed = values.seed === undefined ? randomInt(0, 0xffffffff) : Number(values.seed);
const frequency = values.frequency === undefined ? undefined : Number(values.frequency);
if (!Number.isSafeInteger(seed) || seed < 0) throw new Error(`seed inválido: ${values.seed}`);
const modes: Readonly<Record<string, GameMode>> = { realista: "realistic", novela: "novel" };
const mode = modes[values.mode];
if (!mode) throw new Error(`modo inválido: ${values.mode} (realista o novela)`);

mkdirSync(dirname(values.save), { recursive: true });
const db = openSqlite(values.save);
const rl = createInterface({ input: process.stdin, terminal: false });
try {
  await runCli(rl, (t) => process.stdout.write(t), LifeStore.open(db), {
    seed,
    content: loadContentDir("content", GAME_CONTENT_KINDS),
    setup: { game: defaultGameSetup(mode), ...(frequency === undefined ? {} : { frequency }) },
  });
} finally {
  rl.close();
  db.close();
}
