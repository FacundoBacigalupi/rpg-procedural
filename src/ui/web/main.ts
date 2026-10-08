// Punto de entrada de la web local: `npm run web -- [mismos argumentos que la CLI] [--port 5173]`.
// Abre la vida de `--save` (o empieza una) y la sirve en http://127.0.0.1:<port>.

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { GAME_CONTENT_KINDS } from "../../game/index.ts";
import { LifeStore, loadContentDir, openSqlite } from "../../persistence/index.ts";
import { LIFE_ARG_OPTIONS, lifeConfig } from "../config.ts";
import { openSession } from "../session.ts";
import { startWeb } from "./server.ts";

const { values } = parseArgs({
  options: { ...LIFE_ARG_OPTIONS, port: { type: "string", default: "5173" } },
});
const config = lifeConfig(values);
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error(`puerto inválido: ${values.port}`);

mkdirSync(dirname(config.save), { recursive: true });
const db = openSqlite(config.save);
const session = await openSession(LifeStore.open(db), {
  seed: config.seed,
  content: loadContentDir("content", GAME_CONTENT_KINDS),
  llm: config.llm,
  setup: config.setup,
});
const web = await startWeb(session, {
  port,
  clientRoot: resolve(import.meta.dirname, "client"),
});
process.stdout.write(
  `La vida está en http://127.0.0.1:${web.port} (Ctrl+C para guardar y salir)\n`,
);
process.on("SIGINT", () => {
  void web.close().finally(() => {
    db.close();
    process.exit(0);
  });
});
