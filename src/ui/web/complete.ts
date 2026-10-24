// Lo que se ofrece mientras se escribe (`play-hint-verbs`): sin imports, lo usa el cliente web con
// la lista `Panels.hint.complete` que arma el servidor (`ui/hints.ts`).

/**
 * Lo que se ofrece al escribir `text`: las palabras de `complete` que siguen a lo que está a medio
 * escribir al final de la línea (sin tildes ni mayúsculas), completando la línea entera; con «!»
 * adelante, solo comandos. Como mucho `max`: primero las que toman más palabras de la línea («me
 * dir» → «me dirijo» antes que «me dirigirme»), después las más cortas.
 */
export function completionsOf(text: string, complete: readonly string[], max = 5): string[] {
  if (text.trim() === "") return [];
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const bang = text.trimStart().startsWith("!");
  const said = text.split(/\s+/u);
  // Las frases de varias palabras («me dirijo a») se prueban contra el final de la línea.
  const tail = (n: number) => said.slice(-n).join(" ");
  const found: { line: string; took: number; size: number }[] = [];
  for (const c of complete) {
    if (bang !== c.startsWith("!")) continue;
    const span = c.split(" ").filter((w) => w !== "").length;
    for (let n = bang ? 1 : Math.min(span, said.length); n >= 1; n--) {
      const piece = bang ? text.trimStart() : tail(n);
      if (piece.length > 0 && fold(c).startsWith(fold(piece)) && fold(c) !== fold(piece)) {
        found.push({
          line: `${text.slice(0, text.length - piece.length)}${c}`,
          took: n,
          size: c.length,
        });
        break;
      }
    }
  }
  found.sort(
    (a, b) =>
      b.took - a.took || a.size - b.size || (a.line < b.line ? -1 : a.line > b.line ? 1 : 0),
  );
  return [...new Set(found.map((f) => f.line))].slice(0, max);
}
