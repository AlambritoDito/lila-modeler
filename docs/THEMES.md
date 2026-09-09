# Formato de tema

Un tema de Lila Modeler es un único archivo JSON con un objeto plano:

```json
{ "name": "Eva-01", "tokens": { "bg.base": "#12101A", "font.size.base": "13px" } }
```

`name` es la etiqueta que ve el usuario en la lista de temas. `tokens` es un mapa
de nombre de token a valor. Las claves válidas son **solo** las de
`apps/web/src/theme/tokens.ts` (`TOKEN_NAMES`), que son las del brief
`prompts/claude-design-ui.md`; los dos temas integrados traen las 40. Los valores de
color son hex (`#rgb`, `#rrggbb` o `#rrggbbaa`, este último para `shadow`); los
de `font.ui`, `font.mono` y `font.diagram` son listas de familias CSS;
`font.size.base` es una longitud CSS y `density` es `compacta`, `normal` o
`comoda`. Es un objeto plano y no un árbol anidado a propósito: así el JSON que
se exporta se lee de un vistazo, el diff es legible y no hay dos maneras de
escribir el mismo tema.

`applyTheme(theme, root)` (en `apps/web/src/theme/applyTheme.ts`) escribe cada
token como variable CSS en `root`, convirtiendo el nombre con `tokenToCssVar`:
los puntos pasan a guiones y nada más, sin tocar mayúsculas
(`bg.base` → `--bg-base`, `diagram.marker.error` → `--diagram-marker-error`,
`fg.onAccent` → `--fg-onAccent`). La conversión es reversible, que es lo que
permite a la pantalla Apariencia (LILA-114) exportar de vuelta al mismo JSON.
Los valores por defecto (Eva-01) viven además en `apps/web/src/theme/tokens.css`
como `:root`, de modo que la app pinta bien antes de cargar tema alguno. De ahí
salen los tres comportamientos de `applyTheme` ante un tema imperfecto:

- **Token ausente**: no es error. Se queda con el valor por defecto de
  `tokens.css`, así que un tema parcial (`{ "accent.primary": "#00FFAA" }`) es
  legal y solo cambia lo que trae. Para que eso sea verdad **también cuando ya
  había otro tema puesto**, quien aplica un tema borra después las variables en
  línea que el anterior dejó y este no trae (`aplicarTema` en `App.tsx`): sin ese
  barrido, `applyTheme` solo escribe y nunca borra, así que un tema parcial
  heredaba en silencio los tokens del anterior y el mismo archivo se veía
  distinto según lo que hubiera antes. Se borra después de escribir, no antes,
  para no perder la otra garantía: un tema malo lanza sin tocar nada y deja el
  anterior intacto.
- **Clave desconocida**: `Error`. Escribirla dejaría una variable basura
  (`--foo-bar`) que ningún componente lee y que nadie llegaría a ver.
- **Valor que no es texto** (número, `null`, objeto): `Error`. Escribirlo dejaría
  CSS inválido y el elemento se pintaría mal sin aviso.

Quien llame a `applyTheme` con un tema de fuera (un JSON de disco, un import de
LILA-114) tiene que capturar ese error y enseñárselo al usuario; la página de
humo de `main.tsx` lo hace en `--status-error`. Los
temas integrados se sirven como archivos estáticos y se piden por `fetch`, así
que cambiar un valor del JSON y recargar cambia la UI sin recompilar.

## Elegir tema (LILA-113, versión mínima)

`App.tsx` conoce los temas integrados por id (`eva-01`, `papel`), pide `./<id>.json` y lo pasa a
`applyTheme`. La densidad (`compacta` / `normal` / `comoda`) se escribe encima del token `density`
del tema y sale como `data-densidad` en `.app` para el CSS. No hay `ThemeProvider`: con dos temas y
un `useState` sobra un contexto.

**Dónde se guarda la elección.** En el navegador, en `localStorage['lila.tema']` y
`localStorage['lila.densidad']`. En escritorio, en `<userData>/estado.json`, bajo `ajustes`, por el
puente (`readSettings()` / `writeSettings(ajustes)`, `apps/desktop/src/bridge.ts`), donde ya viven
la ventana y los recientes. Son excluyentes: si `window.lila` existe, el `localStorage` ni se lee ni
se escribe. Hasta ahora era `localStorage` en las dos modalidades, con el argumento —cierto— de que
`lila://` es un esquema con origen propio y por tanto tiene su propio almacén; lo que falla no es el
aislamiento sino el sitio: ese almacén está dentro del perfil de Chromium de la app, no se ve desde
fuera, no se copia a otra máquina y se va con los datos del sitio. `writeSettings` **fusiona**
(mandar solo `{ tema }` no borra la densidad) y `main.ts` pasa lo que llega por `parseAjustes`, que
descarta cualquier clave o valor que no tenga la forma esperada (los dos textos, y desde LILA-114
la lista `temas`). Leer es asíncrono —en
escritorio es IPC—, así que `temaId` y `densidad` arrancan de fábrica y el primer efecto los pisa:
es el mismo instante en el que `tema` deja de ser `undefined`, y el lienzo no se monta hasta
entonces.

**Cambiar de tema en caliente.** `cambiarTema` aplica el JSON y llama a `Modelador.repintar()`. El
lienzo **no** se remonta —antes cambiaba la `key` de `<Lienzo>`, y eso se llevaba por delante la
pila de deshacer y la selección—. `repintar()` reconstruye el `bpmnRenderer` porque bpmn-js copia
`defaultFillColor`/`defaultStrokeColor`/`defaultLabelColor` a variables locales de su constructor y
no ofrece ni setter ni evento para cambiarlas: se vuelve a ejecutar ese constructor sobre la misma
instancia (con un `eventBus` mudo, para no apilar oyentes de `render.shape`) y después se dispara
`elements.changed`, que es la vía normal de diagram-js para redibujar. No pasa por el
`commandStack`, así que ni ensucia el documento ni añade un paso al deshacer, y los colores que un
elemento traiga en su DI siguen mandando sobre los del tema.

Esa última regla tiene una consecuencia en «Validar rutas»: los colores neutros del modo
(`ColoresNeutrosDelTema`, `TokenSim.tsx`) se escriben en el DI al activarlo, o sea que ganan a lo
que repinte `repintar()`. El módulo relee los tokens en cada activación y no en cada repintado, así
que `App.tsx` monta `<TokenSim key={temaId}>`: cambiar de tema con el modo encendido lo apaga y lo
vuelve a encender, y así el diagrama sale con el tema de ahora. Sin esa `key` el diagrama se
quedaba con el relleno del tema anterior y la etiqueta con el color del nuevo.

**`font.size.base`** se cablea en `body` (`app.css`) y de ahí lo hereda todo lo que no fija su
propio tamaño. A propósito no está en `html`: las medidas en `rem` del CSS se resolverían contra el
token y los diálogos encogerían al bajar la letra.

## Ajustes → Apariencia (LILA-114)

`apps/web/src/settings/Apariencia.tsx` es el contenido del diálogo de Ajustes; el `<dialog>` y su
apertura (⚙, ⌘, y el menú nativo) se quedan en `App.tsx`, que sigue siendo **el único** que llama a
`applyTheme` y a `Modelador.repintar()`. El componente no aplica ni persiste nada: construye la
lista nueva de temas del usuario y dice cuál queda activo (`onTemas(lista, seleccion)`), y de ahí
sale la vista previa —cada cambio válido repinta la app entera, diálogo incluido—. El recuadro de
muestras (texto, texto apagado, acento) es solo el atajo para no tener que mirar detrás del diálogo.

Los controles:

- **Lista de temas**: los integrados (Eva-01, Papel) y los del usuario, en un `<optgroup>` cada
  grupo. Elegir uno lo aplica en caliente; los integrados se piden por `fetch`, los del usuario
  salen del almacén y no piden nada.
- **Duplicar**: copia el tema activo como tema del usuario, con el nombre editable al lado.
- **Editor de tokens**, agrupado igual que `TOKEN_NAMES` (Base, Texto, Acentos, Estados, Lienzo y
  diagrama, Simulación, Tipografía), un `<details>` por grupo. Los colores llevan
  `<input type="color">` y el hex a la par, editables los dos; `type="color"` solo entiende
  `#rrggbb`, así que al elegir se le vuelve a pegar el alfa que el token tuviera (`shadow`).
  `font.ui`/`font.mono`/`font.diagram` son un `<select>` con las familias que la app empaqueta
  (Archivo, JetBrains Mono) más «Sistema»; `font.size.base`, un número en píxeles.
- **Editar un tema integrado no lo modifica**: la primera edición sobre Eva-01 crea «Eva-01 (copia)»
  y sigue sobre ella. Se prefirió a un aviso «duplica primero» porque el cambio que el usuario pidió
  ocurre igual y el nombre del tema, que cambia delante de sus ojos, ya cuenta lo que ha pasado.
- **La densidad sigue siendo una preferencia, no una edición del tema** (LILA-113): se aplica encima
  de cualquier tema, así que el control de arriba no toca el token `density` del tema que se edita;
  el token viaja en el JSON exportado tal y como venga del tema de origen.
- **Restablecer**: devuelve el tema del usuario a los tokens con los que nació y el integrado a su
  JSON (se vuelve a pedir).
- **Exportar**: descarga `{ name, tokens }` —exactamente el formato de arriba, sin `id` ni nada de
  la app— con un `<a download>` y un Blob. En Electron funciona igual: no hay `will-download` que lo
  intercepte y la CSP de `lila://` no gobierna las descargas, así que Chromium lo guarda por el
  camino normal.
- **Importar**: un `<input type="file" accept=".json">`. El JSON se valida entero antes de tocar
  nada (`validarTema`, `apps/web/src/theme/temas.ts`); si algo falla, el mensaje sale dentro del
  diálogo y no se aplica ni se guarda nada. Si vale, entra como tema del usuario y se aplica.
- **Eliminar** quita el tema del usuario activo y vuelve a Eva-01.
- **Cerrar el diálogo no deshace nada.** El botón «Cerrar» y la tecla Escape hacen lo mismo: lo
  editado ya está aplicado y ya está guardado desde la pulsación que lo cambió, porque el editor no
  tiene «Aceptar». Para volver atrás está «Restablecer». Enter dentro de un campo de texto **no**
  cierra: el `<form method="dialog">` lo enviaría en mitad de teclear un hex o un nombre, así que
  `App.tsx` le hace `preventDefault` cuando el objetivo es un `<input>`.
- **Lo tecleado a medias no sale del control.** Un hex pasa por `#`, `#1`, `#12`… y ninguno de esos
  es un color; el nombre pasa por el vacío y el tamaño base por el campo sin número (que dejaba el
  token en `"px"`) o fuera del rango 9–32 px, donde `-5px` y `0px` son longitudes que CSS descarta
  en silencio. Esos valores se quedan en el estado del propio campo —que los enseña marcados con
  `--status-error`— y no se aplican ni se guardan: solo un valor válido llama a `onTemas`, y hasta
  que lo haya sigue mandando el último bueno. **Al salir del campo el valor a medias se descarta** y
  vuelve el último bueno: si no, seguía en pantalla después de cambiar de tema, de «Restablecer» o
  de cerrar y reabrir Ajustes, enseñando en rojo un valor que el tema activo no tiene.

**Qué valida `validarTema` y por qué no basta `applyTheme`.** `applyTheme` comprueba lo que le
impide escribir CSS sano: clave conocida y valor de texto. Un archivo elegido por el usuario puede
además traer un color que no es un color (`"azul"`) o una densidad inventada: CSS ignora en silencio
el valor inválido y la app se queda a medio pintar sin decir por qué. `validarTema` añade esas dos
reglas —hex `#rgb`/`#rrggbb`/`#rrggbbaa` en los tokens de color, `density` entre las tres
conocidas—, **normaliza** el tema a `{ name, tokens }` (lo que el archivo traiga de más no entra ni
vuelve a salir, y por eso exportar → importar → exportar da el mismo archivo) y lanza el mensaje en
español que se lee en el diálogo. Es la misma función para importar y para releer lo guardado.

**Dónde se guardan los temas del usuario.** En el mismo sitio que el resto de la apariencia
(LILA-113) y con la misma forma en las dos modalidades: `ajustes.temas` de
`<userData>/estado.json` en escritorio, `localStorage['lila.temas']` en la web. Cada entrada es
`{ id, tema: { name, tokens }, origen }`: `id` es `u:<n>` (los integrados son `eva-01` y `papel`) y
`origen` son los tokens de partida, que es lo único que necesita «Restablecer» —no hace falta
volver a pedir el integrado ni confiar en que su JSON siga igual, y funciona igual para un tema
importado, que no tiene integrado detrás—. `id` y `origen` son de la app: no salen en el archivo
exportado ni se esperan en el importado. En escritorio, `parseAjustes` descarta las entradas que no
tengan forma de tema (`sessionState.ts`, con un tope de `MAX_TEMAS` = 50 entradas: esto es la
configuración de la app, no una galería) y el renderer vuelve a validarlas con `validarTema`; un
tema que un `estado.json` editado a mano dejó roto **se repara token a token** (`saneaTemas`): el
valor que no vale cae al `origen` del tema y, si ahí tampoco vale, se cae de la lista y lo pinta el
valor por defecto de `tokens.css`. Solo se descarta el tema entero cuando no hay cómo reconstruirlo
—sin `id` de usuario o sin `name`—. Descartarlo al primer token roto, que es lo que hacía antes,
convertía cualquier edición dejada a medias en la pérdida silenciosa de los otros 39 al recargar.
