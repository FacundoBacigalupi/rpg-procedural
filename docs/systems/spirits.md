# Espíritus

> Los espíritus existen, pero ninguno aparece porque sí. Al morir, un alma normalmente vuelve al ciclo del Cielo. Un espíritu es **un alma (o una conciencia) que no volvió porque algo la ancla**, o una conciencia que nació de algo que acumuló qi durante mucho tiempo. Ese "algo" es siempre una causa concreta que se puede descubrir.

Depende de: [heaven-karma.md](heaven-karma.md) (el ciclo del Cielo), [npc-psychology.md](npc-psychology.md) (memoria, objetivos, emociones), [planet-gen.md](planet-gen.md) (qi yin, tesoros naturales).

## 1. Orígenes
| Tipo | Causa | Qué es |
|---|---|---|
| **Espíritu resentido** (怨灵) | Muerte con emoción muy intensa (odio, terror, injusticia) + qi yin en el lugar | El alma queda atada al lugar y a la emoción de su muerte. Fuerza = intensidad × qi yin. |
| **Asunto pendiente** | Un objetivo muy fuerte sin cumplir al morir (vengarse, proteger a un hijo, entregar un mensaje) | El alma queda atada al **objetivo**. Si se cumple (por ella o por otro), se libera. Sale directamente de los objetivos en capas del modelo psicológico. |
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
- **¿Qué pasa con el alma al volver al ciclo?** ¿Reencarnación real (con karma heredado, recuerdos de vidas pasadas en casos raros)? Conecta con el archivo de crónicas de vidas pasadas.
- **¿Tu personaje puede volverse espíritu al morir?** La regla es una sola vida, así que no sería jugable, pero podría quedar como un espíritu en el mundo para la crónica (o para una partida futura en el mismo mundo).
