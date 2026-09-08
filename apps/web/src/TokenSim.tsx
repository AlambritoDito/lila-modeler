/**
 * Pestaña «Validar rutas» (LILA-065): anima los tokens de `bpmn-js-token-simulation` sobre el
 * BPMN ya montado en el lienzo. No sabe nada de bpmn-js por su cuenta —eso vive en
 * `Modeler.tsx`, junto al overlay de cuellos y los marcadores de validación—: solo enciende y
 * apaga la animación por `Modelador.simulacionTokens` y enseña el aviso de abajo.
 *
 * No es la simulación DES del motor (`packages/engine`): no lee el escenario activo ni escribe
 * resultados, solo anima el recorrido de tokens sobre las figuras del diagrama.
 */
import { useEffect } from 'react';
import type { Modelador } from './Modeler';

interface Props {
  modelador: Modelador | null;
}

export function TokenSim({ modelador }: Props): React.JSX.Element {
  // Se activa al montar (entrar en el modo) y se desactiva al desmontar (salir de él, o al
  // remontar el lienzo por un cambio de tema, que trae un `Modelador` nuevo).
  useEffect(() => {
    modelador?.simulacionTokens(true);
    return () => modelador?.simulacionTokens(false);
  }, [modelador]);

  return (
    <p className="aviso-token-sim" role="note">
      Animación de tokens de bpmn-js: no es simulación de eventos discretos; no usa el escenario ni
      produce resultados.
    </p>
  );
}
