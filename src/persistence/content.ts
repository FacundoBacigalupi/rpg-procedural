// El lector de `content/` (tooling §11): recorre las carpetas, parsea cada `.json` y se lo pasa a
// `loadContent` de `core/schema`, que valida. La carpeta es el tipo (`content/herbs/x.json` es
// del tipo `herbs`; `content/families/xianxia/realms/a.json`, de `families/xianxia/realms`): el
// tipo es la carpeta más profunda que esté registrada. Los `.md` se ignoran.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  type Content,
  ContentError,
  type ContentKind,
  type ContentSource,
  compareStrings,
  loadContent,
} from "../core/index.ts";

/** Lee y valida `root` entero. Tira `ContentError` con todos los problemas juntos. */
export function loadContentDir(root: string, kinds: readonly ContentKind[]): Content {
  const { sources, problems } = readContentDir(
    root,
    kinds.map((k) => k.name),
  );
  if (problems.length > 0) {
    // Los errores de lectura van primero; igual se valida lo que se pudo leer.
    try {
      loadContent(kinds, sources);
    } catch (e) {
      if (e instanceof ContentError) throw new ContentError([...problems, ...e.problems]);
      throw e;
    }
    throw new ContentError(problems);
  }
  return loadContent(kinds, sources);
}

/** Los `.json` de `root`, en orden, con su tipo; los que no parsean van a `problems`. */
export function readContentDir(
  root: string,
  kindNames: readonly string[],
): { sources: ContentSource[]; problems: string[] } {
  const known = new Set(kindNames);
  const sources: ContentSource[] = [];
  const problems: string[] = [];
  const files = (readdirSync(root, { recursive: true, encoding: "utf8" }) as string[])
    .map((f) => f.split(sep).join("/"))
    .filter((f) => f.endsWith(".json"))
    .sort(compareStrings);
  for (const file of files) {
    const dirs = file.split("/").slice(0, -1);
    let kind = dirs.join("/");
    for (let n = dirs.length; n > 0; n--) {
      const candidate = dirs.slice(0, n).join("/");
      if (known.has(candidate)) {
        kind = candidate;
        break;
      }
    }
    const shown = relative(".", join(root, file)).split(sep).join("/");
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(join(root, file), "utf8"));
    } catch (e) {
      problems.push(`${shown}: JSON inválido (${(e as Error).message})`);
      continue;
    }
    sources.push({ kind: kind === "" ? "(raíz)" : kind, file: shown, data });
  }
  return { sources, problems };
}
