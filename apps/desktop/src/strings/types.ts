/**
 * The shape of a catalog of desktop texts (LILA-213). Same convention as the web app's
 * `apps/web/src/strings.types.ts`, and the `Widen` trick is copied from there verbatim.
 *
 * It is copied and not imported because `apps/desktop` cannot reach into `apps/web`: its
 * `tsconfig.json` has `rootDir: "src"` and the package does not depend on `@lila/web`, so a
 * shared module would have to become a package of its own — far more machinery than the fourteen
 * texts this app owns are worth.
 */

/**
 * `T` with every string literal widened to `string`.
 *
 * - a string literal (`'Save'`) → `string`;
 * - a function → the same parameters, with a widened return type;
 * - an array or a tuple → the same shape, each item widened (the mapped type is homomorphic, so a
 *   tuple keeps its length);
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
 * The catalog contract: the same keys and the same kinds as `en.ts`, with the texts free. `es.ts`
 * annotates itself with it, which is what makes `tsc` the guard of key coverage: a translation
 * that forgets a key, invents one or changes its kind does not compile.
 */
export type Strings = Widen<typeof import('./en.js').en>;
