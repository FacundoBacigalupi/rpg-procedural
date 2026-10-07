// Punto de entrada de la CLI: `npm run dev -- [--seed N] [--villagers N] [--save archivo]`.
// Sin `--save` la vida va a `saves/vida.sqlite`; si ese archivo ya tiene una, se sigue esa.

import { randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { LifeStore, openSqlite } from "../../persistence/index.ts";
import { runCli } from "./loop.ts";

const { values } = parseArgs({
  options: {
    seed: { type: "string" },
    villagers: { type: "string", default: "6" },
    save: { type: "string", default: "saves/vida.sqlite" },
  },
});

const seed = values.seed === undefined ? randomInt(0, 0xffffffff) : Number(values.seed);
const villagers = Number(values.villagers);
if (!Number.isSafeInteger(seed) || seed < 0) throw new Error(`seed inválido: ${values.seed}`);

mkdirSync(dirname(values.save), { recursive: true });
const db = openSqlite(values.save);
const rl = createInterface({ input: process.stdin, terminal: false });
try {
  await runCli(rl, (t) => process.stdout.write(t), LifeStore.open(db), {
    seed,
    setup: { villagers },
  });
} finally {
  rl.close();
  db.close();
}
