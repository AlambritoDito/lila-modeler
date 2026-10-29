/**
 * `elements[task].loop` (ADR-033 § 3, #703): a task with a standard loop marker runs a fixed number
 * of times, or runs again after each iteration with a probability.
 *
 * The schema is a strict object with **exactly one** of `count` and `probability`, a zod refinement
 * that the JSON Schema the form is generated from cannot express: the generic form would draw both
 * boxes and let both be filled. This control is a mode picker plus one number. Picking a mode and
 * typing a number both write the whole object, so `ctx.editar` writes the other key as `null` when
 * a parent declares it (§ 6, `conBorrados`). Emptying the number removes the whole `loop`, not just
 * its key, which would leave an object the schema rejects; the mode stays picked (local state) so
 * the box stays where it is and the next keystroke writes the loop again. «Not set» forgets it.
 *
 * A `loop` of any other shape (both keys, neither, a value written by hand) is left to the generic
 * fieldset of `Campo`, where it can be seen and fixed: `formaBucle` returns `null` for it.
 */
import { useState } from 'react';

import { EntradaNumero, Problemas } from './Campo.js';
import { esObjeto, leer, rutaTexto, type Contexto, type Ruta } from './escenarioModelo.js';
import { useStrings } from './i18n';

/** `['elements', <id>, 'loop']`. */
export function esBucle(ruta: Ruta): boolean {
  return ruta.length === 3 && ruta[0] === 'elements' && ruta[2] === 'loop';
}

export type FormaBucle = 'ninguno' | 'count' | 'probability';

/** What the loop control can draw for `valor`, or `null` when only the generic fieldset can. */
export function formaBucle(valor: unknown): FormaBucle | null {
  if (valor === undefined) return 'ninguno';
  if (!esObjeto(valor)) return null;
  const claves = Object.keys(valor).filter((clave) => valor[clave] !== undefined);
  if (claves.length !== 1) return null;
  return claves[0] === 'count' || claves[0] === 'probability' ? claves[0] : null;
}

/** What picking a mode writes: the smallest value the schema accepts (`count ≥ 1`, `probability` in [0, 1]). */
const AL_ELEGIR: Readonly<Record<'count' | 'probability', Record<string, number>>> = {
  count: { count: 1 },
  probability: { probability: 0 },
};

export function CampoBucle({
  ruta,
  etiqueta,
  ctx,
}: {
  ruta: Ruta;
  etiqueta: string;
  ctx: Contexto;
}): React.JSX.Element {
  const S = useStrings();
  const B = S.escenario.bucle;
  const id = `campo-${rutaTexto(ruta)}`;
  /** The mode picked while its number is empty, for this path only (another task resets it). */
  const [vacio, setVacio] = useState<{ id: string; forma: 'count' | 'probability' } | null>(null);
  const escrita = formaBucle(leer(ctx.resuelto, ruta)) ?? 'ninguno';
  const forma = escrita === 'ninguno' && vacio?.id === id ? vacio.forma : escrita;
  const nodo = ctx.ir?.nodes[String(ruta[1])];
  const tope = nodo?.loop?.maximum;
  // The number writes the whole `loop`, and emptying it takes the whole `loop` with it while the
  // mode stays picked (see the module comment).
  const ctxNumero: Contexto = {
    ...ctx,
    editar: (_ruta, valor) => {
      if (forma !== 'ninguno') ctx.editar(ruta, { [forma]: valor });
    },
    quitar: () => {
      if (forma !== 'ninguno') setVacio({ id, forma });
      ctx.quitar(ruta);
    },
  };
  return (
    <div className="campo-schema">
      <label htmlFor={id}>{etiqueta}</label>
      <select
        id={id}
        value={forma}
        onChange={(e) => {
          const elegido = e.target.value;
          setVacio(null);
          if (elegido === 'count' || elegido === 'probability') ctx.editar(ruta, AL_ELEGIR[elegido]);
          else ctx.quitar(ruta);
        }}
      >
        <option value="ninguno">{S.escenario.sinDefinir}</option>
        <option value="count">{B.porConteo}</option>
        <option value="probability">{B.porProbabilidad}</option>
      </select>
      <Problemas ruta={ruta} ctx={ctx} />
      {forma !== 'ninguno' && (
        <div className="anidado">
          <div className="campo-schema">
            <label htmlFor={`${id}.${forma}`}>{forma === 'count' ? B.conteo : B.probabilidad}</label>
            <EntradaNumero
              valor={leer(ctx.resuelto, [...ruta, forma])}
              ruta={[...ruta, forma]}
              ctx={ctxNumero}
              id={`${id}.${forma}`}
            />
            <Problemas ruta={[...ruta, forma]} ctx={ctx} />
          </div>
          <p className="ayuda">{forma === 'count' ? B.ayudaConteo : B.ayudaProbabilidad}</p>
        </div>
      )}
      {tope !== undefined && <p className="ayuda">{B.tope(tope)}</p>}
    </div>
  );
}
