/**
 * The shape of a catalog of texts (LILA-210).
 *
 * `strings.en.ts` is the base language and is written `as const`, so its type carries the English
 * text of every entry as a literal (`'Save'`, not `string`). That is exactly what a translation
 * must NOT have to match, so `Widen` walks that type and replaces every string literal by
 * `string`, keeping the structure: the keys, whether an entry is a function (and with which
 * parameters), and the length of each tuple.
 *
 * The result, `Strings`, is what `strings.es.ts` annotates itself with. Annotating — instead of
 * writing `as const` there too — is what makes `tsc` the guard of key coverage: a translation
 * that forgets `app.guardar`, invents `app.guardarr` or turns a function into a plain string does
 * not compile. `strings.test.ts` checks the same thing at runtime, walking both objects, so a
 * `Record<string, string>` entry (whose keys `tsc` cannot compare) is not left unguarded either.
 */

/**
 * `T` with every string literal widened to `string`.
 *
 * - a string literal (`'Save'`) → `string`;
 * - a function → the same parameters, with a widened return type (the parameters are part of the
 *   contract: `replicacion(actual, total)` takes two numbers in every language);
 * - an array or a tuple → the same shape, each item widened (the mapped type is homomorphic, so a
 *   4-entry tuple stays a 4-entry tuple and `raci[0]` keeps being defined);
 * - an object → the same keys, each value widened.
 */
export type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Widen<R>
    : T extends readonly unknown[]
      ? { readonly [K in keyof T]: Widen<T[K]> }
      : T extends object
        ? { readonly [K in keyof T]: Widen<T[K]> }
        : T;

/**
 * The catalog contract: same keys and same kinds as `strings.en.ts`, with the texts free. Import
 * it only to type a catalog; the app reads its texts through `useStrings()`/`strings()`
 * (`i18n.ts`), which already return this type.
 */
export type Strings = Widen<typeof import('./strings.en').en>;
