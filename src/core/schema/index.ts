// Carga validada de `content/` (tooling §11, ARCHITECTURE §7.6). Puro: recibe lo que el lector
// de archivos (en `persistence/`) ya parseó y devuelve el catálogo o todos los errores juntos.
//
// Cada tipo de contenido es una carpeta de `content/` con un esquema de Zod 4, que es la fuente
// del tipo (`z.infer`), y una función que dice a qué otras entradas se refiere: una referencia
// rota (una receta que pide una hierba que no existe) es un error y el juego no arranca. Cada
// archivo `.json` de la carpeta es una lista de entradas con `id` único dentro del tipo.
//
// La versión del contenido (tooling §4) es el hash canónico del catálogo validado: no depende de
// cómo están repartidas las entradas en archivos ni del orden de sus claves.

import { z } from "zod";
import { canonicalHash } from "../canon/index.ts";
import { compareStrings } from "../ids/index.ts";

export { z };

/** Un id de contenido: minúsculas, dígitos, `-`, `_` y `.` (`herb.ginseng`, `walk`). */
export const contentId = z.string().regex(/^[a-z0-9][a-z0-9_.-]*$/, "id de contenido inválido");

export interface ContentRef {
  readonly kind: string;
  readonly id: string;
  /** Dónde está la referencia dentro de la entrada, para el mensaje de error. */
  readonly at: string;
}

export interface ContentKind<T extends { readonly id: string } = { readonly id: string }> {
  /** El nombre de la carpeta en `content/`. */
  readonly name: string;
  readonly schema: z.ZodType<T>;
  refs?(entry: T): readonly ContentRef[];
}

/** Declara un tipo de contenido; el tipo de las entradas sale del esquema. */
export function defineContent<T extends { readonly id: string }>(
  name: string,
  schema: z.ZodType<T>,
  refs?: (entry: T) => readonly ContentRef[],
): ContentKind<T> {
  if (!/^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)*$/.test(name)) {
    throw new TypeError(`nombre de contenido inválido: ${name}`);
  }
  return refs ? { name, schema, refs } : { name, schema };
}

/** Un archivo leído: a qué tipo pertenece, de dónde salió y su JSON ya parseado. */
export interface ContentSource {
  readonly kind: string;
  readonly file: string;
  readonly data: unknown;
}

export class ContentError extends Error {
  override name = "ContentError";
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`content/ no es válido:\n- ${problems.join("\n- ")}`);
    this.problems = problems;
  }
}

/** El catálogo validado, de solo lectura. */
export class Content {
  readonly #byKind: ReadonlyMap<string, ReadonlyMap<string, unknown>>;
  /** La versión del contenido: hash canónico de todas las entradas por tipo e id. */
  readonly hash: string;

  constructor(byKind: ReadonlyMap<string, ReadonlyMap<string, unknown>>) {
    this.#byKind = byKind;
    const all: [string, [string, unknown][]][] = [...byKind.keys()]
      .sort(compareStrings)
      .map((kind) => {
        const entries = byKind.get(kind) as ReadonlyMap<string, unknown>;
        return [kind, [...entries.keys()].sort(compareStrings).map((id) => [id, entries.get(id)])];
      });
    this.hash = canonicalHash(all);
  }

  get<T extends { readonly id: string }>(kind: ContentKind<T>, id: string): T | undefined {
    return this.#byKind.get(kind.name)?.get(id) as T | undefined;
  }

  has(kind: ContentKind, id: string): boolean {
    return this.#byKind.get(kind.name)?.has(id) ?? false;
  }

  /** Todas las entradas de un tipo, ordenadas por id. */
  all<T extends { readonly id: string }>(kind: ContentKind<T>): T[] {
    const entries = this.#byKind.get(kind.name);
    if (!entries) return [];
    return [...entries.keys()].sort(compareStrings).map((id) => entries.get(id) as T);
  }
}

/**
 * Valida todo y junta todos los problemas: carpetas sin tipo, archivos que no son listas,
 * entradas que no cumplen el esquema, ids repetidos y referencias rotas. Tira `ContentError` si
 * hay alguno.
 */
export function loadContent(
  kinds: readonly ContentKind[],
  sources: readonly ContentSource[],
): Content {
  const problems: string[] = [];
  const registry = new Map<string, ContentKind>();
  for (const k of kinds) {
    if (registry.has(k.name)) throw new TypeError(`tipo de contenido repetido: ${k.name}`);
    registry.set(k.name, k);
  }

  const byKind = new Map<string, Map<string, unknown>>();
  const fileOf = new Map<string, string>();
  for (const k of kinds) byKind.set(k.name, new Map());

  const ordered = [...sources].sort((a, b) => compareStrings(a.file, b.file));
  for (const src of ordered) {
    const kind = registry.get(src.kind);
    if (!kind) {
      problems.push(`${src.file}: la carpeta ${src.kind} no es un tipo de contenido conocido`);
      continue;
    }
    if (!Array.isArray(src.data)) {
      problems.push(`${src.file}: tiene que ser una lista de entradas`);
      continue;
    }
    const entries = byKind.get(kind.name) as Map<string, unknown>;
    src.data.forEach((raw: unknown, i: number) => {
      const parsed = kind.schema.safeParse(raw);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const path = issue.path.map(String).join(".");
          problems.push(`${src.file}[${i}]${path ? `.${path}` : ""}: ${issue.message}`);
        }
        return;
      }
      const entry = parsed.data;
      const where = `${kind.name}/${entry.id}`;
      const first = fileOf.get(where);
      if (first !== undefined) {
        problems.push(`${src.file}[${i}]: ${where} repetido (ya está en ${first})`);
        return;
      }
      fileOf.set(where, src.file);
      entries.set(entry.id, entry);
    });
  }

  for (const kind of kinds) {
    if (!kind.refs) continue;
    const entries = byKind.get(kind.name) as Map<string, unknown>;
    for (const id of [...entries.keys()].sort(compareStrings)) {
      for (const ref of kind.refs(entries.get(id) as { id: string })) {
        const target = byKind.get(ref.kind);
        if (!target) {
          problems.push(`${kind.name}/${id}.${ref.at}: el tipo ${ref.kind} no existe`);
        } else if (!target.has(ref.id)) {
          problems.push(`${kind.name}/${id}.${ref.at}: ${ref.kind}/${ref.id} no existe`);
        }
      }
    }
  }

  if (problems.length > 0) throw new ContentError(problems);
  return new Content(byKind);
}
