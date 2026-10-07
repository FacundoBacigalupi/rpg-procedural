// Montículo mínimo de (costo, celda) con desempate por celda: el orden de salida no depende de
// cómo se insertó, así que el crecimiento de placas y el relleno de depresiones son deterministas.

export class MinHeap {
  #cost: number[] = [];
  #cell: number[] = [];
  #tag: number[] = [];

  get size(): number {
    return this.#cost.length;
  }

  push(cost: number, cell: number, tag = 0): void {
    this.#cost.push(cost);
    this.#cell.push(cell);
    this.#tag.push(tag);
    let i = this.#cost.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.#less(i, p)) break;
      this.#swap(i, p);
      i = p;
    }
  }

  /** Saca el menor; devuelve [costo, celda, etiqueta]. */
  pop(): [number, number, number] {
    const n = this.#cost.length;
    if (n === 0) throw new RangeError("montículo vacío");
    const top: [number, number, number] = [
      this.#cost[0] as number,
      this.#cell[0] as number,
      this.#tag[0] as number,
    ];
    this.#swap(0, n - 1);
    this.#cost.pop();
    this.#cell.pop();
    this.#tag.pop();
    const m = n - 1;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let s = i;
      if (l < m && this.#less(l, s)) s = l;
      if (r < m && this.#less(r, s)) s = r;
      if (s === i) break;
      this.#swap(i, s);
      i = s;
    }
    return top;
  }

  #less(a: number, b: number): boolean {
    const ca = this.#cost[a] as number;
    const cb = this.#cost[b] as number;
    if (ca !== cb) return ca < cb;
    const xa = this.#cell[a] as number;
    const xb = this.#cell[b] as number;
    if (xa !== xb) return xa < xb;
    return (this.#tag[a] as number) < (this.#tag[b] as number);
  }

  #swap(a: number, b: number): void {
    for (const arr of [this.#cost, this.#cell, this.#tag]) {
      const t = arr[a] as number;
      arr[a] = arr[b] as number;
      arr[b] = t;
    }
  }
}
