// La vida en curso (player-loop §3, Fase 1): el plan del jugador entra al personaje, el mundo
// avanza hasta que el plan termina, se interrumpe o el personaje muere, y el turno devuelve lo que
// pasó. El mismo `submit` + `advanceTo` es el que rehace el replay (tooling §4).

import {
  type AgentId,
  type Content,
  type Event,
  IdAllocator,
  MINUTE,
  type Seed,
  type Tick,
} from "../../core/index.ts";
import {
  type ActionPlan,
  ENTITY,
  FRESH_CURSOR,
  hashState,
  liveSettlementSpaces,
  type ScenarioLife,
  type SchedulerState,
  type StateHash,
  type WorldTruth,
} from "../../sim/index.ts";
import type { GameSetup } from "../setup/index.ts";
import { ACT_PROCESS, PLAN_STATE, type PlanState, planKey, type StepRecord } from "./act.ts";
import {
  anchorOf,
  conditionLabelParts,
  createLife,
  defaultParts,
  derivedLoanUsury,
  type LifeOptions,
  type LifeTerrain,
  lifeTerrain,
  mortalTechParts,
  optInParts,
  type ResumeAnchor,
  resumeParts,
  withDeclaredExternals,
} from "./create.ts";
import { alarmingSigns, fixedInterrupt, type Interrupt } from "./interrupts.ts";
import { type LifeParts, type LifeWorld, lifeWorld } from "./world.ts";

/** El largo máximo de un turno: más que eso es una rutina (player-loop §5), que llega después. */
export const MAX_TURN_DAYS = 30;

/** Lo que se elige antes de empezar y entra al replay como el seed (tooling §3). */
export interface LifeSetup {
  readonly game: GameSetup;
  /** Frecuencia de la grilla del planeta; sin ella, la del planeta real. */
  readonly frequency?: number;
  /** Opt-in (`--famine`): hambruna y migración de hogares (`LifeOptions.famine|migration`); apagado por defecto. */
  readonly famine?: boolean;
  /** Opt-in de la vida de un escenario (`ScenarioEntry.life`): pisa a `famine`; sin él, nada cambia. */
  readonly life?: ScenarioLife;
}

/** Las versiones del motor para el replay (tooling §4): la del formato la pone quien guarda. */
/**
 * `life-2`: `persistGoalLayers` encendido por defecto (objetivos de capas persistidos y eventos
 * `npc.goal` nuevos), así que cambian los hashes y el replay desde el seed de un guardado `life-1`.
 *
 * `life-3`: las vidas nuevas de la CLI/web llevan el perfil completo (`FULL_PROFILE`) en `setup.life`
 * (`--profile basic` vuelve al mundo mínimo). El motor no cambia los defaults de `Life.create`: una
 * vida guardada conserva su `setup` (con o sin perfil), así que sus hashes y su replay siguen igual
 * y solo se registra el límite de motor al abrirla; el bump impide abrir una vida con perfil en un
 * motor anterior, que no conoce esas opciones.
 *
 * `life-4`: `PlanState.steps` compacta los fallos idénticos seguidos en un registro con cuenta
 * (`StepRecord.times`/`lastAt`, `appendStep`): una caminata que el cuerpo no da dejaba un registro
 * por tick (decenas de miles, megabytes en cada guardado y hash). Cambia el estado del plan y los
 * hashes. Compatibilidad: el replay con un motor anterior a `life-4` (`lifeReplayGame`) enciende
 * `verboseSteps` y rehace los registros uno por uno, con los hashes de siempre; una vida guardada
 * con `life-3` sigue desde su estado (los registros viejos se leen igual) con el límite de replay.
 *
 * `life-5`: esperar de noche duerme (`bodyProcess` con `nightRest`: el cuerpo en `rest` de noche corre como `sleep`): quien deja pasar días
 * quieto paga su deuda de sueño. Antes la espera nunca dormía y "espero un día" sumaba 8 h de
 * deuda; el personaje del jugador automático llegaba a 160 h de media (hasta 374 h), con la
 * locomoción en 0,32 y la cojera en el 93 % de los turnos. Cambia el cuerpo de quien espera de
 * noche y los hashes. Compatibilidad: el replay con un motor anterior a `life-5` enciende
 * `waitAwake` (la espera no duerme, con los hashes de siempre); una vida guardada con `life-4`
 * sigue desde su estado con el límite de replay.
 *
 * `life-6`: una espera del jugador (plan de solo `wait`) lleva la rutina mínima del hogar
 * (`RoutineOptions.waitTend`): a las horas de comida come de la despensa del hogar si está en su
 * casa, y a las de agua bebe si está en la aldea o junto al agua, con los eventos y asientos de un
 * NPC (`routine.ate`, `routine.drank`). Antes toda espera de 2+ días se cortaba por sed a ~1,3
 * días. Sin agua o sin comida a mano no hace nada y la alarma del cuerpo corta la espera como
 * siempre. Cambia el cuerpo y la despensa de quien espera y los hashes. Compatibilidad: el replay
 * con un motor anterior a `life-6` enciende `waitUntended` (nadie atiende al que espera, con los
 * hashes de siempre); una vida guardada con `life-5` sigue desde su estado con el límite de replay.
 *
 * `life-7`: quien espera lleva un odre de `SKIN_CAPACITY_L` litros (`WATER_SKIN`, contador como el
 * `skin` de los viajeros NPC `drinkOnRoad`; el agua no pasa por el ledger): a campo abierto, a las
 * horas de agua de la rutina mínima, bebe de él, y donde hay agua lo llena. Antes, a campo abierto,
 * toda espera de 2+ días se cortaba por sed a ~1,3 días. Compatibilidad: el replay con un motor
 * anterior a `life-7` enciende `waitNoSkin`; una vida guardada con `life-6` sigue desde su estado
 * con el límite de replay.
 *
 * `life-8`: la deuda de sueño satura en 72 h (`SLEEP_DEBT_CAP`, microsueños forzados; antes el
 * bot llegaba a 374 h). Compatibilidad: el replay con un motor anterior a `life-8` enciende
 * `sleepUncapped`; una vida guardada con `life-7` sigue desde su estado con el límite de replay.
 *
 * `life-9`: las caídas del personaje (`blowFromMishap`): solo cae de verdad (hiere siempre) quien
 * tira bajo el margen parcial; el tropezón que se corrige hiere con chance `RECOVERED_HURT` y
 * menos fuerte; la cabeza pesa 8 % de las caídas (antes 20 %, como un brazo). Compatibilidad: el
 * replay con un motor anterior a `life-9` enciende `legacyFalls`; una vida guardada con `life-8`
 * sigue desde su estado con el límite de replay.
 *
 * `life-10`: `tend` mira todas las heridas del cuerpo (`nextTreatment`) y elige vendar lo que sangra,
 * limpiar lo infectado o sucio y entablillar el hueso roto; antes trataba solo la más grave y nunca
 * entablillaba. Compatibilidad: el replay con un motor anterior a `life-10` enciende `legacyTend`;
 * una vida guardada con `life-9` sigue desde su estado con el límite de replay.
 *
 * `life-11`: el `resume` de un tramo de camino a medias se apaga al llegar. Antes el plan quedaba
 * con `resume` encendido para siempre y, tras un viaje de varios tramos, repetía el `move` contra
 * el hex donde ya estaba (un segundo por paso, un tropezón posible en cada uno: 3376 pasos y 35
 * heridas en una caminata) en vez de pasar al paso siguiente. Compatibilidad: el replay con un
 * motor anterior a `life-11` enciende `legacyResume`; una vida guardada con `life-10` sigue desde
 * su estado con el límite de replay.
 *
 * `life-12`: quien espera en el hex de su casa (la plaza, la calle) también come de la despensa del
 * hogar; antes solo comía puertas adentro y, esperando afuera en la aldea, vivía de reservas (seed
 * 5: 108 de 168 comidas de espera salteadas, grasa de 91k a 18k kcal). Compatibilidad: el replay
 * con un motor anterior a `life-12` enciende `waitEatHomeOnly`; una vida guardada con `life-11`
 * sigue desde su estado con el límite de replay.
 *
 * `life-13`: quien está inconsciente recibe agua de su cuidador (un adulto despierto de su casa en
 * su mismo hex) a las horas de agua, `routine.watered`; antes la rutina lo salteaba y moría de sed
 * al lado de su familia. Compatibilidad: el replay con un motor anterior a `life-13` enciende
 * `legacyNoCare`; una vida guardada con `life-12` sigue desde su estado con el límite de replay.
 *
 * `life-14`: el perfil completo enciende `npcFootSores` (llagas en la pierna al caminar con el calzado
 * destrozado). Compatibilidad: el replay con un motor anterior a `life-14` enciende `legacyNoFootSores`,
 * que lo apaga aunque el setup lo traiga; una vida guardada con `life-13` sigue desde su estado con el
 * límite de replay.
 *
 * `life-15`: el perfil completo enciende `npcFootwearMend` (el NPC en la aldea remienda o compra par
 * nuevo del calzado gastado, pagando cobre). Compatibilidad: el replay con un motor anterior a
 * `life-15` enciende `legacyNoFootwearMend`, que lo apaga aunque el setup lo traiga; una vida
 * guardada con `life-14` sigue desde su estado con el límite de replay.
 *
 * `life-16`: el perfil completo enciende `npcCloak` (el viajero sale vestido para el aire de la partida
 * y lleva una capa para lo que baje en el camino; la capa se gasta con los días de viaje). Compatibilidad:
 * el replay con un motor anterior a `life-16` enciende `legacyNoCloak`, que lo apaga aunque el setup
 * lo traiga; una vida guardada con `life-15` sigue desde su estado con el límite de replay.
 *
 * `life-17`: el perfil completo enciende `npcStrain` (forzar el ritmo, modo `fast` con fatiga alta, puede
 * torcer una pierna: herida contusa leve). Compatibilidad: el replay con un motor anterior a `life-17`
 * enciende `legacyNoStrain`; una vida guardada con `life-16` sigue desde su estado con el límite de replay.
 *
 * `life-18`: el perfil completo enciende `npcCloakMend` (el NPC en la aldea remienda o compra capa nueva
 * cuando la suya está gastada o perdida, pagando cobre). Compatibilidad: el replay con un motor anterior
 * a `life-18` enciende `legacyNoCloakMend`; una vida guardada con `life-17` sigue desde su estado con el
 * límite de replay.
 *
 * `life-19`: el perfil completo enciende `npcForecast` (al salir de viaje el NPC pronostica el frío del
 * camino con lo que su lugar enseña y solo carga la capa si cree que la va a necesitar). Compatibilidad:
 * el replay con un motor anterior a `life-19` enciende `legacyNoForecast`; una vida guardada con
 * `life-18` sigue desde su estado con el límite de replay.
 *
 * `life-20`: el perfil completo enciende `npcRainForecast` (al salir de viaje el NPC cree si va a llover
 * con lo que vio hoy y los refranes de su lugar; con lluvia creída espera un día, hasta dos seguidos, y
 * carga la capa). Compatibilidad: el replay con un motor anterior a `life-20` enciende
 * `legacyNoRainForecast`; una vida guardada con `life-19` sigue desde su estado con el límite de replay.
 *
 * `life-21`: el perfil completo enciende `npcFieldWatering` (a la primera hora de campo, con el suelo
 * seco y sin creer que llueva, una parte de la gente riega en vez de cosechar y el riego sube el rinde
 * de las horas siguientes). Compatibilidad: el replay con un motor anterior a `life-21` enciende
 * `legacyNoFieldWatering`; una vida guardada con `life-20` sigue desde su estado con el límite de replay.
 *
 * `life-22`: el perfil completo enciende `npcFieldSowing` (la temporada de crecimiento abre una ventana
 * de siembra; la gente de campo siembra a la primera hora con el suelo mojado o lluvia creída, y sembrar
 * tarde baja el rinde de la temporada). Compatibilidad: el replay con un motor anterior a `life-22`
 * enciende `legacyNoFieldSowing`; una vida guardada con `life-21` sigue desde su estado con el límite
 * de replay.
 *
 * `life-23`: el perfil completo enciende `npcFieldShared` (la cosecha del jugador y la puesta al día de los
 * dormidos rinden con el mismo riego y la misma siembra de la aldea que la rutina de los despiertos).
 * Compatibilidad: el replay con un motor anterior a `life-23` enciende `legacyNoFieldShared`; una vida
 * guardada con `life-22` sigue desde su estado con el límite de replay.
 *
 * `life-24`: el perfil completo enciende `npcSowSeed` (sembrar cuesta grano de la despensa del hogar, que
 * pasa a la tierra en el ledger y vuelve con la cosecha; quien cree que va a helar espera). Compatibilidad:
 * el replay con un motor anterior a `life-24` enciende `legacyNoSowSeed`; una vida guardada con `life-23`
 * sigue desde su estado con el límite de replay.
 *
 * `life-25`: el perfil completo enciende `npcExhaustion` (la fatiga alta del cuerpo baja las defensas y el
 * contagio prende más fácil). Compatibilidad: el replay con un motor anterior a `life-25` enciende
 * `legacyNoExhaustion`; una vida guardada con `life-24` sigue desde su estado con el límite de replay.
 *
 * `life-26`: el perfil completo enciende `npcCobbler` (un zapatero de la aldea, con oficio propio y cuero del
 * ledger con origen, cobra los arreglos del calzado en vez del sumidero). Compatibilidad: el replay con un motor
 * anterior a `life-26` enciende `legacyNoCobbler`; una vida guardada con `life-25` sigue desde su estado con el
 * límite de replay.
 *
 * `life-27`: `life.deeds` y `life.mark_exposure` corren una segunda ronda
 * `perceiveCascade` con lo que emitieron los `perceive` del paso (el `scam.discovered` de una marca
 * falsa ahora deja rumor `fraud`, `marks.cleared` y la fama del fraude). Compatibilidad: el replay con
 * un motor anterior a `life-27` enciende `legacyNoPerceiveCascade`; una vida guardada con `life-26`
 * sigue desde su estado con el límite de replay.
 *
 * `life-28`: `life.appraise` también corre la segunda ronda `perceiveCascade`, pero solo con los
 * `scam.discovered` (baja la confianza en el falsificador); el resto de lo que emiten los `perceive` no le llega.
 * Compatibilidad: el replay con un motor anterior a `life-28` enciende `legacyNoAppraiseCascade`; una vida
 * guardada con `life-27` sigue desde su estado con el límite de replay.
 *
 * `life-29`: el mapa local guarda la cuenca oceánica y la teleconexión de la celda de la aldea
 * (`LocalMap.oscillation`, `worldgen/planet/basins.ts`) y el clima de cada día, la cosecha y la
 * lluvia de la ventana de riego leen la anomalía del año de la oscilación (`anomalyOfMap`: años
 * buenos y malos, weather §1). Compatibilidad: el replay con un motor anterior a `life-29` enciende
 * `legacyNoOscillation`; una vida guardada con `life-28` sigue desde su estado con el límite de replay.
 *
 * `life-30`: con `npcVerbs` (perfil económico), `life.lend`, `life.repay_dose` y `life.pawn_decide`
 * comparten el dominio serial `life.economy` con acciones, fiado y trueques (ven las reservas de los
 * demás dentro de la ventana). Compatibilidad: el replay con un motor anterior a `life-30` enciende
 * `legacyNoLendPawnBatch`; una vida guardada con `life-29` sigue desde su estado con el límite de replay.
 *
 * `life-31`: la ejecución de `trade` rechaza (`no_means`) a una contraparte con `ENTITY.endedAt`
 * aunque su cuenta conserve bienes. Compatibilidad: el replay con un motor anterior a `life-31`
 * enciende `legacyNoDeadCounterpartyGuard`; una vida guardada con `life-30` sigue desde su estado
 * con el límite de replay.
 *
 * `life-32`: la espera por lluvia del viajero (`forecastBeforeLeaving` -> `wait`) deja `waits` en
 * su decisión `move`: `life.npc_verbs` no la vence con el día y `life.decide` no la reemplaza hasta
 * `MAX_RAIN_WAITS` días, así el recado no se pierde y el viaje se abre. Compatibilidad: el replay
 * con un motor anterior a `life-32` enciende `legacyNoRainWaitPersist`; una vida guardada con
 * `life-31` sigue desde su estado con el límite de replay.
 *
 * `life-33`: con `npcGreetings` y `speak` en `npcVerbs`, el viajero saluda a quien se cruzó y sigue
 * en su hex con la acción `speak` de acto `greet` (la respuesta la resuelve `life.converse`, el
 * viaje se retoma después) y `life.npc_greetings` (efecto directo) no corre. Compatibilidad: el
 * replay con un motor anterior a `life-33` enciende `legacyNoGreetDecision`; una vida guardada con
 * `life-32` sigue desde su estado con el límite de replay.
 *
 * `life-34`: `famine.began|worsened` cita la oscilación oceánica cuando el año de hoy o el anterior
 * fue seco en la aldea (`data.oscillation` y una causa `state` `oscillation:<cuenca>:<año>:<fase>`).
 * Compatibilidad: el replay con un motor anterior a `life-34` enciende `legacyNoOscillationCause`;
 * una vida guardada con `life-33` sigue desde su estado con el límite de replay.
 *
 * `life-35`: la aldea declara `weather.drought` y `weather.flood` el primer día de un año seco o
 * húmedo de la oscilación (con su `OscillationCause` y la causa `state` `oscillation:<cuenca>:<año>:<fase>`),
 * y la cosecha se anega cuando llueve de más en los últimos días (`FLOOD_MM`, `harvestSeason` con
 * `flood`). Compatibilidad: el replay con un motor anterior a `life-35` enciende
 * `legacyNoOscillationEvents`; una vida guardada con `life-34` sigue desde su estado con el límite de replay.
 *
 * `life-36`: la ejecución de `give` rechaza (`no_means`) a un destinatario con `ENTITY.endedAt` aunque
 * su cuenta exista. Compatibilidad: el replay con un motor anterior a `life-36` enciende
 * `legacyNoDeadGiveGuard`; una vida guardada con `life-35` sigue desde su estado con el límite de replay.
 *
 * `life-37`: lo que le contaron de si alguien vive o murió (`HEARD`) entra además a su libro de
 * creencias como `alive` de fuente `told` (`life.knowing`, `learnToldClaims`, confianza 0,6), y choca
 * con lo que ya creía. Compatibilidad: el replay con un motor anterior a `life-37` enciende
 * `legacyNoToldBeliefs`; una vida guardada con `life-36` sigue desde su estado con el límite de replay.
 *
 * `life-38`: los lectores de lo oído miran `BELIEFS` (fuente `told`) y no `HEARD`: el léxico de
 * `converse` (a quién puede nombrar), la creencia propia del hablante, el choque con lo ya oído al
 * detectar una mentira y `moldgossip.fromHeard` (`heardFromBeliefs`). Compatibilidad: el replay con
 * un motor anterior a `life-38` enciende `legacyHeardReaders`; una vida guardada con `life-37` sigue
 * desde su estado con el límite de replay.
 *
 * `life-39`: el diálogo ya no escribe `HEARD` ni proyecta el efecto `heard`: lo que oye cada uno sale
 * en `action.speak.data.toldClaims` y `life.told_claims` (perceive, al cerrar el paso) lo vuelca a
 * `BELIEFS` como `alive` de fuente `told`; `decideReply` lee `toldAliveClaims` en vez de `heard:` de
 * la tabla. La tabla `HEARD` sigue existiendo para el replay. Compatibilidad: un motor anterior a
 * `life-39` enciende `legacyHeardTable`; una vida guardada con `life-38` sigue desde su estado con
 * el límite de replay.
 *
 * `life-40`: los nombres de pila y los apellidos de menos de `MIN_NAME_LETTERS` letras («O», «Te»)
 * se alargan con un segundo elemento de su propia rama del azar (play-names); los que ya eran largos
 * no cambian. Compatibilidad: un motor anterior a `life-40` enciende `legacyShortNames`; una vida
 * guardada con `life-39` sigue desde su estado con el límite de replay.
 *
 * `life-41`: hablar dura según lo que se dice (`ActionDef.speech`, dialogue §2): un saludo ~20 s,
 * una pregunta ~1 min, palabras sin acto ~1 s por palabra, y la charla sin palabras sigue en los
 * 300 s del catálogo (play-speak-duration). Compatibilidad: un motor anterior a `life-41` enciende
 * `legacyFixedSpeech`; una vida guardada con `life-40` sigue desde su estado con el límite de replay.
 *
 * `life-42`: un `move` de un NPC con destino la aldea (`settlement:n`) camina hasta ella como a
 * cualquier otro lugar; antes solo el jugador con un espacio del sitio lo hacía y el NPC se quedaba
 * donde estaba (play-npc-settlement-walk). Compatibilidad: un motor anterior a `life-42` enciende
 * `legacyNoSettlementWalk`; una vida guardada con `life-41` sigue desde su estado con el límite de replay.
 *
 * `life-43`: en su casa, un `take` sin `from` que no encuentra suelto lo que nombra lo saca de la
 * despensa del hogar (play-refs-objects-larder). Compatibilidad: un motor anterior a `life-43`
 * enciende `legacyNoLarderTake`.
 *
 * `life-44`: en casa ajena (un espacio cerrado de otro hogar), un `take` sin `from` que nombra algo
 * que no está suelto lo saca de la despensa de ese hogar (play-refs-objects-host). Compatibilidad:
 * un motor anterior a `life-44` enciende `legacyNoHostTake`.
 *
 * `life-45`: quien huye o cae en una pelea suelta lo que lleva y abulta (tamaño mediano o grande)
 * donde pasó (play-refs-objects-source-flee). Compatibilidad: un motor anterior a `life-45`
 * enciende `legacyNoFleeShed`.
 *
 * `life-46`: levantar un objeto que nadie lleva encima (en un lugar o guardado) se logra con un
 * resultado parcial; arrebatarlo de quien lo lleva sigue pidiendo un éxito
 * (perfil2-item-claims-item-demand-player). Compatibilidad: `legacyFullTakeItem`.
 *
 * `life-47`: `use` con `well.draw_water` saca agua del pozo a un recipiente que se lleva (use-well).
 * Compatibilidad: un motor anterior a `life-47` enciende `legacyNoDrawWater`.
 *
 * `life-48`: la herramienta que sirve de instrumento en `gather` y `work` se gasta con las horas de
 * uso (`ITEM_WEAR`) y rinde menos cuanto más gastada (use-tools-wear). Compatibilidad:
 * `legacyNoToolWear`.
 *
 * `life-49`: con `itemClaims`, el NPC que sale a trabajar con plantilla agarra la herramienta de su
 * casa, la usa y la deja al volver; soltar algo en un cuarto de la propia casa lo devuelve al hogar
 * (perfil2-item-claims-item-demand-npc). Compatibilidad: `legacyNoNpcTools`.
 *
 * `life-50`: con `itemClaims`, la rutina de campo agarra la azada o la hoz de la casa al salir, cada
 * hora con ella rinde más y la gasta, y la deja al volver (perfil2-item-claims-item-demand-routine).
 * Compatibilidad: `legacyNoRoutineTools`.
 *
 * `life-51`: cada casa de dos o más tiene una piedra de afilar, y `use` con `tool.sharpen` («afilo la
 * hoz») le saca filo a la herramienta gastada comiéndole un poco de metal (use-tools-mend-sharpen).
 * Compatibilidad: `legacyNoSharpen`.
 *
 * `life-52`: con `householdTools`, la aldea tiene herrero desde el principio (`SMITH`, de un hogar del
 * oficio si hay) y, con él presente, `use` con `tool.mend` («hago arreglar la hoz») repara la
 * herramienta a cambio de cobre y hierro (use-tools-mend-smith). Compatibilidad: `legacyNoSmith`.
 *
 * `life-53`: `trade` con el herrero nombrando una herramienta que se forja («le compro una hoz al
 * herrero») la forja con hierro de su hogar y el personaje la paga en cobre; nace un objeto nuevo
 * (use-tools-mend-trade-buy). Compatibilidad: `legacyNoForgeBuy`.
 */
export const LIFE_ENGINE = "life-53";

/**
 * Las opciones de la vida para el replay de un motor: los anteriores a `life-4` no compactan pasos;
 * los anteriores a `life-5` no duermen al esperar de noche; los anteriores a `life-6` no beben ni
 * comen durante una espera; los anteriores a `life-7` no llevan odre.
 */
export function engineOptions(engine: string, options: LifeOptions): LifeOptions {
  const m = /^life-(\d+)$/.exec(engine);
  if (m === null) return options;
  const n = Number(m[1]);
  return {
    ...options,
    ...(n < 4 ? { verboseSteps: true } : {}),
    ...(n < 5 ? { waitAwake: true } : {}),
    ...(n < 6 ? { waitUntended: true } : {}),
    ...(n < 7 ? { waitNoSkin: true } : {}),
    ...(n < 8 ? { sleepUncapped: true } : {}),
    ...(n < 9 ? { legacyFalls: true } : {}),
    ...(n < 10 ? { legacyTend: true } : {}),
    ...(n < 11 ? { legacyResume: true } : {}),
    ...(n < 12 ? { waitEatHomeOnly: true } : {}),
    ...(n < 13 ? { legacyNoCare: true } : {}),
    ...(n < 14 ? { legacyNoFootSores: true } : {}),
    ...(n < 15 ? { legacyNoFootwearMend: true } : {}),
    ...(n < 16 ? { legacyNoCloak: true } : {}),
    ...(n < 17 ? { legacyNoStrain: true } : {}),
    ...(n < 18 ? { legacyNoCloakMend: true } : {}),
    ...(n < 19 ? { legacyNoForecast: true } : {}),
    ...(n < 20 ? { legacyNoRainForecast: true } : {}),
    ...(n < 21 ? { legacyNoFieldWatering: true } : {}),
    ...(n < 22 ? { legacyNoFieldSowing: true } : {}),
    ...(n < 23 ? { legacyNoFieldShared: true } : {}),
    ...(n < 24 ? { legacyNoSowSeed: true } : {}),
    ...(n < 25 ? { legacyNoExhaustion: true } : {}),
    ...(n < 26 ? { legacyNoCobbler: true } : {}),
    ...(n < 27 ? { legacyNoPerceiveCascade: true } : {}),
    ...(n < 28 ? { legacyNoAppraiseCascade: true } : {}),
    ...(n < 29 ? { legacyNoOscillation: true } : {}),
    ...(n < 30 ? { legacyNoLendPawnBatch: true } : {}),
    ...(n < 31 ? { legacyNoDeadCounterpartyGuard: true } : {}),
    ...(n < 32 ? { legacyNoRainWaitPersist: true } : {}),
    ...(n < 33 ? { legacyNoGreetDecision: true } : {}),
    ...(n < 34 ? { legacyNoOscillationCause: true } : {}),
    ...(n < 35 ? { legacyNoOscillationEvents: true } : {}),
    ...(n < 36 ? { legacyNoDeadGiveGuard: true } : {}),
    ...(n < 37 ? { legacyNoToldBeliefs: true } : {}),
    ...(n < 38 ? { legacyHeardReaders: true } : {}),
    ...(n < 39 ? { legacyHeardTable: true } : {}),
    ...(n < 40 ? { legacyShortNames: true } : {}),
    ...(n < 41 ? { legacyFixedSpeech: true } : {}),
    ...(n < 42 ? { legacyNoSettlementWalk: true } : {}),
    ...(n < 43 ? { legacyNoLarderTake: true } : {}),
    ...(n < 44 ? { legacyNoHostTake: true } : {}),
    ...(n < 45 ? { legacyNoFleeShed: true } : {}),
    ...(n < 46 ? { legacyFullTakeItem: true } : {}),
    ...(n < 47 ? { legacyNoDrawWater: true } : {}),
    ...(n < 48 ? { legacyNoToolWear: true } : {}),
    ...(n < 49 ? { legacyNoNpcTools: true } : {}),
    ...(n < 50 ? { legacyNoRoutineTools: true } : {}),
    ...(n < 51 ? { legacyNoSharpen: true } : {}),
    ...(n < 52 ? { legacyNoSmith: true } : {}),
    ...(n < 53 ? { legacyNoForgeBuy: true } : {}),
  };
}

/** La vida como juego del replay (tools/replay), sin importarlo: misma forma. */
export function lifeReplayGame(
  content: Content,
  versions: { engine: string; content: string; format: number },
) {
  return {
    versions,
    start(seed: Seed, setup: LifeSetup) {
      const life = Life.create(seed, content, engineOptions(versions.engine, optionsOf(setup)));
      return {
        advanceTo: (t: Tick) => life.advanceTo(t),
        submit: (plan: ActionPlan, seq: number) => life.submit(plan, seq),
        hash: () => life.hash(),
      };
    },
    /** Desde el snapshot del límite de motor (tooling §4): la misma vida, retomada con el motor nuevo. */
    resume(seed: Seed, setup: LifeSetup, state: unknown, anchor?: unknown) {
      const saved = state as LifeState;
      const life = Life.resume(
        seed,
        content,
        { ...saved, ids: new IdAllocator(saved.ids) },
        engineOptions(versions.engine, optionsOf(setup)),
        (anchor as ResumeAnchor | undefined) ?? undefined,
      );
      return {
        advanceTo: (t: Tick) => life.advanceTo(t),
        submit: (plan: ActionPlan, seq: number) => life.submit(plan, seq),
        hash: () => life.hash(),
      };
    },
  };
}

/** Lo que el modo novela pide del personaje: edad de entrada, sexo, posición y temperamento (game-modes §2). */
function birthOf(game: LifeSetup["game"]): LifeOptions {
  const spec = game.novel?.character;
  if (game.mode !== "novel" || !spec) return {};
  const age = spec.entryAge ?? (game.entry.kind === "age" ? game.entry.at : undefined);
  return {
    ...(age === undefined ? {} : { playerAge: { min: age, max: age } }),
    ...(spec.tastes ? { tastes: spec.tastes } : {}),
    // Sin sexo ni posición no hay nada duro que buscar: alcanza con la edad más cercana.
    ...(spec.sex || spec.family?.position || spec.temperament
      ? {
          birth: {
            ...(spec.sex ? { sex: spec.sex } : {}),
            ...(spec.family?.position ? { position: spec.family.position } : {}),
            ...(spec.temperament ? { temperament: spec.temperament } : {}),
          },
        }
      : {}),
  };
}

export function optionsOf(setup: LifeSetup): LifeOptions {
  return {
    ...(setup.frequency === undefined ? {} : { frequency: setup.frequency }),
    ...birthOf(setup.game),
    ...(setup.famine ? { famine: { staple: "grain" }, migration: { staple: "grain" } } : {}),
    // JSON de Zod: sus opcionales permiten `undefined` y las unidades aún no tienen marca TS.
    ...(setup.life ? (setup.life as unknown as Partial<LifeOptions>) : {}),
  };
}

export interface TurnReport {
  readonly from: Tick;
  readonly to: Tick;
  readonly interrupted: boolean;
  /** Lo que lo cortó, si algo lo cortó (player-loop §6): siempre algo que el personaje percibió. */
  readonly interrupt: Interrupt | null;
  /** Los pasos del plan que se hicieron, con la autopercepción de cada uno. */
  readonly steps: readonly StepRecord[];
  /** Los eventos del personaje y de su cuerpo durante el turno. */
  readonly events: readonly Event[];
  /** El personaje ya no está. */
  readonly over: boolean;
}

/** Lo que hace falta para guardar o seguir la vida (la forma de `LifeState`). */
export interface LifeState {
  readonly truth: WorldTruth;
  readonly log: LifeWorld["log"];
  readonly ledger: LifeWorld["ledger"];
  readonly ids: ReturnType<IdAllocator["state"]>;
  readonly scheduler: SchedulerState;
}

export class Life {
  readonly #w: LifeWorld;
  readonly #anchor: ResumeAnchor;
  #terrain: LifeTerrain | (() => LifeTerrain);

  private constructor(
    w: LifeWorld,
    anchor: ResumeAnchor,
    terrain: LifeTerrain | (() => LifeTerrain),
  ) {
    this.#w = w;
    this.#anchor = anchor;
    this.#terrain = terrain;
  }

  /** El planeta y la pre-corrida; al retomar una vida se generan recién cuando alguien los pide. */
  get terrain(): LifeTerrain {
    if (typeof this.#terrain === "function") this.#terrain = this.#terrain();
    return this.#terrain;
  }

  /** Lo que se guarda con la vida para retomarla sin regenerar el planeta. */
  get anchor(): ResumeAnchor {
    return this.#anchor;
  }

  static create(seed: Seed, content: Content, options: LifeOptions = {}): Life {
    const { world, terrain } = createLife(seed, content, options);
    return new Life(world, anchorOf(terrain), terrain);
  }

  /**
   * Sigue una vida guardada: el catálogo se rehace del contenido y el estado viene de la base.
   * Con el ancla (la que guardó la vida) no se genera el planeta; sin ella (guardados viejos) se
   * regenera del seed.
   */
  static resume(
    seed: Seed,
    content: Content,
    saved: Pick<LifeWorld, "truth" | "ids" | "log" | "ledger"> & { scheduler: SchedulerState },
    options: LifeOptions = {},
    anchor?: ResumeAnchor,
  ): Life {
    saved = {
      ...saved,
      ledger: withDeclaredExternals(
        saved.ledger,
        content,
        options.residue,
        options.npcSowSeed === true && options.legacyNoSowSeed !== true,
        options.npcCobbler === true && options.legacyNoCobbler !== true,
        options.offerings === true,
        options.fieldManure === true,
        options.wildHarvest === true,
        options.wildHunt === true,
        options.wildHarvest === true && options.wildFirewood === true,
        options.hearths === true,
      ),
    };
    if (anchor === undefined) {
      const { world, terrain } = createLife(seed, content, options);
      const spaces = liveSettlementSpaces(
        saved.truth,
        terrain.site.hex,
        [],
        new Map((world.materials ?? []).map((m) => [m.id, m])),
      );
      const derived = derivedLoanUsury(options, content, saved.ledger);
      const parts: LifeParts = {
        ...world,
        ...(derived ? { loanUsury: derived } : {}),
        spaces,
        ...saved,
      };
      const resumed = lifeWorld(parts, world.player, terrain.village, saved.scheduler);
      return new Life(resumed, anchorOf(terrain), terrain);
    }
    const base = resumeParts(seed, content, anchor);
    const spaces = liveSettlementSpaces(
      saved.truth,
      anchor.hex,
      anchor.households,
      new Map((base.materials ?? []).map((m) => [m.id, m])),
    );
    // Con aguas opt-in sin `hexKinds`, el terreno local las llena (regenera el planeta, como al crear).
    const needsTerrain = options.waterSources !== undefined && !options.waterSources.hexKinds;
    const waterTerrain = needsTerrain
      ? lifeTerrain(seed, content, options).site.terrain
      : undefined;
    const derived = derivedLoanUsury(options, content, saved.ledger);
    const parts: LifeParts = {
      ...base,
      ...defaultParts(options),
      ...optInParts(options, waterTerrain),
      ...mortalTechParts(options, content),
      ...conditionLabelParts(options, content),
      ...(derived ? { loanUsury: derived } : {}),
      spaces,
      ...saved,
    };
    const resumed = lifeWorld(parts, anchor.player, anchor.village, saved.scheduler);
    return new Life(resumed, anchor, () => lifeTerrain(seed, content, options));
  }

  get player(): AgentId {
    return this.#w.player;
  }

  get now(): Tick {
    return this.#w.scheduler.now;
  }

  get world(): LifeWorld {
    return this.#w;
  }

  get alive(): boolean {
    return this.#w.truth.get(ENTITY, this.player)?.endedAt === undefined;
  }

  state(): LifeState {
    const w = this.#w;
    return {
      truth: w.truth,
      log: w.log,
      ledger: w.ledger,
      ids: w.ids.state(),
      scheduler: w.scheduler.state(),
    };
  }

  hash(): StateHash {
    return hashState(this.state());
  }

  /** El plan entra al personaje sin avanzar: lo que comparten el turno y el replay. */
  submit(plan: ActionPlan, seq: number): void {
    const w = this.#w;
    const state: PlanState = {
      seq,
      plan,
      cursor: FRESH_CURSOR,
      lastBelieved: null,
      steps: [],
      done: false,
    };
    w.truth.set(PLAN_STATE, this.player, state);
    w.scheduler.schedule({
      at: w.scheduler.now + 1,
      phase: "act",
      process: ACT_PROCESS,
      scope: this.player,
      reason: { kind: "state", entity: this.player, key: planKey(seq) },
    });
  }

  advanceTo(t: Tick): void {
    this.#w.scheduler.advanceTo(t);
  }

  /** Un turno: el plan, el avance hasta que termina o algo lo corta, y lo que pasó. */
  turn(plan: ActionPlan, seq: number): TurnReport {
    const w = this.#w;
    const from = this.now;
    this.submit(plan, seq);
    const events: Event[] = [];
    const cap = from + MAX_TURN_DAYS * w.clock.day;
    const known = alarmingSigns(w);
    let interrupt: Interrupt | null = null;
    const result = w.scheduler.advanceUntil(cap, (report) => {
      for (const e of report.events) {
        if (e.actors.includes(this.player)) events.push(e);
      }
      if (!this.alive) return true;
      if (w.truth.get(PLAN_STATE, this.player)?.done ?? true) return true;
      interrupt = fixedInterrupt(w, report.events, known);
      return interrupt !== null;
    });
    const state = w.truth.get(PLAN_STATE, this.player);
    return {
      from,
      to: result.now,
      interrupted: result.interrupted && !(state?.done ?? true),
      interrupt,
      steps: state?.steps ?? [],
      events,
      over: !this.alive,
    };
  }
}

export { MINUTE };
