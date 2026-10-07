// Punto de entrada de la CLI: `npm run dev -- [--seed N] [--mode realista|novela]
// [--villagers N] [--save archivo]`.
// Sin `--save` la vida va a `saves/vida.sqlite`; si ese archivo ya tiene una, se sigue esa.

import { randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { defaultGameSetup, type GameMode } from "../../game/index.ts";
import { LifeStore, openSqlite } from "../../persistence/index.ts";
import { runCli } from "./loop.ts";

const { values } = parseArgs({
  options: {
    seed: { type: "string" },
    mode: { type: "string", default: "realista" },
    villagers: { type: "string", default: "6" },
    save: { type: "string", default: "saves/vida.sqlite" },
  },
});

const seed = values.seed === undefined ? randomInt(0, 0xffffffff) : Number(values.seed);
const villagers = Number(values.villagers);
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
    setup: { villagers, game: defaultGameSetup(mode) },
  });
} finally {
  rl.close();
  db.close();
}
