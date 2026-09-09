/**
 * La parte no obvia de LILA-207: `modeling.createShape` no busca padre, así que `insertar` tiene
 * que elegirlo. Colgar una tarea de una `bpmn:Collaboration` —la raíz visible de cualquier modelo
 * con pools, incluido el `examples/pedido` que la app abre de serie— revienta el `BpmnUpdater`
 * («Cannot read properties of undefined (reading 'push')») y deja el modelo a medias.
 *
 * Sin estas pruebas, cambiar la búsqueda de padre por `canvas.getRootElement()` deja la suite
 * entera en verde y rompe la app en su primer clic.
 */
import { describe, expect, it, vi } from 'vitest';
import { filtrar, gruposDeFiguras, insertar, type Figura } from './Paleta';
import type { Servicios } from './Modeler';
import { setLocale } from './i18n';

const RAIZ = { id: 'Collaboration_1' };
const POOL = { id: 'Pool_1', x: 0, y: 0, width: 600, height: 300 };
const TAREA: Figura = { tipo: 'bpmn:UserTask', nombre: 'Tarea de usuario', icono: 'user-task' };

/** `admite` decide, como las reglas de bpmn-js, quién puede contener a la figura. */
function servicios(vista: { x: number; y: number; width: number; height: number }, admite: (target: unknown) => boolean) {
  const createShape = vi.fn((forma: unknown, posicion: unknown, target: unknown) => ({ forma, posicion, target }));
  const activate = vi.fn();
  const scrollToElement = vi.fn();
  return {
    createShape, activate, scrollToElement,
    servicios: {
      elementFactory: { createShape: (atributos: object) => ({ ...atributos }), createParticipantShape: () => ({ pool: true }) },
      modeling: { createShape },
      canvas: { viewbox: () => vista, getRootElement: () => RAIZ, scrollToElement },
      directEditing: { activate },
      elementRegistry: { filter: () => [POOL] },
      rules: { allowed: (_accion: string, ctx: { target: unknown }) => admite(ctx.target) },
    } as unknown as Servicios,
  };
}

describe('insertar (LILA-207)', () => {
  it('cuelga la figura del pool que hay bajo el centro visible, no de la colaboración', () => {
    // Centro visible (300, 150): dentro del pool. La colaboración no admite tareas.
    const s = servicios({ x: 0, y: 0, width: 600, height: 300 }, (target) => target === POOL);
    insertar(s.servicios, TAREA);
    expect(s.createShape).toHaveBeenCalledWith(expect.anything(), { x: 300, y: 150 }, POOL);
    expect(s.activate).toHaveBeenCalledOnce();
  });

  it('con el centro visible fuera de todo pool baja al pool y lo trae a la pantalla', () => {
    // Centro visible (300, 2150): el lienzo está desplazado muy por debajo del diagrama.
    const s = servicios({ x: 0, y: 2000, width: 600, height: 300 }, (target) => target === POOL);
    insertar(s.servicios, TAREA);
    // Centro del pool, no el de la vista, y nunca la raíz.
    expect(s.createShape).toHaveBeenCalledWith(expect.anything(), { x: 300, y: 150 }, POOL);
    expect(s.scrollToElement).toHaveBeenCalledOnce();
  });

  it('en un proceso simple —sin pools— sí cuelga de la raíz', () => {
    const s = servicios({ x: 0, y: 0, width: 600, height: 300 }, () => true);
    (s.servicios as unknown as { elementRegistry: { filter: () => unknown[] } }).elementRegistry.filter = () => [];
    insertar(s.servicios, TAREA);
    expect(s.createShape).toHaveBeenCalledWith(expect.anything(), { x: 300, y: 150 }, RAIZ);
  });
});

describe('filtrar (LILA-207)', () => {
  it('ignora acentos y mayúsculas: «anotacion» encuentra «Anotación»', () => {
    // En español, que es donde el catálogo tiene acentos; en inglés lo mismo lo comprueba
    // `App.test.tsx` sobre la paleta ya pintada.
    setLocale('es');
    const grupos = filtrar(gruposDeFiguras(), 'ANOTACION');
    expect(grupos.map((g) => g.figuras.map((f) => f.nombre))).toEqual([['Anotación']]);
    setLocale('en');
    expect(filtrar(gruposDeFiguras(), 'annotation').flatMap((g) => g.figuras.map((f) => f.nombre)))
      .toEqual(['Annotation']);
  });
});
