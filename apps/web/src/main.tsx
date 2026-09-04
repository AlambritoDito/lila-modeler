import { StrictMode, useEffect, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme, type Theme } from './theme/applyTheme';
import './theme/tokens.css';

// Los JSON se sirven desde `publicDir` (ver vite.config.ts): se piden por fetch,
// así que editar un valor y recargar cambia la UI sin recompilar.
const THEME_FILES: Record<string, string> = {
  'eva-01': '/eva-01.json',
  papel: '/papel.json',
};

const panel: CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: '0 6px 20px var(--shadow)',
  padding: 16,
  marginBottom: 16,
};

function Smoke() {
  const [slug, setSlug] = useState('eva-01');
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    let vivo = true;
    void fetch(THEME_FILES[slug]!)
      .then((r) => r.json() as Promise<Theme>)
      .then((t) => {
        if (!vivo) return;
        applyTheme(t);
        setTheme(t);
      });
    return () => {
      vivo = false;
    };
  }, [slug]);

  return (
    <main
      style={{
        background: 'var(--bg-base)',
        color: 'var(--fg-primary)',
        font: 'var(--font-size-base) var(--font-ui)',
        minHeight: '100vh',
        padding: 24,
      }}
    >
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Lila Modeler · tokens y temas</h1>
      <p style={{ color: 'var(--fg-muted)', margin: '0 0 20px' }}>
        Página de humo de LILA-112. Tema activo: {theme?.name ?? '…'}
      </p>

      <div style={panel}>
        <label style={{ color: 'var(--fg-muted)', marginRight: 8 }} htmlFor="tema">
          Tema
        </label>
        <select
          id="tema"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: 4,
            color: 'var(--fg-primary)',
            font: 'inherit',
            padding: '4px 8px',
          }}
        >
          {Object.keys(THEME_FILES).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button
          type="button"
          style={{
            background: 'var(--accent-primary)',
            border: 'none',
            borderRadius: 4,
            color: 'var(--fg-onAccent)',
            cursor: 'pointer',
            font: 'inherit',
            fontWeight: 600,
            marginLeft: 12,
            padding: '6px 14px',
          }}
        >
          Ejecutar simulación
        </button>
      </div>

      <div
        style={{
          background:
            'linear-gradient(var(--canvas-grid) 1px, transparent 1px) 0 0 / 16px 16px,' +
            'linear-gradient(90deg, var(--canvas-grid) 1px, transparent 1px) 0 0 / 16px 16px,' +
            'var(--canvas-bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          height: 220,
          padding: 16,
        }}
      >
        <div
          style={{
            background: 'var(--diagram-fill)',
            border: '2px solid var(--diagram-selected)',
            borderRadius: 6,
            color: 'var(--diagram-label)',
            display: 'inline-block',
            font: 'var(--font-size-base) var(--font-diagram)',
            padding: '18px 24px',
          }}
        >
          Tarea de ejemplo
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Smoke />
  </StrictMode>,
);
