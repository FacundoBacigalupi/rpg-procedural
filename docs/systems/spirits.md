# Espíritus

> Nota: este doc describe la **familia xianxia**. Otras familias de mundos cambian estas reglas; ver [metaphysics.md](metaphysics.md).

> Los espíritus existen, pero ninguno aparece porque sí. Al morir, un alma normalmente vuelve al ciclo del Cielo. Un espíritu es **un alma (o una conciencia) que no volvió porque algo la ancla**, o una conciencia que nació de algo que acumuló qi durante mucho tiempo. Ese "algo" es siempre una causa concreta que se puede descubrir.

Depende de: [heaven-karma.md](heaven-karma.md) (el ciclo del Cielo), [npc-psychology.md](npc-psychology.md) (memoria, objetivos, emociones), [planet-gen.md](planet-gen.md) (qi yin, tesoros naturales).

## 0. Volverse espíritu es difícil
Tener un objetivo fuerte o odiar a alguien **no alcanza**. Al morir, las Fuentes Amarillas (黄泉) arrastran el alma hacia el ciclo, y quedarse es **resistir esa fuerza**. Un espíritu se forma solo si se cumplen **todas** estas condiciones a la vez:

1. **Alma con fuerza suficiente.** El alma de un mortal es débil y se dispersa en horas o días. El cultivo (sobre todo el de alma) la fortalece. Por eso casi todos los espíritus fuertes fueron cultivadores.
2. **Un ancla real**, y de una intensidad enorme: una emoción en el pico de la escala, un objetivo que era el centro de la identidad (no uno más), un objeto preparado, una atadura impuesta.
3. **Un entorno que lo sostenga:** qi yin, un lugar con qi acumulado, un objeto capaz de contener un alma. Sin sustento, el alma se gasta resistiendo.
4. **Circunstancias de la muerte que la retengan:**
   - En contra: ritos funerarios correctos, ser llorado y enterrado, morir en paz.
   - A favor: morir lejos y sin entierro, por violencia o traición, en un lugar con muchas otras muertes, o sellado.

El resultado no es una tirada: es una comparación determinista entre `fuerza del alma × intensidad del ancla × sustento × circunstancias` y la **atracción de las Fuentes** (que depende de la fuerza del Cielo en ese mundo). El azar solo afina los márgenes. Un mortal común casi nunca queda, y si queda es débil y se desvanece pronto, salvo en una confluencia extrema (una masacre en un valle yin, sin ritos, con cientos de muertos a la vez).

## 1. Orígenes
| Tipo | Causa | Qué es |
|---|---|---|
| **Espíritu resentido** (怨灵) | Muerte con emoción extrema (odio, terror, injusticia) + alma suficiente + qi yin + circunstancias (ver §0) | El alma queda atada al lugar y a la emoción de su muerte. Fuerza = intensidad × qi yin. |
| **Asunto pendiente** | Un objetivo central para la identidad, sin cumplir, más las demás condiciones de §0 (un objetivo fuerte solo no alcanza) | El alma queda atada al **objetivo**. Si se cumple (por ella o por otro), se libera. Sale directamente de los objetivos en capas del modelo psicológico. |
| **Remanente de alma** (残魂) | Un cultivador con alma fuerte que, al morir, se refugió en un objeto (anillo, espada, jade) con una técnica | Conserva **memorias y conocimiento reales**: puede enseñar, mentir, negociar o intentar poseer un cuerpo. El clásico "viejo en el anillo" con causa. |
| **Espíritu de lugar** | Un sitio con mucho qi acumulado durante milenios (un tesoro natural, una montaña, un río viejo) que despierta conciencia | Espíritus de montaña, de río, de árbol antiguo. Están atados al lugar, lo protegen y lo sienten. Si el lugar se agota, se debilitan. |
| **Espíritu de objeto** (器灵) | Un arma o artefacto usado durante siglos, impregnado del qi y la intención de sus dueños | Tiene la personalidad que le dejaron sus usos (una espada que mató mucho es sanguinaria). Puede elegir dueño o rechazarlo. |
| **Espíritus fabricados** | Técnicas de cultivadores de almas: estandartes de almas, refinación de fantasmas, sacrificios | Almas capturadas y esclavizadas. Mucho karma. Si el que los ata muere o el objeto se rompe, quedan libres, y quizás resentidos. |
| **Muerte masiva** | Una batalla, masacre, plaga o desastre con miles de muertos en un lugar | Acumula qi yin y espíritus resentidos. Puede volverse una **zona maldita**: tierra de fantasmas donde los mortales no viven. |

**Fe y ofrendas:** la creencia de muchos (templos, incienso, rezos) **refuerza** a un espíritu que ya existe, porque concentra qi en el santuario. Pero **no crea** dioses de la nada. Un "dios local" es un espíritu real (de lugar, un remanente, un ancestro) que la gente alimenta con su culto.

## 2. Qué es un espíritu en la simulación
- Es un **agente** con una psicología reducida: memorias (sobre todo de su muerte o su origen), la emoción o el objetivo que lo ancla, y valores congelados. No crece como un vivo: cambia muy poco, salvo los de lugar y los remanentes.
- **Conservación:** se sostiene con qi (yin para los resentidos, el del lugar para los de lugar). Sin qi se desvanece y su qi vuelve al entorno.
- **Ancla:** cada espíritu tiene un `anchor` explícito (lugar, objetivo, objeto, atadura). Romper o cumplir el ancla lo libera o lo destruye.
- **Ver espíritus** depende de la percepción y el cultivo: un mortal siente frío o ve sombras, un cultivador los ve, uno de alma fuerte habla con ellos.

```ts
interface Spirit {
  id: AgentId;
  kind: "resentful" | "unfinished" | "remnant" | "place" | "object" | "bound";
  anchor: { place?: CellId; goal?: GoalId; object?: ItemId; binder?: AgentId };
  formerSelf?: AgentId;          // quién era en vida (si fue alguien)
  qi: number;                    // se sostiene y se desvanece con esto
  originEventId: EventId;        // la muerte, el despertar o la atadura
}
```

## 3. Verdad y creencia
- Que un lugar "esté embrujado" es una **creencia** de los aldeanos. Puede ser cierta (hay un espíritu resentido), falsa (eran bandidos que usaban el rumor) o deformada (hay un espíritu, pero no es lo que cuentan).
- Un remanente de alma puede mentir sobre quién fue: su historia es una memoria con autoengaño, como la de cualquier NPC.
- Los espíritus resentidos recuerdan su muerte como la vivieron, no como fue. Su venganza puede apuntar al culpable equivocado.

## 3b. El ciclo: las Fuentes Amarillas y la reencarnación
- Las almas que no quedan como espíritus cruzan las **Fuentes Amarillas** y vuelven a nacer. La reencarnación es real.
- **El karma no se hereda.** Cruzar las Fuentes lava las deudas kármicas: la nueva vida empieza limpia. Lo que **sí queda** está en los demás: quienes te odiaron o te amaron siguen recordándote, y un enemigo longevo puede reconocerte en tu nueva vida aunque vos no lo recuerdes.
- **Los recuerdos se lavan.** Cuánto sobrevive depende de la fuerza del alma: ver las opciones en las preguntas abiertas.
- Las almas se conservan: no se crean de la nada. La población de almas en el ciclo es parte del ledger (el Cielo las administra).

## 3c. Tu personaje como espíritu
- Morir **no siempre termina la partida.** Si se cumplen las condiciones de §0, seguís jugando como espíritu, atado a tu ancla, con las limitaciones de serlo: no podés tocar el mundo físico como antes, te sostenés con qi, te ven solo los que pueden.
- La partida termina cuando tu alma **cruza las Fuentes o se disipa**. Ahí se escribe la crónica.
- **A futuro, con el diseño de cultivo:** volver a ser humano (un cuerpo vacío, una posesión, reconstruir un cuerpo con tesoros), o cultivar como espíritu (camino de los fantasmas cultivadores). Queda abierto para ese doc.

## 3d. Recuerdos de vidas pasadas
Cruzar las Fuentes implica la sopa del olvido (孟婆汤). Cuánto se resiste combina cuatro mecanismos:
- **Fuerza del alma:** decide cuánto sobrevive. Un mortal no conserva nada, un alma media conserva sensaciones (miedos sin origen, talentos inexplicables) y un alma muy fuerte conserva recuerdos concretos.
- **Sellados, no borrados:** lo que sobrevive queda sellado y despierta con disparadores (lugares, personas, llegar al mismo reino de cultivo, estar al borde de la muerte). Primero llega en sueños y fragmentos.
- **Preparación:** sellos en el alma, jades de memoria o un discípulo que te reconoce mejoran lo que sobrevive. Cuestan y hay que planearlos.
- **Desafiar al Cielo:** un alma muy fuerte puede intentar rechazar la sopa. Es una rebelión como una tribulación: si falla, el alma queda dañada.

Son memorias con `source: "past-life"`, más distorsionadas que las normales.

## 3e. Si el jugador reencarna: lo que sabe el usuario y lo que sabe el personaje
El usuario recuerda todo aunque el personaje no. **No se le prohíbe nada** (libertad total), pero el conocimiento se equilibra solo:
- **El mundo siguió.** Entre la muerte y el renacer pasan décadas o siglos (lo decide la sim). Los tesoros se saquean, las sectas caen, los enemigos mueren o se fortalecen. Además, lo que sabías eran **creencias** de tu vida pasada, no verdades, y quizás eran falsas.
- **Saber no es poder hacer.** Técnicas, cultivo y habilidades viven en el cuerpo y el alma, no en el usuario. Hay que reentrenar todo. Saber el camino acelera, pero no salta etapas. La sim valida lo que el *personaje* puede hacer, como siempre.
- **Actuar con lo que sabés es un disparador.** Si tu alma conservó ese recuerdo (sellado), despierta de verdad y el personaje pasa a saberlo. Si no lo conservó, igual podés actuar (ir a la cueva), pero sin los detalles finos (cómo abrir el sello), que hay que redescubrir.
- **El mundo lo nota.** Un niño que va directo a una cueva escondida o habla de una secta extinta llama la atención: rumores, sospechas de un viejo monstruo reencarnado, y **los enemigos de tu vida pasada pueden estar buscando esas señales**. Usar tu conocimiento es poderoso y peligroso.

## 4. Consecuencias
- **Liberar un espíritu** (cumplir su asunto pendiente, vengar su muerte, enterrarlo bien) es un acto con karma positivo, y una fuente de misiones que salen del estado sin escribirlas.
- **Zonas malditas** cambian el mapa humano: abandono, tabúes, mitos. Purificarlas es una hazaña.
- **Remanentes:** un maestro escondido en un objeto es un aliado poderoso y un riesgo (quiere un cuerpo).
- **Cultivo de almas:** camino propio (técnicas yin, estandartes), con mucho karma y enemigos.

## 5. Escala
- Espíritus importantes (remanentes, espíritus de lugar grandes, resentidos fuertes): agentes completos.
- Espíritus menores de una zona maldita: población agregada (tier 0) con fuerza total y humor colectivo.

## Implementación
- **Fase 4 (cultivo):** almas, muerte con ancla, resentidos y asuntos pendientes, percepción de espíritus.
- **Fase 6-7:** remanentes, espíritus de objeto, cultivo de almas, zonas malditas en la historia.
- **Fase 8:** espíritus de lugar con facciones, cultos y religiones locales.

## Tests
- Ningún espíritu sin `originEventId` ni `anchor`.
- Conservación: el qi de un espíritu sale del entorno y vuelve al desvanecerse.
- Cumplir el objetivo ancla libera al espíritu.

## Preguntas abiertas
- ¿Cuánto tiempo pasa en las Fuentes antes de renacer, y de qué depende?
- Cultivo de espíritus y volver a ser humano: en el doc de cultivo.
