import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// ponytail: los temas viven en `src/theme/themes/` (fuente única, la que leen los tests)
// y esa carpeta es el `publicDir` de Vite, así que se sirven tal cual en `/eva-01.json`
// y se copian verbatim a `dist/`. Editar un valor del JSON y recargar cambia la UI sin
// recompilar, que es la aceptación de LILA-112. Si algún día hacen falta otros assets
// estáticos, se crea `apps/web/public/` y se mueven los temas a `public/themes/`.
export default defineConfig({
  plugins: [react()],
  publicDir: 'src/theme/themes',
});
