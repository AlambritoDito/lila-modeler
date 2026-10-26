/**
 * The one-time version 3 confirmation (#93, owner decision 1 of 2026-10-16; RM-01 § 1.3).
 *
 * The first catalog object created or adopted in a version 1 or 2 project makes it a version 3
 * repository, which older Lila builds refuse to open. Before such a change is applied the app asks
 * once; Cancel leaves the document as it was. Once confirmed the document is version 3 in memory and
 * stays so (`withCatalog`), so `wouldUpgrade` is `false` from then on and the question does not
 * come back for that project — unless the change is discarded without saving: the file on disk is
 * still version 1 or 2, and reopening it asks again.
 *
 * Pure: the caller passes the operation's result and a function that asks (the app's dialog, or a
 * stub in `catalogUpgrade.test.ts`). Reused by the catalog panel (#674) and delete (#675).
 */
import type { CatalogOperationResult } from '@lila-modeler/engine/project';

/** What the dialog says: the version of the running app; earlier ones cannot open a version 3 file. */
export interface UpgradeQuestion {
  readonly appVersion: string;
}

/** The question to ask before applying `result`, or `null` when it does not upgrade the document. */
export function upgradeQuestion(result: Pick<CatalogOperationResult, 'change'>, appVersion: string): UpgradeQuestion | null {
  return result.change.wouldUpgrade ? { appVersion } : null;
}

/**
 * `result` when it may be applied: right away when it does not upgrade the document, after `ask`
 * says yes when it does. `null` when the user cancels: the caller applies nothing.
 */
export async function confirmUpgrade<T extends Pick<CatalogOperationResult, 'change'>>(
  result: T,
  appVersion: string,
  ask: (question: UpgradeQuestion) => Promise<boolean>,
): Promise<T | null> {
  const question = upgradeQuestion(result, appVersion);
  if (question === null) return result;
  return (await ask(question)) ? result : null;
}
