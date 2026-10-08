// #566: what the Windows installer writes, read from the configuration electron-builder builds it
// from. It does not build an installer: the registry, the install folder and Explorer are checked
// on Windows by hand (see the PR). What can drift here is the configuration and the NSIS include
// that repeats its ProgIds.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const escritorio = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const yml = readFileSync(escritorio('electron-builder.yml'), 'utf8');

/** The `fileAssociations` entries, as `{ ext, name, description }`. */
function asociaciones(): { ext: string; name: string; description: string | undefined }[] {
  const bloque = /^fileAssociations:\n((?:[ #-].*\n)+)/m.exec(yml)?.[1] ?? '';
  return bloque.split(/^ {2}- /m).slice(1).map((entrada) => ({
    ext: /^ext:\s*(\S+)/.exec(entrada)?.[1] ?? '',
    name: /^\s+name:\s*(.+)$/m.exec(entrada)?.[1]?.trim() ?? '',
    description: /^\s+description:\s*(.+)$/m.exec(entrada)?.[1]?.trim(),
  }));
}

describe('Windows installer (#566)', () => {
  it('installs into a folder named after the product, not the scoped npm name', () => {
    // electron-builder's one-click per-user installer takes the folder from the package `name`
    // (sanitised: "@lila-modelerdesktop"); `extraMetadata` replaces it in the packed package.json.
    expect(/^extraMetadata:\n\s+name:\s*(.+)$/m.exec(yml)?.[1]).toBe('Lila Modeler');
    expect(yml).toMatch(/^productName: Lila Modeler$/m);
  });

  it('every file association has the type name Explorer shows, and it says Lila Modeler for .lila', () => {
    const lista = asociaciones();
    expect(lista.map((a) => a.ext)).toEqual(['bpmn', 'lila']);
    expect(lista.filter((a) => a.description === undefined).map((a) => a.ext)).toEqual([]);
    expect(lista.find((a) => a.ext === 'lila')?.description).toMatch(/^Lila Modeler /);
  });

  it('the NSIS include is wired and repeats exactly the ProgIds of the configuration', () => {
    const include = /^nsis:\n(?:\s+#.*\n)*\s+include:\s*(\S+)/m.exec(yml)?.[1];
    expect(include).toBe('scripts/installer.nsh');
    const nsh = readFileSync(escritorio(include!), 'utf8');
    // customInstall rewrites the open command of each ProgId, quoted.
    const comandos = [...nsh.matchAll(/^\s*WriteRegStr SHELL_CONTEXT "Software\\Classes\\([^"\\]+)\\shell\\open\\command" "" '(.+)'$/gm)];
    expect(comandos.map((m) => m[1]).sort()).toEqual(asociaciones().map((a) => a.name).sort());
    for (const m of comandos) expect(m[2]).toBe('"$appExe" "%1"');
    // customUnInstall forgets each extension, with the ProgId it was registered with.
    const olvidos = [...nsh.matchAll(/^\s*!insertmacro lilaForgetExtension "([^"]+)" "([^"]+)"$/gm)].map((m) => [m[1], m[2]]);
    expect(olvidos.sort()).toEqual(asociaciones().map((a) => [a.ext, a.name]).sort());
    expect(nsh).toMatch(/^!macro customInstall$/m);
    expect(nsh).toMatch(/^!macro customUnInstall$/m);
  });
});
