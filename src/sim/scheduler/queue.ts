// Cola de ítems agendados con hora (simulation §3): un heap binario con el orden canónico de
// `compareItems`, que no depende del orden en que se agendaron (salvo por `seq`, que es determinista).

import { compareItems, type ScheduledItem } from "./process.ts";

export class ScheduleQueue {
  readonly #heap: ScheduledItem[] = [];

  get size(): number {
    return this.#heap.length;
  }

  peek(): ScheduledItem | undefined {
    return this.#heap[0];
  }

  push(item: ScheduledItem): void {
    const h = this.#heap;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (compareItems(h[parent] as ScheduledItem, h[i] as ScheduledItem) <= 0) break;
      swap(h, i, parent);
      i = parent;
    }
  }

  pop(): ScheduledItem | undefined {
    const h = this.#heap;
    const top = h[0];
    const last = h.pop();
    if (h.length > 0 && last !== undefined) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && compareItems(h[l] as ScheduledItem, h[m] as ScheduledItem) < 0) m = l;
        if (r < h.length && compareItems(h[r] as ScheduledItem, h[m] as ScheduledItem) < 0) m = r;
        if (m === i) break;
        swap(h, i, m);
        i = m;
      }
    }
    return top;
  }

  /** Copia en orden canónico, para guardar. */
  items(): ScheduledItem[] {
    return [...this.#heap].sort(compareItems);
  }
}

function swap(h: ScheduledItem[], i: number, j: number): void {
  const t = h[i] as ScheduledItem;
  h[i] = h[j] as ScheduledItem;
  h[j] = t;
}
