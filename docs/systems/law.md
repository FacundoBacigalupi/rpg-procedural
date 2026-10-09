# Ley y justicia

> Estado: **borrador de diseño**. Cómo una sociedad decide que algo fue un crimen, quién lo juzga y qué le pasa al culpable (o al que creen culpable): códigos por cultura como normas, jurisdicciones que se superponen (clan, aldea, gremio, secta, templo, estado), denuncia y caso, investigación con huellas, testigos y confesiones, procedimientos y pruebas, corrupción, castigos con costo y conservación, vendetta contra tribunal, sectas y poderosos por encima de la ley, justicia interna de secta, contrabando y mercado negro, y el crimen como oficio.

Depende de: [causality.md](causality.md) (procedencia, presiones, conservación), [perception.md](perception.md) (huellas, identificar personas, errores con forma, leer el cultivo), [information.md](information.md) (creencias, testigos, rumores, documentos, secretos, reputación), [npc-psychology.md](npc-psychology.md) (memoria que se deforma, utilidad, culpa, cara, venganza, sesgos), [contracts.md](contracts.md) (el tribunal como ejecutor, disputas, deber de venganza, juramentos ante el Cielo, pactos de vida o muerte), [organizations.md](organizations.md) (normas y penas internas, poder disciplinario, por encima de la ley, vendetta institucional, bandas), [social-structure.md](social-structure.md) (protecciones y capacidad por estatus, quién puede declarar, castigos desiguales, servidumbre penal), [economy.md](economy.md) (lotes con origen, multas, sobornos, mercado negro, monopolios, casas de empeño), [schemes.md](schemes.md) (crímenes planeados, inculpar a otro, borrar huellas), [body-health.md](body-health.md) (heridas del castigo, tortura, causas de muerte para el forense), [cultivation.md](cultivation.md) (sellar y abolir el cultivo, búsqueda del alma), [discovery.md](discovery.md) (saber forense como conocimiento cultural), [heaven-karma.md](heaven-karma.md) (el Cielo lee la verdad, no la sentencia), [family-lineage.md](family-lineage.md) (herencia, adulterio, incesto como crimen; castigo a la familia). Lo usan: [contracts.md](contracts.md) (tribunales, prueba, fraude), [economy.md](economy.md) (mercado negro, contrabando), [crafts.md](crafts.md) (contrabando, falsificación), [organizations.md](organizations.md) (tensión secta–estado), [social-structure.md](social-structure.md) (penas por estamento), [family-lineage.md](family-lineage.md) (disputas de herencia, adulterio), [state.md](state.md) (magistrados, burocracia, códigos imperiales), [war.md](war.md) (ley marcial, crímenes de guerra), [divination.md](divination.md) (leer culpables), y [chronicle.md](chronicle.md) (juicios célebres, injusticias recordadas).

## Principios
1. **La ley es gente con creencias.** No hay un motor que aplique un código: hay normas en `content/` que la gente cree (o no conoce), y personas con puestos (jueces, alguaciles, ancianos, ejecutores de secta) que deciden con su utilidad. Una ley que nadie aplica no existe en la práctica.
2. **El daño es verdad; el crimen es una categoría cultural.** Que A mató a B es un hecho en `WorldTruth`. Que eso sea asesinato, defensa legítima, venganza debida o derecho del señor depende del código de cada cultura y jurisdicción. El Cielo lee el daño y la intención reales (heaven-karma), no la sentencia.
3. **La justicia trabaja sobre creencias.** Nadie juzga con la verdad: juzga con lo que cree después de huellas, testigos, documentos y confesiones. Hay culpables que se van libres e inocentes condenados, y ninguno de los dos es un error del sistema: es el sistema.
4. **Jurisdicciones superpuestas.** La familia, el clan, la aldea, el gremio, la secta, el templo y el estado reclaman juzgar. Quién juzga de verdad sale del poder, la membresía y la negociación, y elegir foro es una estrategia.
5. **Castigar cuesta y conserva.** La multa sale de una tenencia y entra en otra; la cárcel come; el verdugo es una persona; la persecución cuesta hombres y días. Una autoridad sin recursos no castiga, aunque quiera.
6. **La vendetta es la justicia por defecto.** Donde no llega una autoridad, la víctima y su familia se cobran solas (contracts: deber de venganza). Los tribunales compiten con la vendetta y le ganan solo cuando tienen fuerza y legitimidad.
7. **La corrupción no se escribe: emerge.** Jueces, guardias y testigos tienen utilidad. Cuando el soborno, la presión de un poderoso o el favor de un pariente pesan más que el miedo o los valores, la justicia se tuerce, con huellas.
8. **Determinista.** `rng.fork("case", caseId, step)` para las tiradas de investigación y juicio; `rng.fork("crime", communityId, period)` para crímenes en modo agregado. Nada más es azar.

## 1. Códigos

```ts
interface LegalCode {                       // en content/ o creado en la historia
  id: CodeId;
  jurisdiction: JurisdictionId;
  source: "custom" | "edict" | "sect_statute" | "religious" | "guild_rule" | "treaty";
  written: boolean;                         // escrito (documento, se puede consultar, falsificar, perder) u oral (memoria de ancianos)
  norms: LegalNorm[];
  procedures: ProcedureId[];                // cómo se juzga (§6)
  originEventId: EventId;                   // el edicto, la fundación, la costumbre que nació de algo
}

interface LegalNorm {
  id: NormId;
  act: ActPattern;                          // matar, herir, robar, adulterio, blasfemia, contrabando de sal, usar técnica prohibida, faltar al superior
  conditions?: Condition[];                 // de noche, en casa ajena, con arma, contra un superior, en tiempo de luto
  justifications?: Justification[];         // defensa, venganza de padre, orden del señor, pacto de vida o muerte
  statusModifiers: StatusModifier[];        // la pena según el estatus del autor y de la víctima (social-structure §2)
  penalty: PenaltySchedule;                 // §8
  accusers: AccuserRule[];                  // quién puede denunciar: la víctima, la familia, cualquiera, solo un funcionario
  proof: ProofStandard;                     // qué hace falta: confesión, dos testigos, un testigo noble, flagrancia, juramento
  collective?: CollectiveRule;              // castigo extendido a familia, aldea o maestro (株连)
  limitation?: Duration;                    // prescripción, si existe
}
```

- **La ley es conocimiento.** La gente conoce las normas que le contaron, las que vio aplicar y lo que cree que dice el código. El campesino no sabe que el edicto cambió; el escribano sí, y eso vale plata. Un código escrito se puede leer (si sabés leer), citar, falsificar o perder.
- **Las normas se contradicen** entre jurisdicciones (la costumbre del clan manda vengar al padre; el edicto prohíbe la venganza privada) y dentro de un mismo código (artículos ambiguos). Los jueces eligen, y su elección es una decisión con sesgos.
- **Lo prohibido refleja la historia.** Una cultura que sufrió a un cultivador demoníaco prohíbe las técnicas de sangre; una con monopolio de sal castiga el contrabando con la muerte. Cada norma tiene la causa de su origen.

## 2. El crimen como evento
- **El acto** es un evento en la verdad, con sus causas (el motivo, la oportunidad, la intriga: schemes) y sus huellas (perception §9).
- **El caso** existe solo cuando alguien **cree** que hubo un delito y decide hacer algo. Sin víctima que hable, testigo que cuente ni cuerpo que aparezca, el crimen no entra en ninguna justicia humana (el Cielo lo anota igual, si existe).
- **Cifra negra:** la mayoría de los delitos chicos nunca se denuncian. La víctima calcula: costo de denunciar, chance de ganar, miedo a la venganza, vergüenza (el adulterio, la violación en culturas que culpan a la víctima), desconfianza del juez. Todo es utilidad (npc-psychology §7).
- **Delitos sin víctima que se queje:** contrabando, blasfemia, técnicas prohibidas, adulterio consentido. Dependen de informantes, de funcionarios celosos o de enemigos que los usan como arma.

## 3. Jurisdicciones

```ts
interface Jurisdiction {
  id: JurisdictionId;
  authority: OrgId | PositionId;            // el magistrado del condado, el salón de disciplina de la secta, el jefe del clan
  territory?: RegionRef;
  persons?: PersonScope;                    // miembros de la organización, un estatus, todos los que estén en el territorio
  matters?: ActPattern[];                   // qué juzga: todo, solo lo interno, solo deudas, solo herejía
  code: CodeId;
  capacity: EnforcementCapacity;            // alguaciles, soldados, cultivadores, cárcel, presupuesto (de la tenencia de la autoridad)
  legitimacy: CommunityBeliefRef;           // cuánto la gente cree que tiene derecho a juzgar
}
```

- **Superposición:** un discípulo de secta que roba en el mercado de un pueblo cae en la jurisdicción del magistrado (territorio), de su secta (persona) y quizás del gremio del mercader (materia). Quién juzga de verdad sale de quién reclama, quién tiene fuerza para traerlo y qué negocian.
- **Elegir foro:** la víctima va donde cree que gana (el gremio si el ladrón es de afuera, el clan si el juez es enemigo). El acusado busca refugio donde no lo alcancen: un templo con derecho de asilo, su secta, otro condado.
- **Pedir a alguien:** una autoridad pide a otra que le entregue a un acusado. Entregarlo es una decisión política (organizations §4): cara, relación, costo de negarse.
- **Fronteras** de jurisdicción son fronteras de huida. Cruzarlas cambia el código, el juez y lo que se sabe de vos.

## 4. Denuncia y caso

```ts
interface Case {
  id: CaseId;
  forum: JurisdictionId;
  accuser?: AgentId | OrgId;                // víctima, familia, funcionario, informante (con recompensa), enemigo (con motivo)
  accused: AgentId[];                       // pueden ser los equivocados
  claimed: NormId[];                        // lo que se dice que pasó
  facts: EventId[];                         // los hechos que el caso toca en la verdad (para el inspector; nadie del mundo los ve)
  evidence: EvidenceItem[];                 // huellas, objetos, documentos, testimonios, confesiones, lecturas de alma
  investigators: AgentId[];
  judge?: AgentId;
  pressures: PressureOnCase[];              // sobornos, presiones de poderosos, amenazas, parentesco con el juez
  status: "reported" | "investigating" | "trial" | "decided" | "appealed" | "dropped" | "settled";
  verdict?: Verdict;
  originEventId: EventId;                   // la denuncia
}
```

- **Denunciar cuesta:** viajar al juzgado, pagar tasas, perder días de trabajo, exponerse. Un pobre contra un rico rara vez llega.
- **Denuncias falsas** son una herramienta de intriga (schemes): inculpar a un rival, cobrar la recompensa del informante, sacarse de encima a un acreedor. Dejan huellas propias y riesgo si se descubren (muchos códigos castigan al falso denunciante con la pena que pedía).
- **Arreglo:** muchas disputas terminan antes del juicio con compensación privada, mediación de ancianos o matrimonio. El caso queda `settled` y la justicia formal ni se entera.

## 5. Investigación
Investigar es una secuencia de acciones de personas concretas con habilidad, sesgos y poco tiempo:
- **Huellas** (perception §9): el lugar, el cuerpo, las heridas, el residuo de qi de una técnica, objetos movidos. Las ve quien sabe mirar y las interpreta quien sabe qué significan.
- **Saber forense** como conocimiento cultural (discovery): una cultura puede tener manuales de forense (cómo distinguir un ahogado de un muerto tirado al agua, el veneno por el color de los huesos) y otra creer que el muerto sangra cuando se acerca su asesino. Los dogmas forenses equivocados condenan inocentes con método.
- **Testigos:** recuerdan con la memoria de npc-psychology §5 (se deforma, se contamina con lo que oyeron, se acomoda a lo que creen). Mienten por miedo, lealtad, soborno o odio. Su peso depende del estatus (social-structure) y de lo que el juez cree de ellos.
- **Documentos:** contratos, registros, cartas, libros de cuentas (information). Se falsifican y se pierden; un buen falsificador es un oficio.
- **Rastrear bienes:** los lotes tienen origen (economy §1). La joya robada aparece en una casa de empeño; la plata con la marca del tesoro de la secta aparece en el bolsillo del discípulo. Quien sabe reconocer marcas sigue el rastro.
- **Interrogatorio y tortura:** presión psicológica, amenazas, tortura donde la cultura la permite. La tortura produce confesiones, no verdad: el que confiesa dice lo que el torturador quiere oír, y el cuerpo queda dañado (body-health).
- **Métodos de cultivadores:** leer el alma (búsqueda del alma: daña o mata al leído; muchas culturas la prohíben), rastrear un aura, adivinación ([divination.md](divination.md): lectura ruidosa del grafo causal), lectura de karma. Son caros, raros y también se engañan (sellos, técnicas de ocultamiento, memorias falsas implantadas).
- **Contramedidas:** limpiar huellas, sobornar o matar testigos, inculpar a otro, coartadas preparadas, huir, pedir protección a un poderoso. Cada una deja sus propias huellas si se hace mal.
- **El investigador decide con utilidad:** cuánto esforzarse (su carga de trabajo, la presión de arriba, el estatus de la víctima), a quién sospechar (sus sesgos: el forastero, el pobre, el enemigo de su patrón) y cuándo cerrar el caso.

## 6. Procedimiento y prueba

| Procedimiento | Dónde | Cómo decide | Defectos |
|---|---|---|---|
| **Magistrado inquisitivo** | Estados burocráticos | Un juez investiga, interroga y decide; suele exigir confesión | Tortura, soborno, carga de casos, sesgos del juez |
| **Consejo de ancianos** | Aldeas, clanes | Deliberación pública; pesa la reputación de las partes | Favorece a las familias fuertes; venganzas entre ramas |
| **Asamblea o jurado** | Algunas culturas | Votan los pares | Rumores, oratoria, sesgo de grupo |
| **Ordalía** | Culturas que creen en un juicio divino | Agua, fuego, hierro candente | Se resuelve con la física: el resultado no tiene que ver con la culpa (salvo en mundos con un dios juez real: metaphysics) |
| **Juramento** | Casi todas | Jurar ante el Cielo, los ancestros o un dios | El que no cree jura sin miedo; el karma cae si existe, pero después |
| **Combate judicial** | Culturas guerreras, cultivadores | Gana el más fuerte o su campeón | Justicia del fuerte; contratar campeones |
| **Disciplina de secta** | Sectas | Salón de disciplina, anciano a cargo (organizations §8) | La facción del acusado pesa más que la prueba |

- **Estándares de prueba** por código: confesión obligatoria, dos testigos hombres libres, flagrancia, palabra de un noble contra la de un siervo. Cuando el estándar no se puede cumplir, el juez presiona para conseguirlo (tortura, testigos comprados) o suelta al acusado.
- **El juez decide con creencias:** actualiza lo que cree con cada prueba (information §1), con el peso que su cultura y sus sesgos le dan a cada fuente, y después pesa su utilidad: lo que cree que pasó, lo que le conviene, lo que va a decir la gente, lo que quiere su superior.
- **El veredicto es un evento** con causas (pruebas, presiones, la decisión del juez) y abre consecuencias: castigo, compensación, apelación, resentimiento del condenado y de su familia, reputación del juez.
- **Apelación:** subir a una instancia más alta cuesta y tarda; existe donde hay jerarquía de tribunales ([state.md](state.md) §5).

## 7. Corrupción
- **Soborno:** plata que pasa de una tenencia a otra (conservación), con huellas en los libros y en los gastos repentinos del juez. Cuánto acepta un juez sale de su utilidad: salario, deudas, valores, riesgo creído de que se sepa, ejemplo de sus colegas.
- **Presión de poderosos:** el anciano de una secta "pide" que se suelte a su discípulo; el terrateniente le recuerda al magistrado quién le consiguió el puesto. No hace falta plata: alcanza con la relación y el miedo.
- **Parentesco y redes:** el juez es primo del acusado, el alguacil le debe un favor (contracts). Las culturas con normas de recusación las cumplen a medias.
- **Captura:** cuando una organización (un clan, una secta, un gremio, una banda) controla a los que juzgan en un lugar, la ley local es la suya.
- **Reputación del tribunal** por comunidad (information §9): "el magistrado Li es justo", "en ese condado se compra todo". La gente decide si denunciar y a dónde ir con esa creencia, así que un tribunal corrupto pierde casos frente a la vendetta y la mediación.
- **Limpiezas:** un inspector de arriba, un escándalo, un juez nuevo e incorruptible. Son eventos con causa ([state.md](state.md) §5) y amenazan a muchos, que reaccionan.

## 8. Castigos

| Castigo | Costo para quien castiga | Efectos |
|---|---|---|
| Multa | Ninguno; ingresa a la tenencia de la autoridad | Pobreza, deuda, servidumbre por deudas si no puede pagar |
| Compensación a la víctima (precio de sangre) | Ninguno | Pasa de una familia a otra; puede cerrar una vendetta |
| Azotes, palos | Verdugo | Heridas, infección, muerte a veces (body-health) |
| Mutilación, marca a fuego | Verdugo | Secuelas permanentes, estigma visible (social-structure §3) |
| Trabajo forzado, servidumbre penal | Guardias, comida | Trabajo para la autoridad (obras, minas); `Bondage` penal (social-structure §7) |
| Cárcel | Edificio, guardias, comida | Rara y cara en mundos preindustriales; enfermedades; sobornos para comer |
| Destierro | Escolta hasta la frontera | Pierde hogar, tierra, red; puede volver con otro nombre |
| Muerte | Verdugo, ceremonia | Familia en duelo, deuda de sangre con el juez si fue injusta |
| Sello o abolición del cultivo | Un cultivador más fuerte | El cultivador cae al mundo mortal (social-structure §8) |
| Castigo a la familia o al maestro (株连) | Lo mismo multiplicado | Resentimiento extendido, huidas preventivas |
| Humillación pública (picota, cangue) | Poco | Pérdida de cara, que pesa más que el dolor en culturas de cara |

- **Ejecutar la pena es una acción de personas:** el guardia sobornado que deja escapar, el verdugo que golpea suave por plata, el alcaide que vende comida. Cada una deja huellas y riesgos.
- **Penas desiguales:** el código y el juez castigan distinto por estatus (social-structure §2). La gente percibe la diferencia; alimenta resentimiento contra la jerarquía (social-structure §10).
- **El castigo enseña, o no:** la gente que lo ve actualiza lo que cree sobre la chance de ser atrapado y el costo. Una autoridad que castiga poco y mal tiene más crimen, con causa.

## 9. Vendetta contra tribunal
- **La vendetta** nace del deber de venganza (contracts §11) y de la cara. Puede escalar durante generaciones con memoria contada que se deforma (npc-psychology: rencor entre generaciones).
- **Cerrarla:** precio de sangre, mediación, matrimonio entre las familias, exilio del culpable, entrega del culpable a la familia, o el exterminio de un bando.
- **El tribunal quiere el monopolio** de castigar y prohíbe la venganza privada; la gente la sigue haciendo cuando no confía en el tribunal, cuando la norma de su cultura manda vengar, o cuando el culpable está fuera del alcance de la ley. El juez decide si castigar al vengador (y pierde legitimidad ante los que creían en el deber de vengar) o mirar a otro lado.
- **Pactos de vida o muerte (生死状)** entre cultivadores: un duelo pactado ante testigos que libera de la venganza. Lo respetan quienes reconocen el pacto; la familia del muerto no siempre.

## 10. Por encima de la ley
- **Quien tiene poder suficiente no comparece.** Un cultivador fuerte, una secta, un noble con soldados: el magistrado mortal no puede traerlos, y lo sabe. La justicia que les llega es la de otros poderosos (su secta, otra secta, el estado con sus propios cultivadores: [state.md](state.md) §10) o la del Cielo.
- **Negociación entre poderes:** el estado y las sectas tienen acuerdos explícitos o tácitos (contracts: tratados) sobre quién juzga a quién. Se rompen cuando cambia la fuerza relativa o cuando un caso toca demasiada cara.
- **El magistrado frente al cultivador:** puede pedir a la secta, sobornar a otro cultivador, esperar a que el culpable esté en reclusión, o dejarlo. Cada salida es una decisión con utilidad y riesgos.
- **Los de abajo lo saben:** "la ley es para los mortales" es una creencia con fracción en cada comunidad, alimenta la desconfianza en el tribunal y la búsqueda de protectores.

## 11. Justicia interna de las organizaciones
- Detalle en [organizations.md](organizations.md) §8: normas del estatuto, investigación de faltas, penas con sesgo, poder disciplinario. Este doc pone el resto del modelo: códigos, casos, prueba, corrupción y castigos usan las mismas estructuras con `jurisdiction` = la organización.
- **Casos entre organizaciones:** un discípulo de una secta mata al de otra. No hay tribunal común: hay diplomacia (organizations §10), compensación, entrega del culpable, duelo o guerra. A veces una secta mayor arbitra (y cobra).

## 12. Contrabando y mercado negro
- **Prohibido y monopolizado** por código: sal, hierro, armas, piedras espirituales sin sello del estado, técnicas demoníacas, venenos, partes de bestias protegidas, almas, personas. La prohibición sube el precio (economy §5) y con él la ganancia de saltearla.
- **Contrabando** es comercio por rutas (economy §7) evitando puestos de control: caminos de montaña, sobornos a aduaneros, compartimentos ocultos, anillos espaciales (que los guardias mortales no pueden revisar). Cada puesto es una persona con utilidad.
- **Mercado negro** (economy §5): lugares (patios traseros, ferias de medianoche, casas de empeño que no preguntan), redes de confianza (hay que conocer a alguien) y precios con prima de riesgo. Los **reducidores** compran lo robado barato, borran marcas y lo revenden: borrar la procedencia de un lote es un oficio.
- **Lo robado tiene historia.** El lote conserva su origen en la verdad; las marcas se borran o no. Un objeto famoso (la espada del anciano) es difícil de vender cerca.

## 13. El crimen como oficio y como organización
- **Ladrones, estafadores, falsificadores, asesinos a sueldo, contrabandistas:** oficios con habilidad, herramientas, aprendices y reputación propia (crafts, organizations §9).
- **Bandas y sociedades:** bandidos que nacen del hambre, gremios de ladrones, redes de contrabando, tríadas (organizations). Tienen sus propias normas y su propia justicia (la traición se paga con la vida).
- **Protección:** una banda que cobra tributo a un mercado (economy §14) es una jurisdicción de hecho. Si protege mejor que el magistrado, la gente le cree más.

## 14. Cómo cambia la ley
- **Edictos** de quien tiene autoridad ([state.md](state.md) §11), **reglas nuevas** de una secta después de un escándalo, **costumbres** que nacen de un precedente famoso. Toda norma nueva tiene `originEventId`.
- **Conocerla tarda:** el edicto viaja como noticia (information §4). Durante meses se juzga con la ley vieja, o con una mezcla, según lo que sepa el juez.
- **Reformas y retrocesos** salen de presiones: crimen que crece, revueltas (social-structure §10), un juicio injusto que se vuelve escándalo, el interés de un poderoso.

## 15. El jugador y el narrador
- **El jugador puede cometer cualquier delito** y queda expuesto a lo mismo que un NPC: huellas, testigos, denuncia, investigadores, venganza. También puede ser acusado de algo que no hizo.
- **Puede usar la justicia:** denunciar, investigar (seguir huellas, interrogar, rastrear un objeto robado), sobornar, buscar un foro mejor, pedir asilo, hacerse informante, ser juez si llega a tener el puesto.
- **Conoce la ley como creencia:** lo que sabe de las normas de su cultura y de dónde está. Puede no saber que algo es delito acá.
- **El narrador** cuenta el juicio desde lo que el personaje percibe: lo que dicen los testigos, la cara del juez, el veredicto. Nunca revela la verdad del caso ni quién sobornó a quién si el personaje no lo sabe. La crónica final ([chronicle.md](chronicle.md) §5) sí puede contar lo que nunca supiste.

## 16. Escala (LOD)
- **Tier 0-1:** tasas de delito por comunidad que salen de presiones (pobreza, desigualdad, densidad, presencia de bandas, castigo percibido); fracción denunciada y fracción resuelta según capacidad y reputación de las jurisdicciones; flujo de multas y presos; contrabando como flujo por ruta con prima de riesgo.
- **Tier 2+:** `Case` individuales con investigadores, pruebas y jueces; vendettas como cadenas de eventos entre familias concretas.
- **Materialización:** cuando el jugador se acerca a un caso agregado (un robo en la ciudad, un preso en la cárcel), se materializan los involucrados con hechos coherentes con las tasas.

## Implementación
- **Fase 1:** huellas mínimas (sangre, objetos movidos), testigos que vieron, robo y pelea con consecuencias sociales directas (la víctima reclama, la aldea se entera). **Hecho (2026-10-07):** `sim/law` (`Deed` en `KNOWN_DEEDS`, `notoriety`, `Trace` como entidad `trace:n`) y `game/life/deeds.ts`: al cerrar cada paso, los vecinos que lo perciben (vista u oído, con su atención: dormido casi no se entera) guardan el hecho, con quién fue si lo reconocieron, y lo cuentan a su casa; la víctima de una pelea o a la que agarraron con la mano adentro sabe quién fue. La fama es la fracción de la aldea que sabe algo de alguien: baja el margen del trato (`NOTORIETY_EDGE`) y cierra pedidos y saludos fríos en el diálogo. Las peleas dejan sangre que se borra sola (vida media 36 h) y se ve en la escena. Queda para después: objetos movidos y robo de despensas (necesitan creencias sobre lo que se tiene), reclamo activo de la víctima y legítima defensa (Fase 2-3).
- **Fase 2:** testigos con memoria deformada y mentiras, acusaciones en el diálogo, culpa por el delito propio. **Parte pura hecha (2026-10-08):** `sim/law/testimony.ts` (recordar deformado, mentir, declarar, pesar acusaciones, culpa); falta cablearla al juego y al diálogo (ver ROADMAP).
- **Fase 3:** consejo de ancianos como primera jurisdicción, `Case` con denuncia, investigación simple, compensación y castigos de aldea; vendettas entre familias; casas de empeño y rastreo de lotes robados.
- **Fase 4:** cultivadores y la ley: salón de disciplina de la secta, sello y abolición del cultivo, búsqueda del alma, residuos de qi como prueba.
- **Fase 5:** varias jurisdicciones y fronteras; contrabando por rutas, puestos de control, mercado negro regional.
- **Fase 6:** jurisdicciones superpuestas entre secta, gremio y clan; pedidos de entrega entre organizaciones; bandas y gremios de ladrones.
- **Fase 8:** códigos del estado, magistrados, cárceles, apelaciones, inspectores, edictos que viajan.

## Tests
- **Sin caso sin creencia:** un asesinato sin testigos, sin cuerpo encontrado y sin huellas leídas no genera `Case`; el karma (si existe) lo anota igual.
- **Inocentes condenados:** con pruebas plantadas y un juez sesgado, una corrida headless produce condenas de inocentes con causa rastreable en el inspector.
- **Conservación:** multas, compensaciones y sobornos mueven plata entre tenencias sin crearla; la cárcel consume comida de alguien.
- **Jurisdicción con fuerza:** un tribunal sin capacidad para traer al acusado no puede ejecutar la sentencia; la sentencia queda como creencia y presión.
- **Corrupción emergente:** con salarios bajos y riesgo bajo, la fracción de jueces que acepta sobornos sube; con inspecciones, baja.
- **Vendetta contra tribunal:** en comunidades con tribunal de mala reputación, sube la fracción de disputas resueltas por vendetta.
- **Ordalías físicas:** en un mundo sin dios juez, el resultado de la ordalía no se correlaciona con la culpa real.
- **Determinismo:** mismo seed, mismas acciones → mismos casos, pruebas, veredictos y vendettas.

## Decisiones tomadas en este borrador (revisables)
- La ley es normas en `content/` más personas con puestos que deciden con utilidad; no hay motor de justicia.
- Los tribunales juzgan con creencias; nadie del mundo lee la verdad salvo con técnicas metafísicas caras, engañables y casi siempre prohibidas.
- Las ordalías se resuelven con la física salvo en mundos con un dios juez real.
- La vendetta es la justicia por defecto y compite con los tribunales por legitimidad.
- Los castigos cuestan recursos reales a quien castiga; sin recursos no hay castigo.
- El crimen organizado usa el mismo modelo de organizaciones, con su propia justicia.

## Preguntas abiertas
- Calibración: tasas de delito por presión (pobreza, desigualdad, castigo percibido) para que una aldea tenga robos chicos frecuentes y asesinatos raros.
- Calibración: fracción de denuncia y de resolución por tipo de jurisdicción; tasa de condenas de inocentes (que exista, pero que no sea la norma en un tribunal decente).
- Calibración: umbrales de soborno según salario, deudas y valores del juez.
- Calibración: duración y escalada de las vendettas; con qué frecuencia terminan en compensación, en matrimonio o en exterminio.
- Calibración: prima de riesgo del mercado negro y del contrabando por ruta según la presión de control.

## Implementado (2026-10-09): quién emite `law.inquiry`

La pregunta de quien habla es la primera fuente: en `life.converse`, si el acto entendido es un `ask` y quien pregunta conoce un hecho (`deedAsked`: por la persona nombrada o, sin nombre, el último sin autor conocido; nunca uno que el testigo hizo), el proceso emite `law.inquiry` con el acto de habla como causa y `life.testify` hace declarar al testigo desde lo que recuerda. Valen el jugador y los NPC. Faltan el vecino o la víctima que interroga a los testigos y el juez o alguacil (ROADMAP).

## Implementado (2026-10-09): soborno y presión del interrogatorio

`law.inquiry` puede llevar una `offer` (`{ unit, grams }`) además del `bribe` dado: solo vale si la unidad es dinero y quien pregunta tiene esos gramos en el ledger (`validOffer`), y pesa para el testigo `bribeValue(grams) = g / (g + 10)`. Si el testigo termina mintiendo por ella (`lie.motive = bribe`), `life.testify` asienta el pago de quien preguntó al testigo contra el evento `law.testimony` (que lo cita en `data.paid`); contar la verdad no se paga. La presión sale sola de la relación: el miedo del testigo hacia quien pregunta sube su honestidad (+0,4 por punto) y le quita miedo al culpable (-0,5 por punto), así que amenazar antes de preguntar (dialogue §9 escribe ese miedo en `RELATIONS`) vuelve más veraz al testigo. Constantes sin calibrar.

## Implementado (2026-10-09): la víctima que pregunta alrededor

`life.askAround` (`game/life/askaround.ts`, fase `decide`, diaria, por hogar sin el del jugador): el NPC que sabe de un hecho en que fue la víctima (`KNOWN_DEEDS`, dentro de 3 días) sale con chance 0,6 a preguntarle a alguien que cree cercano: gente con la que tiene trato (`RELATIONS`), viva, en su mismo lugar, que no sea el autor que él sabe (`whomToAsk`). Es lo que él cree, no quién presenció de verdad. Emite `law.inquiry` (causa: su `KNOWN_DEEDS`) y `life.testify` hace declarar. Falta el vecino sin ser víctima y la memoria de a quién ya preguntó (hoy repite a un testigo por día dentro de la ventana).

## Implementado (2026-10-09): acusación y verdad

`life.converse` marca en el efecto del `action.speak` de una acusación `accusation.truthOf.occurred` (`accusationOccurred`: lo hizo de verdad según el `OWN_DEEDS` del acusado; solo lo lee el inspector, ninguna decisión pasa por ahí). Si no ocurrió, emite además el evento `law.false_accusation` (actores [quien acusó, acusado], causa el acto de habla; datos: hecho, víctima, firmeza, quién oyó, `unbacked`): es la huella de la denuncia falsa. Falta que esa huella pese (reputación de quien acusó, caso de ley): ROADMAP.
