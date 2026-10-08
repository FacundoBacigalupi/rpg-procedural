# Combate individual: la pelea a la escala de una persona

> Principio: **una pelea es la misma simulación mirada de cerca.** Cuerpos con partes, armas que son objetos, mentes que tienen miedo y ojos que pueden ser engañados, todo a resolución de fracciones de segundo. No hay puntos de vida, ni turnos, ni modo combate aparte: hay gente que intenta lastimar, no ser lastimada o irse.

> Estado: **borrador** (2026-10-06).

Depende de: [actions.md](actions.md) (verbos de combate, reflejos y posturas, resolución común), [skills.md](skills.md) (facetas, repertorio, familiaridad, vicios, estilos), [body-health.md](body-health.md) (partes, heridas, dolor, shock, sangrado, fatiga, muerte), [perception.md](perception.md) (ver venir el golpe, sorpresa, huellas), [elements.md](elements.md) (las técnicas chocan con `interact`), [cultivation.md](cultivation.md) §8, §11 (técnicas, esencia, lo que da el cultivo), [npc-psychology.md](npc-psychology.md) (miedo, ira, decisión, trauma), [simulation.md](simulation.md) (resolución de escena, contiendas, tick fino), [heaven-karma.md](heaven-karma.md) (karma por matar, inclinación de tiradas).
Lo usan: [war.md](war.md) (los duelos y las escaramuzas cerca del jugador se resuelven acá; las batallas siguen en war §7), [law.md](law.md) (lesiones, homicidio, legítima defensa, huellas), [contracts.md](contracts.md) (duelos pactados), [social-structure.md](social-structure.md) (cara y desafíos), [living-world.md](living-world.md) (bestias), [spirits.md](spirits.md) (ataques al alma).

---

## Principios

1. **Sin puntos de vida.** El daño son heridas en partes del cuerpo (body-health §4). Las peleas terminan porque alguien no puede o no quiere seguir: dolor, shock, sangre, un brazo que no responde, miedo. Morir de un solo golpe es posible; quedar vivo con una herida que mata en tres días, también.
2. **Pocas peleas son a muerte.** La mayoría termina en huida, rendición, separación o intervención de otros. Matar tiene costos (ley, venganza, karma, cara) y casi todos los actores los pesan.
3. **La mitad de la pelea es percibir.** Ver venir el golpe, leer la finta, notar el pie que resbala, saber dónde está el segundo atacante. Lo que no se percibe no se defiende.
4. **El tiempo es el recurso.** Cada movimiento tarda en prepararse, se compromete y deja un hueco. Quien controla el ritmo controla la pelea.
5. **Todo cuesta.** Aire, fuerza, esencia, filo, armadura, nervio. Nada se recupera dentro de la pelea salvo con medios concretos.
6. **Las peleas dejan rastro.** Ruido, sangre, armas rotas, tierra quemada, la firma de una técnica, testigos con memorias deformadas. Lo que pasó es investigable (law).

---

## 1. Cuándo hay una pelea

No hay un modo combate. Cuando un actor ejecuta un verbo hostil (`strike`, `grapple`, `shoot`, una técnica de ataque) o un plan con intención de dañar entra en ejecución, la zona pasa a resolución **scene** (simulation §4) y los agentes involucrados al **tick fino de combate**.

```ts
interface Fight {
  id: FightId;
  location: SceneRef;                        // el espacio real: grafo de lugares de perception con geometría local
  participants: FightParticipant[];          // entran y salen durante la pelea
  startedBy: EventId;                        // la primera acción hostil, con sus causas (el insulto, la emboscada, el robo)
  norms?: FightNorms;                        // si es un duelo pactado o una práctica (§13)
  beat: Duration;                            // ~0,25 a 0,5 s para mortales; más fino entre cultivadores rápidos
}

interface FightParticipant {
  agent: AgentId;
  side?: SideRef;                            // lado percibido, puede cambiar
  intent: "kill" | "subdue" | "drive_off" | "escape" | "defend_other" | "spar" | "test";
  resolve: FightResolve;                     // §11
  stance: StanceState;                       // §3
  position: CombatPosition;                  // §2
}
```

- **La pelea termina** cuando nadie tiene intención hostil activa, cuando la distancia rompe el contacto (fuera de alcance y de percepción) o cuando los que quedan no pueden actuar. La zona vuelve a su resolución normal con histéresis (simulation §4).
- **Los demás no se congelan.** Los NPCs alrededor perciben la pelea (ruido, gritos, sangre) y deciden con su utilidad: mirar, huir, llamar a la guardia, meterse, aprovechar para robar.

## 2. Espacio

```ts
interface CombatPosition {
  at: Vec2 | Vec3;                           // posición continua en la escena (3D si alguien vuela o hay altura)
  facing: Angle;
  footing: number;                           // firmeza del apoyo: barro, hielo, escalera, techo, agua
  elevation: number;                         // estar más alto ayuda en golpe y alcance
  cover: CoverRef[];                         // lo que hay entre él y cada rival
  bound?: GrappleRef;                        // si está trabado en una lucha cuerpo a cuerpo
}
```

- **Distancias por alcance:** cuerpo a cuerpo (agarre, codo, cuchillo), corta (puño, sable), media (espada larga, lanza corta), larga (lanza, alabarda), proyectil (arco, ballesta, piedra), técnica (el alcance que dé la técnica). Cada arma tiene su distancia buena y sufre fuera de ella: una lanza adentro de la guardia es un palo torpe.
- **El terreno pesa:** suelo resbaladizo baja `footing` y aumenta resbalones (actions §8); espacios estrechos impiden armas largas y rodeos; la oscuridad y el humo cambian la percepción; el agua frena.
- **Rodear** es la ventaja de los números: un actor solo ve un frente; el que ataca desde atrás no se percibe por la vista (perception §4) y llega sin defensa voluntaria.
- **Volar y altura** (cultivadores, bestias): la tercera dimensión cambia alcances, cobertura y huida.

## 3. Tiempo: el ritmo

Cada acción de combate tiene fases:

```ts
interface CombatTiming {
  windup: Duration;                          // preparación: lo que el rival puede leer
  commit: Duration;                          // el golpe o movimiento en sí: ya no se cancela
  recovery: Duration;                        // vuelta a guardia: el hueco que deja
  telegraph: number;                         // cuánto se nota la preparación (baja con execution y con las mañas del estilo)
}

interface StanceState {
  guard: GuardKey;                           // alta, media, baja, cerrada, abierta; depende del estilo
  balance: number;                           // se pierde al recibir, al fallar con compromiso, al resbalar
  breath: number;                            // aire: baja con el esfuerzo, limita la intensidad
  committed?: { action: CombatActionRef; until: Tick };
}
```

- **Se resuelve por pulsos.** En cada pulso, cada participante que no está comprometido decide (o su reflejo decide por él, actions §6) con lo que percibe. Las acciones arrancan en paralelo y se resuelven cuando se cruzan sus fases. Como en simulation §3, el orden de cálculo no importa: las contiendas usan claves.
- **Atacar en el hueco del otro** (durante su `recovery` o su `windup`) es la base de los contraataques. Un golpe fuerte y lento deja huecos grandes; uno rápido y liviano, chicos.
- **Iniciativa** no es un número de turno: es quién percibe primero y quién tiene acciones más cortas. Velocidad del cuerpo (capacidades), `reading` de la habilidad y, en cultivadores, la percepción y el cuerpo refinados.

## 4. Un intercambio

Cuando una acción ofensiva se cruza con un defensor:

1. **Intención del atacante:** verbo, línea (alta, media, baja, estocada, barrido), parte buscada si tiene habilidad para apuntar, modo (fuerte, rápido, finta, a matar o a desarmar).
2. **Ejecución con ruido:** la habilidad efectiva (skills §11) más el ruido de control desvían la línea, la fuerza y el tiempo (como el paso de un oficio, crafts §1). Fatiga, dolor y miedo agregan ruido.
3. **Percepción del defensor:** ¿lo vio venir? Depende de su atención (perception §4), de dónde viene el golpe, de la luz, del `telegraph` del atacante y del `reading` del defensor. Puede leerlo bien, mal (cree que viene alto y viene bajo) o no verlo.
4. **Reacción:** si lo vio y no está comprometido, elige o reflexiona: parar, esquivar, bloquear con escudo, contragolpear, aguantar. Si no lo vio, solo cuenta un reflejo (si el ruido o un sentido lo alertaron) o nada.
5. **Contienda** entre la ejecución del ataque y la de la defensa, con las tiradas de clave de cada uno (actions §7).
6. **Contacto:** si pasa, la geometría (arma, línea, parte alcanzada) y la física (masa, velocidad, filo, punta) definen el impacto; la armadura lo transforma (body-health §4: el corte contra la malla se vuelve contundente); el cuerpo lo recibe como `Injury` con profundidad, sangrado y dolor.
7. **Consecuencias en el estado:** balance perdido, arma trabada, filo mellado, arma rota, desarme, caída. Cada participante percibe lo que pasó (o lo que cree que pasó).

## 5. Leer y engañar

- **Fintas:** una acción con `windup` falso que busca una reacción equivocada. Funciona si el defensor la lee como real y reacciona; contra alguien con mucho `reading`, la finta cuesta tiempo y no compra nada.
- **Leer al rival** antes y durante la pelea: su postura, su estilo (familiaridad, skills §2.3), sus vicios (skills §5: "baja la guardia después del tercer golpe"), sus heridas, su cansancio, su miedo. Lo que se lee entra como creencias sobre el rival y cambia la decisión.
- **Sorpresa:** atacar a quien no percibe al atacante (emboscada, por la espalda, en la oscuridad, sigilo, actions §2) anula la defensa voluntaria del primer intercambio. Por eso las emboscadas deciden tantas peleas, como en war §7.
- **Esconder el nivel:** pelear por debajo de lo que uno sabe o aparentar torpeza (skills §9) para que el otro se confíe.
- **Intención asesina** (si el mundo la tiene): los cultivadores con sentido de la esencia perciben la hostilidad de quien prepara un ataque; los entrenados la esconden.

## 6. Armas y armaduras como objetos

```ts
interface WeaponProps {                      // derivado del objeto: forma, material, construcción (crafts §5)
  reach: number;
  mass: number;
  balance: number;                           // dónde está el peso: velocidad vs potencia
  edge?: { sharpness: number; length: number; hardness: number };
  point?: { sharpness: number };
  blunt?: { area: number };
  durability: number;                        // vida antes de mellarse, doblarse o romperse
  handling: SkillId;                         // qué habilidad usa
  elementVector?: ElementVector;             // artefactos espirituales: la esencia que lleva o canaliza
}

interface ArmorPiece {
  covers: PartId[];
  material: MaterialRef;
  layers: number;
  vsCut: number; vsPierce: number; vsBlunt: number; vsEssence: number;
  mass: number;                              // suma a la fatiga y resta agilidad
  condition: number;                         // se rompe en los puntos donde recibe
}
```

- **Las propiedades salen del objeto real**, con su origen y su calidad (crafts): un sable mal templado se quiebra en el tercer choque; uno de maestro corta un clavo. Nada es "un arma +2".
- **Las armas se gastan:** filos mellados, hojas dobladas, astas partidas, cuerdas cortadas, flechas que se pierden. Los pedazos quedan en el mundo como lotes (conservación).
- **La armadura cubre partes:** lo que no cubre queda expuesto, y el que sabe apunta ahí. Pesa: después de media hora con armadura, el aire se acaba antes.
- **Armas improvisadas:** cualquier objeto con masa y forma sirve (un banco, una olla, un palo), con sus propiedades reales y sin habilidad específica (transferencia mínima, skills §8).
- **Proyectiles:** arco y ballesta tienen tiempo de carga, alcance efectivo, caída con la distancia, viento y munición finita.

## 7. Daño y capacidad para seguir

- **Por parte y por tejido** (body-health §4): el corte sangra, la punción llega a órganos, el contundente rompe huesos y aturde, la quemadura de una técnica de fuego destruye piel.
- **La capacidad cambia durante la pelea:** un brazo herido baja `manipulation` de esa mano; una pierna baja `locomotion`; un golpe en la cabeza aturde (baja `cognition` y `acuity` unos pulsos o minutos). Las capacidades se recalculan en cada pulso (body-health §3).
- **Dolor y shock:** el dolor baja la capacidad de actuar; la adrenalina lo tapa un rato (sube `painTolerance` y la fuerza, baja la precisión fina) y después se cae. Mucha sangre perdida lleva a shock e inconsciencia en minutos.
- **Muerte:** por destrucción de un órgano vital, desangrado o trauma del cerebro (body-health §13). A veces instantánea, a veces minutos después, a veces días después por infección. El que ganó la pelea puede morir esa noche.

## 8. Cansancio y esencia

- **El aire se acaba:** cada acción gasta `breath` según su intensidad y la armadura; sin aire, todo es más lento y más torpe. Las peleas reales entre mortales duran poco: menos de un minuto la mayoría, y nadie intercambia golpes media hora salvo con pausas.
- **La esencia se gasta:** cada técnica cuesta esencia (cultivation §11). Sin esencia, el cultivador es su cuerpo (refinado, pero cuerpo). Recargar en pelea requiere píldoras o piedras (tiempo y riesgo) o técnicas de absorción rápidas con su propio costo.
- **El cuerpo refinado** (body-health §12) cansa menos, resiste más y se mueve más rápido: es parte de la brecha entre mortal y cultivador.

## 9. Artes marciales y técnicas

- **Estilos** (skills §6): repertorio de movimientos con su línea, su ritmo, su `telegraph` y sus mañas firma; énfasis en ciertas facetas; familiaridad típica contra otros estilos. Un estilo de lanza de la llanura no se parece a uno de sable de las montañas.
- **Movimientos del repertorio** son piezas de skills §2.2 con sus propias `CombatTiming`, línea y efecto (desarmar, derribar, trabar, presionar un punto de acupuntura que sella el qi).
- **Técnicas de cultivo** (cultivation §8): cuestan esencia, tienen un vector elemental, alcance, forma (proyectil, aura, cuerpo reforzado, escudo, paso veloz) y una firma perceptible (perception §2). Cuando chocan dos técnicas, o una técnica con un escudo, el resultado sale de `interact` (elements §3) con conservación: lo que no se anula se transforma en calor, luz, viento, daño.
- **Contragolpe de técnica:** una técnica mal ejecutada (ruido de control, vicios, poca comprensión) puede dañar los meridianos del que la usa (body-health §12, cultivation).
- **Intención y dominio** (cultivation §9): con un insight del aspecto, los golpes llevan intención (cortan más allá del filo, intimidan) y a nivel alto el cultivador impone un dominio en la escena que cambia las reglas locales del campo (elements §6).

## 10. Mortal contra cultivador

La brecha es real y depende del mundo (war §8, metaphysics):
- **Percepción y velocidad:** un cultivador refinado ve el golpe del mortal como lento; el mortal no ve el del cultivador.
- **Cuerpo:** la piel refinada desvía hojas comunes; los escudos de esencia frenan flechas.
- **Alcance:** las técnicas golpean desde donde el mortal no llega.

**Lo que tiene el mortal:** sorpresa (un cultivador dormido o distraído es un cuerpo), veneno que ataca los meridianos, armas preparadas (flechas con talismán), números que lo cansan y lo vacían de esencia, terreno con campo de qi adverso, chantaje y rehenes, y el costo que la muerte de un mortal le trae al cultivador (karma, la secta que no quiere escándalo). Un mortal le gana a un cultivador débil con estas cosas, no con esgrima.

## 11. Moral individual: querer seguir

```ts
interface FightResolve {
  will: number;                              // disposición a seguir
  drivers: ResolveDriver[];                  // miedo, ira, desesperación, deber, orgullo, odio, proteger a alguien
  belief: { myOdds: number; spread: number };// lo que cree de sus chances: se actualiza con lo que percibe
  breakAt: number;                           // cuándo se quiebra: temperamento, experiencia, entrenamiento, nada que perder
}
```

- **Las chances creídas se actualizan en la pelea** con lo que se percibe: las heridas propias, la sangre del rival, que un compañero cayó, que el rival se mueve demasiado rápido. Por eso un cultivador que muestra una técnica puede terminar una pelea sin dar un golpe.
- **Quebrarse** es huir, rendirse o paralizarse, según temperamento y salidas disponibles. Lo contrario también existe: la ira o la desesperación pueden subir `will` (pelear acorralado).
- **El jugador no tiene esta barra.** Su personaje sí siente miedo: el narrador lo cuenta, la cognición baja con el pánico y los reflejos pueden traicionarlo (un reflejo de huir si su temperamento lo tiene). La decisión de seguir es del jugador.
- **Después de la pelea:** el miedo, la culpa por matar, el trauma (npc-psychology) quedan, y cambian a la persona.

## 12. Cómo termina

- **Huir** (`flee`, `disengage`): romper el contacto es una acción con riesgo (el hueco de darse vuelta) y después una persecución, que es una contienda de movimiento con terreno, aire y conocimiento del lugar.
- **Rendirse** (`yield`): es un acto social. El que gana decide con su utilidad, sus normas y su temperamento: perdonar, tomar cautivo (war §10, contracts), humillar, matar. Matar a quien se rindió tiene costos de cara, de ley y de karma según la cultura.
- **Perdonar o rematar** (`spare`, `finish`): el remate de alguien indefenso es una decisión con peso moral; queda en la memoria de los testigos y en el karma (heaven-karma §2).
- **Dejar inconsciente o reducir** (intención `subdue`): golpes controlados, estrangulamiento, ataduras. Es más difícil que lastimar: exige más habilidad que el rival.
- **Intervención:** guardias, familiares, maestros, curiosos que se meten por su utilidad, o una autoridad que separa.

## 13. Duelos, prácticas y desafíos

- **Prácticas** (intención `spar`): los golpes se frenan (menos fuerza, armas romas o de madera); el daño es menor pero no cero. La práctica es la fuente principal de aprendizaje de combate (skills §3) y de familiaridad con el estilo del otro.
- **Duelos pactados:** un compromiso (contracts) con reglas (hasta la primera sangre, hasta la rendición, a muerte; armas; testigos). Las reglas son normas, no física: se pueden romper, con las consecuencias de romperlas.
- **Desafíos:** retar a alguien es un acto social con cara en juego (social-structure §4). Rechazar puede costar más que perder.
- **Escenarios de vida o muerte** en sectas y torneos: duelos donde la muerte no trae venganza por acuerdo previo (que el clan del muerto puede no respetar).

## 14. Varios contra varios

- **Hasta unas veinte personas** se resuelven acá, cada una con su posición, su percepción y su moral: riñas de taberna, emboscadas de bandidos, una patrulla, el asalto a una casa.
- **Rodeo y fuego amigo:** con más gente, rodear es fácil, la atención se divide (perception §4) y los golpes al montón pueden alcanzar al compañero.
- **Más allá** se pasa al modelo de batalla de war §7, con unidades. Cerca del jugador, la batalla se resuelve en agregado salvo el entorno inmediato del personaje, que es una pelea de este modelo dentro de la batalla.

## 15. Bestias y espíritus

- **Bestias:** cuerpos con su anatomía (body-health §1), armas naturales (dientes, garras, cuernos, veneno), instintos en vez de estilo (`BeastMind`, living-world), moral de animal (huyen más que los humanos salvo acorraladas o protegiendo crías) y, si son bestias espirituales, técnicas innatas con vector elemental.
- **Espíritus:** no tienen cuerpo que herir; se les hace daño con técnicas del alma, objetos y ritos (spirits). Ellos atacan la mente y el alma: miedo, posesión, drenaje.

## 16. Rastros y consecuencias

- **Emisiones durante la pelea:** golpes, gritos, el brillo de una técnica, el olor a sangre (perception §2). Atraen gente y bestias.
- **Huellas después:** sangre en el piso, armas o pedazos, ropa rasgada, tierra quemada, la firma residual de una técnica que un experto reconoce (perception §9). Son la materia prima de una investigación (law).
- **Testigos:** recuerdan lo que percibieron, deformado por el miedo y la rapidez (npc-psychology §5): "eran tres", "tenía una espada roja".
- **Karma y deuda de sangre:** matar crea karma (heaven-karma §2) con peso según la causa y la víctima: mínimo en defensa propia o contra alguien con mucho karma negativo, mayor contra un rendido. Casi siempre deja, además, alguien que quiere venganza (familia, secta, maestro), que no mide como el Cielo.
- **Reputación:** quién ganó, cómo y contra quién viaja como rumor. Ganar con trampa o matar a un rendido también viaja.

## 17. El jugador y el narrador

- **Ritmo de control:** el jugador da una intención táctica ("lo mantengo a distancia con la lanza y busco el muslo", "desarmarlo sin matarlo", "si saca un cuchillo, me voy") que se ejecuta como plan con sus reflejos y posturas (actions §6). La simulación **pausa y le devuelve el control** en momentos que importan **según lo que percibe y cree el personaje** (aprobado 2026-10-06): un hueco que él ve (con su `reading`; el hueco que no ve no pausa, y el que cree ver puede ser una finta), una herida propia que nota (la que no siente por la adrenalina no pausa hasta que la nota), un rival que él entiende que se rinde, alguien nuevo que percibe, una decisión de matar.
- **La narración es la pelea percibida:** rápida, confusa, con visión de túnel bajo adrenalina. El jugador no recibe "le hiciste un corte de 4 cm en el antebrazo"; recibe lo que su personaje notó, y puede no darse cuenta de que lo hirieron hasta después.
- **El estado del personaje** después de la pelea (heridas, dolor, cansancio) se cuenta como lo siente él; el inspector muestra la verdad.

## 18. Escala (LOD)

- **scene:** este modelo completo, pulso por pulso.
- **local:** una pelea entre NPCs lejos del jugador se resuelve en una sola contienda: poder de combate de cada lado (habilidad, cuerpo, equipo, cultivo, sorpresa, moral) → resultado (quién gana, cómo termina) → heridas muestreadas del modelo de cuerpo según armas y margen. Las huellas y los testigos se generan igual.
- **regional y world:** tasas de violencia (riñas, asaltos, duelos) por población, que producen heridos, muertos y vendettas como flujos.
- **Coherencia:** la contienda resumida se calibra contra el modelo completo (simulation §9): la distribución de resultados de mil peleas simuladas pulso a pulso entre perfiles dados debe coincidir con la de la versión resumida.

## 19. Implementación por fase

- **Fase 1:** pelea mortal simple: posiciones en la escena, distancias por alcance, pulsos con `windup`/`commit`/`recovery`, intercambio con percepción y contienda, heridas por parte, dolor, sangrado y shock, aire, huida y rendición, testigos y sangre como huella.
  - *Hecho (2026-10-07, `sim/combat`):* pulsos de 1 s (no 0,25–0,5), solo puños (alcance 0,8 m, zancada 1,5 m), dos peleadores en una línea, ver venir el golpe, heridas por `sim/body`, quiebre por moral con chances creídas (`landed − woundsTaken`), huida a 14 m, rendición, tope de 90 pulsos. Intención → objetivo: `kill`, `subdue`, `drive_off`, `escape`. Calibración inicial: ~42 s, 91 % decididas. Falta: pausas del jugador, rematar o perdonar, escena real, varios, sangre como huella.
- **Fase 2:** leer al rival como creencias, fintas, chances creídas y quiebre, trauma y culpa después de matar.
- **Fase 3:** armas y armaduras como objetos con desgaste; estilos y repertorio; prácticas como fuente de aprendizaje; varios contra varios hasta ~20; resolución resumida calibrada para NPCs lejanos.
- **Fase 4:** técnicas de cultivo con esencia, `interact` en los choques, escudos, cuerpo refinado, mortal contra cultivador, contragolpe de técnica, intención asesina.
- **Fase 5:** bestias con `BeastMind` y armas naturales; persecuciones por terreno.
- **Fase 6:** duelos pactados y desafíos con cara; escenarios de vida o muerte; la pelea del jugador dentro de una batalla.

## Tests

- **Sin puntos de vida:** ninguna pelea termina por un contador; siempre por incapacidad, muerte, huida, rendición, separación o intervención, con causa.
- **Percepción:** un ataque desde fuera de la percepción del defensor no recibe defensa voluntaria; con la misma pelea a plena luz, sí.
- **Ritmo:** contra una acción con `recovery` largo, el contraataque en el hueco tiene más éxito que fuera de él.
- **Armadura:** un corte contra malla produce lesión contundente, no corte.
- **Conservación:** las armas rotas dejan pedazos; la esencia gastada en técnicas sale del cultivador y va al ambiente o al blanco según `interact`.
- **Mayoría no letal:** en una población de riñas mortales sin intención de matar, la mayoría termina sin muertos.
- **Moral:** con todo igual salvo el temperamento, el ansioso se quiebra antes; las chances creídas bajan al percibir una técnica superior.
- **Calibración resumida–completa:** la distribución de resultados de la contienda resumida coincide con la del modelo pulso a pulso dentro de la tolerancia.
- **Determinismo:** misma pelea, mismo seed → mismos golpes, heridas y final, sin importar el orden de cálculo de los participantes.

## Decisiones tomadas en este borrador (revisables)

- **Pulsos de ~0,25 a 0,5 s** con fases `windup`/`commit`/`recovery` y resolución simultánea por contiendas, sin turnos ni iniciativa numérica.
- **Espacio continuo** en la escena, con distancias por alcance, terreno, rodeo y altura.
- **Daño solo como heridas** de body-health; capacidades recalculadas por pulso.
- **Armas y armaduras con propiedades derivadas del objeto** y desgaste con conservación.
- **Moral individual** con chances creídas que se actualizan por lo percibido; el jugador no tiene barra de moral pero su personaje siente miedo.
- **Control del jugador por intención táctica** con pausas en momentos importantes, disparadas por lo que percibe y cree el personaje, no por la verdad (aprobado 2026-10-06).
- **Letalidad realista:** peleas cortas entre mortales, heridas que matan días después, pelear siempre es un riesgo serio (aprobado 2026-10-06).
- **Karma por matar según causa y víctima:** mínimo en defensa propia y contra víctimas con mucho karma negativo; más alto contra rendidos e inocentes indefensos (heaven-karma §2, aprobado 2026-10-06).
- **Hasta ~20 participantes** en este modelo; más allá, war §7, con el entorno inmediato del jugador como pelea individual dentro de la batalla (aprobado 2026-10-06).

## Preguntas abiertas

- Calibración: largo del pulso por rango de velocidad; tiempos por arma y movimiento; curvas de sangrado y shock en pelea; gasto de aire por intensidad y armadura; peso de la sorpresa; umbrales de quiebre por temperamento; tamaño de la brecha mortal–cultivador por umbral (depende del mundo); duración típica de una pelea; frecuencia de pausas aceptable para el jugador.
