// Punto de entrada de la web local: `npm run web -- [mismos argumentos que la CLI] [--port 5173]`.
// Abre la vida de `--save` y la sirve en http://127.0.0.1:<port>. Si el guardado no tiene vida, la
// web muestra la pantalla de inicio (familia del mundo, modo, seed, personaje) con lo que vino por
// argumentos ya elegido, y la vida empieza al confirmar.

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { GAME_CONTENT_KINDS, WORLD_FAMILIES } from "../../game/index.ts";
import { LifeStore, loadContentDir, openSqlite } from "../../persistence/index.ts";
import { LIFE_ARG_OPTIONS, type LifeConfig, lifeConfig } from "../config.ts";
import { openSession } from "../session.ts";
import type { SetupInfo } from "./api.ts";
import { startWeb } from "./server.ts";
import { NOVEL_FAMILIES, NOVEL_SEXES, setupHandler, startedHandler } from "./setup.ts";

const { values } = parseArgs({
  options: { ...LIFE_ARG_OPTIONS, port: { type: "string", default: "5173" } },
});
const config = lifeConfig(values);
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error(`puerto inválido: ${values.port}`);

mkdirSync(dirname(config.save), { recursive: true });
const db = openSqlite(config.save);
const store = LifeStore.open(db);
const content = loadContentDir("content", GAME_CONTENT_KINDS);
const open = (c: LifeConfig) =>
  openSession(store, {
    seed: c.seed,
    content,
    llm: c.llm,
    nickname: c.nickname,
    epilogue: c.epilogue,
    setup: c.setup,
  });

const info: SetupInfo = {
  families: WORLD_FAMILIES,
  modes: ["realista", "novela"],
  sexes: NOVEL_SEXES,
  familias: NOVEL_FAMILIES,
  defaults: {
    world: values.world ?? WORLD_FAMILIES[0] ?? "xianxia",
    mode: values.mode === "novela" ? "novela" : "realista",
    ...(values.seed !== undefined ? { seed: config.seed } : {}),
  },
};
const fresh = store.getMeta("seed") === undefined;
const api = fresh
  ? setupHandler(info, (choice) => {
      process.stdout.write("Generando el mundo…\n");
      return open(
        lifeConfig({
          ...values,
          world: choice.world,
          mode: choice.mode,
          seed: choice.seed === undefined ? undefined : String(choice.seed),
          sex: choice.sex,
          familia: choice.familia,
          age: choice.age === undefined ? undefined : String(choice.age),
        }),
      );
    })
  : startedHandler(await open(config), info);
const web = await startWeb(api, {
  port,
  clientRoot: resolve(import.meta.dirname, "client"),
});
process.stdout.write(
  fresh
    ? `Elegí el mundo en http://127.0.0.1:${web.port} (Ctrl+C para salir)\n`
    : `La vida está en http://127.0.0.1:${web.port} (Ctrl+C para guardar y salir)\n`,
);
process.on("SIGINT", () => {
  void web.close().finally(() => {
    db.close();
    process.exit(0);
  });
});
