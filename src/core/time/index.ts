// Tiempo de la simulación (ARCHITECTURE §4.2, simulation §1). El calendario base llega con su tarea
// de la Fase 0; los calendarios culturales son creencia (weather §6).

/** Segundos absolutos desde el origen del mundo. */
export type Tick = number;

/** Segundos. */
export type Duration = number;

/** Alias: algunos docs dicen Time; es lo mismo que Tick. */
export type Time = Tick;
