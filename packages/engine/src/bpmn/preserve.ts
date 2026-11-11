/**
 * Reading a BPMN file to write it back (#724) without losing what bpmn-moddle cannot interpret.
 *
 * bpmn-moddle reads leniently: what it cannot take it drops, and says so only as a warning. Writing
 * that tree back would silently lose content of the user's file (what ADR-021 forbids), so the
 * writers (`annotateElement`, `editBpmn`, …) used to refuse any file with a warning. Real exports
 * carry such content all the time, so here each kind of warning is either made harmless or named:
 *
 * - a declared encoding other than UTF-8: nothing is lost, the text is already decoded and the
 *   output declares UTF-8;
 * - an attribute without a prefix that bpmn-moddle does not know on a BPMN element: it keeps and
 *   writes it anyway;
 * - a reference to an id no element has (`messageRef="Message_1"` with the message left out of the
 *   export, `triso:unspecified`): the id is written back where it was read;
 * - an element bpmn-moddle does not know where it stands (`<LoopCounter>` of Bizagi, a foreign
 *   element outside `extensionElements`), and every element of another vendor's extension (which
 *   bpmn-moddle rewrites without a warning): its source text is taken out before reading and put back,
 *   verbatim, inside the same parent. The parent is marked with an attribute bpmn-moddle carries on
 *   the object it reads it into, so the fragment follows that object through an edit, wherever it
 *   goes; the mark is taken off the output.
 *
 * The rule for everything else: where this module cannot prove that content goes back to the place
 * it came from, the file (or the change) is refused with `ContentLossError`, whose issues name the
 * construct, its line and its repair. A refusal is what 1.0.1 did; a silent loss is not acceptable.
 *
 * A file without warnings takes none of these paths: its output is what bpmn-moddle writes.
 */
import { BpmnModdle, type Moddle, type ModdleElement, type ModdleWarning } from 'bpmn-moddle';
import lila from './lila.moddle.json' with { type: 'json' };
import { messages, type CliMessages } from '../messages/index.js';

/** Why a file cannot be written back; `line` is 1-based, in the file as it was read. */
export type ContentLossIssue =
  | { readonly kind: 'duplicateId'; readonly id: string; readonly tag: string; readonly line: number }
  | { readonly kind: 'illegalId'; readonly id: string; readonly tag: string; readonly line: number }
  | { readonly kind: 'strayText'; readonly text: string; readonly line: number }
  /** An element bpmn-moddle does not know stands in the middle of the text of `parent`. */
  | { readonly kind: 'mixedContent'; readonly tag: string; readonly parent: string; readonly line: number }
  /** Two attributes of one element differ only in their prefix: bpmn-moddle keeps one. */
  | { readonly kind: 'twinAttribute'; readonly attribute: string; readonly tag: string; readonly line: number }
  /** An unknown attribute in a namespace bpmn-moddle knows: it would be written without its prefix. */
  | { readonly kind: 'prefixedAttribute'; readonly attribute: string; readonly element: string }
  /** An element that was set aside has no parent to go back to: the change rebuilt it inside `anchor`. */
  | { readonly kind: 'misplaced'; readonly tag: string; readonly line: number; readonly anchor: string }
  /** A reference to an id no element has (`ref`) has no place in what the change made of `element`. */
  | { readonly kind: 'danglingRef'; readonly property: string; readonly ref: string; readonly element: string }
  /** What this module has no words for: bpmn-moddle's own text. */
  | { readonly kind: 'other'; readonly detail: string };

/** The file has content that would be lost by writing it back; `issues` name each construct. */
export class ContentLossError extends Error {
  constructor(readonly issues: readonly ContentLossIssue[]) {
    super(`the file has content that cannot be written back: ${issues.map((issue) => JSON.stringify(issue)).join('; ')}`);
    this.name = 'ContentLossError';
  }

  /** The issues in English, for a caller that has no catalog at hand. */
  get detail(): string {
    return describeContentLoss(this.issues, messages('en').cli);
  }
}

/** `issues` in the caller's language, one after another: what each construct is and how to repair it. */
export function describeContentLoss(issues: readonly ContentLossIssue[], C: CliMessages): string {
  return issues
    .map((issue) => {
      switch (issue.kind) {
        case 'duplicateId':
          return C.lossDuplicateId(issue.id, issue.tag, issue.line);
        case 'illegalId':
          return C.lossIllegalId(issue.id, issue.tag, issue.line);
        case 'strayText':
          return C.lossStrayText(issue.text, issue.line);
        case 'mixedContent':
          return C.lossMixedContent(issue.tag, issue.parent, issue.line);
        case 'twinAttribute':
          return C.lossTwinAttribute(issue.attribute, issue.tag, issue.line);
        case 'prefixedAttribute':
          return C.lossPrefixedAttribute(issue.attribute, issue.element);
        case 'misplaced':
          return C.lossMisplaced(issue.tag, issue.line, issue.anchor);
        case 'danglingRef':
          return C.lossDanglingRef(issue.property, issue.ref, issue.element);
        default:
          return C.lossOther(issue.detail);
      }
    })
    .join('; ');
}

/** A BPMN file read whole: `write` gives back everything that was in it. */
export interface LosslessBpmn {
  readonly moddle: Moddle;
  readonly root: ModdleElement;
  /**
   * Ids the tree does not show but the file has: those inside the elements set aside, and those
   * its references name without an element having them. A new element must not take one.
   */
  readonly reserved: ReadonlySet<string>;
  /** Whether elements set aside go back into `element`: a writer must keep that object, not make another. */
  holds(element: ModdleElement): boolean;
  /**
   * Serialises `root` as bpmn-moddle does (formatted), with what it could not interpret put back.
   * `removed`: the ids the change took out of the model on purpose; what was kept inside them goes
   * with them. Throws `ContentLossError` when something kept has no place left.
   */
  write(options?: { removed?: Iterable<string> }): Promise<string>;
}

/* ------------------------------------------------------------------------------------------- */
/* XML text                                                                                      */
/* ------------------------------------------------------------------------------------------- */

interface Tag {
  readonly kind: 'open' | 'self' | 'close';
  /** As written, prefix included. */
  readonly name: string;
  readonly start: number;
  /** Past the closing `>`. */
  readonly end: number;
  /** Attributes as written (values not unescaped), in order. Empty for a closing tag. */
  readonly attrs: readonly (readonly [string, string])[];
}

const ATTRIBUTE = /([^\s=<>/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** The element tags of `xml` from `from` on, in order; comments, CDATA, PIs and the doctype are skipped. */
function* tags(xml: string, from = 0): Generator<Tag> {
  let at = from;
  for (;;) {
    const start = xml.indexOf('<', at);
    if (start === -1) return;
    const skip = (opening: string, closing: string): boolean => {
      if (!xml.startsWith(opening, start)) return false;
      const stop = xml.indexOf(closing, start + opening.length);
      at = stop === -1 ? xml.length : stop + closing.length;
      return true;
    };
    if (skip('<!--', '-->') || skip('<![CDATA[', ']]>') || skip('<?', '?>')) continue;
    if (xml.startsWith('<!', start)) {
      // A doctype, perhaps with an internal subset.
      const subset = xml.indexOf('[', start);
      const close = xml.indexOf('>', start);
      if (subset !== -1 && subset < close) skip('<!', ']>');
      else at = close === -1 ? xml.length : close + 1;
      continue;
    }
    // The tag ends at the first `>` outside a quoted value.
    let end = start + 1;
    let quote = '';
    for (; end < xml.length; end += 1) {
      const ch = xml[end]!;
      if (quote !== '') {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
    }
    end = Math.min(end + 1, xml.length);
    at = end;
    const closing = xml[start + 1] === '/';
    const text = xml.slice(start + (closing ? 2 : 1), end - 1);
    const name = /^[^\s/>]*/.exec(text)![0];
    if (closing) {
      yield { kind: 'close', name, start, end, attrs: [] };
      continue;
    }
    const attrs: (readonly [string, string])[] = [];
    for (const match of text.slice(name.length).matchAll(ATTRIBUTE)) attrs.push([match[1]!, match[2] ?? match[3] ?? '']);
    yield { kind: text.endsWith('/') ? 'self' : 'open', name, start, end, attrs };
  }
}

const local = (name: string): string => name.slice(name.indexOf(':') + 1);
const prefixOf = (name: string): string => (name.includes(':') ? name.slice(0, name.indexOf(':')) : '');

/** The namespace declarations of a tag, by prefix (`''` is the default namespace). */
function declared(tag: Tag): Map<string, string> {
  const result = new Map<string, string>();
  for (const [name, value] of tag.attrs) {
    if (name === 'xmlns') result.set('', value);
    else if (name.startsWith('xmlns:')) result.set(name.slice(6), value);
  }
  return result;
}

/** An element set aside: its source text and where it stood. */
interface Fragment {
  readonly text: string;
  readonly tag: string;
  readonly line: number;
  /** The mark of its parent: fragments of one parent share it. */
  readonly slot: number;
  /** Id of the nearest element around it that has one; `null` when none has. */
  readonly anchor: string | null;
  /** The namespaces in scope where it stood. */
  readonly scope: ReadonlyMap<string, string>;
}

interface Open {
  readonly tag: Tag;
  readonly id: string | undefined;
  readonly scope: ReadonlyMap<string, string>;
  /** Whether it has text of its own (not only white space) between its children. */
  text: boolean;
}

const COMMENTS = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;

/** Walks the elements of `xml`: `enter` may answer `'skip'` to pass over an element and its content. */
function walkXml(
  xml: string,
  enter: (tag: Tag, stack: readonly Open[], scope: ReadonlyMap<string, string>) => 'skip' | void,
  leave: (open: Open, close: Tag | undefined, stack: readonly Open[]) => void,
): void {
  const stack: Open[] = [];
  let skipping: { depth: number } | undefined;
  let last = 0;
  for (const tag of tags(xml)) {
    if (skipping !== undefined) {
      if (tag.kind === 'open') skipping.depth += 1;
      else if (tag.kind === 'close' && (skipping.depth -= 1) === 0) {
        skipping = undefined;
        last = tag.end;
      }
      continue;
    }
    const parent = stack.at(-1);
    if (parent !== undefined && !parent.text && xml.slice(last, tag.start).replace(COMMENTS, '').trim() !== '') parent.text = true;
    last = tag.end;
    if (tag.kind === 'close') {
      const open = stack.pop();
      if (open !== undefined) leave(open, tag, stack);
      continue;
    }
    const own = declared(tag);
    const scope = own.size === 0 && parent !== undefined ? parent.scope : new Map([...(parent?.scope ?? []), ...own]);
    if (enter(tag, stack, scope) === 'skip') {
      if (tag.kind === 'open') skipping = { depth: 1 };
      continue;
    }
    const open: Open = { tag, id: tag.attrs.find(([attr]) => attr === 'id')?.[1], scope, text: false };
    if (tag.kind === 'self') leave(open, undefined, stack);
    else stack.push(open);
  }
}

/** The end of the element whose opening tag is `tag`. */
function elementEnd(xml: string, tag: Tag): number {
  if (tag.kind === 'self') return tag.end;
  let depth = 1;
  for (const next of tags(xml, tag.end)) {
    if (next.kind === 'open') depth += 1;
    else if (next.kind === 'close' && (depth -= 1) === 0) return next.end;
  }
  return xml.length;
}

/** Offsets where the lines of `xml` start (a line ends at `\r\n`, `\r` or `\n`, as for saxen). */
function lineStarts(xml: string): number[] {
  const starts = [0];
  for (const match of xml.matchAll(/\r\n|\r|\n/g)) starts.push(match.index + match[0].length);
  return starts;
}

/** 1-based line of `offset`. */
function lineOf(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

interface TextEdit {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

/** `xml` with `edits` applied; they do not overlap. One pass, whatever their number. */
function applyEdits(xml: string, edits: TextEdit[]): string {
  const pieces: string[] = [];
  let at = 0;
  for (const edit of edits.sort((x, y) => x.from - y.from || x.to - y.to)) {
    pieces.push(xml.slice(at, edit.from), edit.text);
    at = edit.to;
  }
  pieces.push(xml.slice(at));
  return pieces.join('');
}

/** The mark of the parents of what is set aside: a prefix and a namespace nothing in the file uses. */
interface Mark {
  readonly prefix: string;
  readonly uri: string;
}

/**
 * A mark for `xml`. Neither string stands anywhere in the file, whatever the file calls its own
 * prefixes and namespaces (one that already uses `lilaKept` or this URI included), so a mark is
 * never taken for content of the file, nor content for a mark.
 */
function markFor(xml: string): Mark {
  let n = 0;
  const fresh = (base: string): string => {
    let candidate = base;
    while (xml.includes(candidate)) candidate = `${base}${(n += 1)}`;
    return candidate;
  };
  return { prefix: fresh('lilaKept'), uri: fresh('urn:lila-modeler:kept') };
}

/**
 * `xml` without the elements that start at `starts`, and those elements. The parent of each gets
 * the mark `<prefix>:at="<slot>"`, which bpmn-moddle keeps on the object it reads the parent into.
 */
function setAside(xml: string, starts: ReadonlyMap<number, number>, mark: Mark): { xml: string; fragments: Fragment[]; issues: ContentLossIssue[] } {
  const fragments: Fragment[] = [];
  const issues: ContentLossIssue[] = [];
  const edits: TextEdit[] = [];
  const slots = new Map<Open, number>();
  const inText: { fragment: Fragment; parent: Open }[] = [];
  walkXml(
    xml,
    (tag, stack) => {
      const line = starts.get(tag.start);
      if (line === undefined) return undefined;
      const parent = stack.at(-1);
      const end = elementEnd(xml, tag);
      if (parent === undefined) {
        issues.push({ kind: 'other', detail: `unparsable content <${tag.name}> at line ${line}` });
        return 'skip';
      }
      let slot = slots.get(parent);
      if (slot === undefined) {
        slot = slots.size + 1;
        slots.set(parent, slot);
        const at = parent.tag.start + 1 + parent.tag.name.length;
        edits.push({ from: at, to: at, text: ` xmlns:${mark.prefix}="${mark.uri}" ${mark.prefix}:at="${slot}"` });
      }
      // Its line breaks stay, so that lines keep their numbers in what is read next.
      edits.push({ from: tag.start, to: end, text: xml.slice(tag.start, end).replace(/[^\r\n]/g, '') });
      const anchor = [...stack].reverse().find((open) => open.id !== undefined)?.id ?? null;
      const fragment: Fragment = { text: xml.slice(tag.start, end), tag: tag.name, line, slot, anchor, scope: parent.scope };
      fragments.push(fragment);
      inText.push({ fragment, parent });
      return 'skip';
    },
    () => undefined,
  );
  // Text around a fragment has a position among it that nothing here can keep.
  for (const { fragment, parent } of inText) {
    if (parent.text) issues.push({ kind: 'mixedContent', tag: fragment.tag, parent: parent.tag.name, line: fragment.line });
  }
  return { xml: applyEdits(xml, edits), fragments, issues };
}

/**
 * What bpmn-moddle rewrites without a warning, in a file that is only written thanks to this module.
 *
 * Generic content (another vendor's extension: any element of a namespace bpmn-moddle has no
 * descriptor for, which it reads only inside `extensionElements` and the like) does not come back
 * as it went in: an attribute with the element's own prefix loses it (`x:k` becomes `k`, and takes
 * the place of a `k` that was there), text between child elements moves. So every such element is
 * set aside, outermost first, to go back verbatim: `aside` has their offsets. `lila:` elements are
 * not generic: they are read and written as always, next to them.
 *
 * On an element bpmn-moddle knows, two attributes that differ only in their prefix, one of them
 * of a namespace it knows too, are read into one: an issue. `skip`: elements already set aside.
 */
function vendorContent(xml: string, known: ReadonlySet<string>, skip: ReadonlyMap<number, number>): { aside: Map<number, number>; issues: ContentLossIssue[] } {
  const aside = new Map<number, number>();
  const issues: ContentLossIssue[] = [];
  const starts = lineStarts(xml);
  walkXml(
    xml,
    (tag, _stack, scope) => {
      if (skip.has(tag.start)) return 'skip';
      if (!known.has(scope.get(prefixOf(tag.name)) ?? '')) {
        aside.set(tag.start, lineOf(starts, tag.start));
        return 'skip';
      }
      const names = tag.attrs.map(([name]) => name).filter((name) => name !== 'xmlns' && !name.startsWith('xmlns:'));
      if (names.length < 2) return undefined;
      for (const name of new Set(names.map(local))) {
        const twins = names.filter((other) => local(other) === name);
        if (twins.length > 1 && twins.some((twin) => twin.includes(':') && known.has(scope.get(prefixOf(twin)) ?? ''))) {
          issues.push({ kind: 'twinAttribute', attribute: twins.join(', '), tag: tag.name, line: lineOf(starts, tag.start) });
        }
      }
      return undefined;
    },
    () => undefined,
  );
  return { aside, issues };
}

/** `fragment`'s text, declaring on its own tag the namespaces it uses that `scope` binds otherwise. */
function withNamespaces(fragment: Fragment, scope: ReadonlyMap<string, string>): string {
  const first = tags(fragment.text).next().value as Tag;
  const own = declared(first);
  const used = new Set<string>();
  for (const tag of tags(fragment.text)) {
    if (tag.kind === 'close') continue;
    used.add(prefixOf(tag.name));
    for (const [name] of tag.attrs) if (name.includes(':') && !name.startsWith('xmlns:')) used.add(prefixOf(name));
  }
  let extra = '';
  for (const [prefix, uri] of fragment.scope) {
    if (own.has(prefix) || scope.get(prefix) === uri) continue;
    // A prefix may also be used inside a value (`xsi:type="tns:Thing"`, a QName as content).
    if (!used.has(prefix) && (prefix === '' || !fragment.text.includes(`${prefix}:`))) continue;
    // The value is as it was written: it has no quote of the kind that held it.
    const quote = uri.includes('"') ? "'" : '"';
    extra += ` xmlns${prefix === '' ? '' : `:${prefix}`}=${quote}${uri}${quote}`;
  }
  if (extra === '') return fragment.text;
  const cut = first.start + 1 + first.name.length;
  return fragment.text.slice(0, cut) + extra + fragment.text.slice(cut);
}

/**
 * `xml` (bpmn-moddle's output) with `fragments` back inside the elements that carry their marks,
 * and the marks taken off. A fragment whose mark is gone went with `removed` (and `ids`, those the
 * tree has now, no longer has its anchor), or has nowhere to go.
 */
function putBack(xml: string, fragments: readonly Fragment[], { prefix }: Mark, removed: (anchor: string) => boolean, ids: ReadonlySet<string>): string {
  const bySlot = new Map<number, Fragment[]>();
  for (const fragment of fragments) {
    const held = bySlot.get(fragment.slot);
    if (held === undefined) bySlot.set(fragment.slot, [fragment]);
    else held.push(fragment);
  }
  const found = new Map<number, number>();
  const edits: TextEdit[] = [];
  const unmark = (tag: string): string =>
    tag.replace(new RegExp(`\\s+xmlns:${prefix}\\s*=\\s*(?:"[^"]*"|'[^']*')`), '').replace(new RegExp(`\\s+${prefix}:at\\s*=\\s*(?:"[^"]*"|'[^']*')`), '');
  walkXml(
    xml,
    () => undefined,
    (open, close) => {
      const mark = open.tag.attrs.find(([name]) => name === `${prefix}:at`);
      if (mark === undefined) return;
      const slot = Number(mark[1]);
      found.set(slot, (found.get(slot) ?? 0) + 1);
      const texts = (bySlot.get(slot) ?? []).map((fragment) => withNamespaces(fragment, open.scope));
      // The line of the tag the fragments go before (or into), when the tag starts that line.
      const lead = (at: number): string | undefined => {
        const indent = xml.slice(xml.lastIndexOf('\n', at - 1) + 1, at);
        return indent.trim() === '' ? indent : undefined;
      };
      const head = unmark(xml.slice(open.tag.start, open.tag.end));
      if (close !== undefined) {
        edits.push({ from: open.tag.start, to: open.tag.end, text: head });
        const indent = lead(close.start);
        if (indent === undefined) edits.push({ from: close.start, to: close.start, text: texts.join('') });
        else edits.push({ from: close.start - indent.length, to: close.start - indent.length, text: texts.map((text) => `${indent}  ${text}\n`).join('') });
        return;
      }
      // `<parent … />` opens up to hold them.
      const indent = lead(open.tag.start);
      const body = indent === undefined ? texts.join('') : `\n${texts.map((text) => `${indent}  ${text}\n`).join('')}${indent}`;
      edits.push({ from: open.tag.start, to: open.tag.end, text: `${head.slice(0, -2).trimEnd()}>${body}</${open.tag.name}>` });
    },
  );
  const lost: ContentLossIssue[] = [];
  for (const [slot, held] of bySlot) {
    const times = found.get(slot) ?? 0;
    if (times === 1) continue;
    // Gone with an element the change removed on purpose: so is what it held. Anything else (the
    // parent rebuilt, or copied) leaves the fragment without the one place it came from.
    if (times === 0 && held.every((fragment) => fragment.anchor !== null && removed(fragment.anchor) && !ids.has(fragment.anchor))) continue;
    lost.push(...held.map((fragment): ContentLossIssue => ({ kind: 'misplaced', tag: fragment.tag, line: fragment.line, anchor: fragment.anchor ?? '' })));
  }
  if (lost.length > 0) throw new ContentLossError(lost);
  const out = applyEdits(xml, edits);
  if (out.includes(prefix)) throw new ContentLossError([{ kind: 'other', detail: `the mark ${prefix} of the kept elements is still in the output` }]);
  return out;
}

/* ------------------------------------------------------------------------------------------- */
/* Warnings                                                                                      */
/* ------------------------------------------------------------------------------------------- */

const UNPARSABLE = /^unparsable content ([\s\S]*?) ?detected\n\tline: (\d+)\n\tcolumn: (\d+)\n\tnested error: ([\s\S]*)$/;

interface Sorted {
  /** Elements to set aside: offset of the opening tag → 1-based line. */
  readonly aside: Map<number, number>;
  readonly unresolved: ModdleWarning[];
  readonly issues: ContentLossIssue[];
}

function sort(xml: string, warnings: readonly ModdleWarning[]): Sorted {
  const sorted: Sorted = { aside: new Map(), unresolved: [], issues: [] };
  let starts: number[] | undefined;
  for (const warning of warnings) {
    const message = typeof warning?.message === 'string' ? warning.message : String(warning);
    if (message.startsWith('unsupported document encoding ')) continue;
    if (message.startsWith('unknown attribute ') && warning.element !== undefined && typeof warning.property === 'string') {
      // Without a prefix it is written back as it is; with one (`bpmn:thing`) it would lose it.
      if (warning.property.includes(':')) {
        sorted.issues.push({ kind: 'prefixedAttribute', attribute: warning.property, element: warning.element.id ?? warning.element.$type });
      }
      continue;
    }
    if (message.startsWith('unresolved reference ') && warning.element !== undefined && warning.property !== undefined) {
      sorted.unresolved.push(warning);
      continue;
    }
    const match = UNPARSABLE.exec(message);
    if (match === null) {
      sorted.issues.push({ kind: 'other', detail: message });
      continue;
    }
    const [, data, lineText, columnText, nested] = match as unknown as [string, string, string, string, string];
    const line = Number(lineText) + 1;
    const tag = data.replace(/^<|>$/g, '').trim();
    const quoted = /<([\s\S]*)>$/.exec(nested)?.[1] ?? '';
    if (nested.startsWith('duplicate ID ')) sorted.issues.push({ kind: 'duplicateId', id: quoted, tag, line });
    else if (nested.startsWith('illegal ID ')) sorted.issues.push({ kind: 'illegalId', id: quoted, tag, line });
    else if (nested.startsWith('unexpected body text ')) sorted.issues.push({ kind: 'strayText', text: quoted.trim().replace(/\s+/g, ' '), line });
    else if (nested.startsWith('unrecognized element ') || nested.startsWith('unknown type ')) {
      // saxen's line and column are 0-based.
      starts ??= lineStarts(xml);
      const offset = line - 1 < starts.length ? starts[line - 1]! + Number(columnText) : -1;
      if (offset >= 0 && xml[offset] === '<' && /[^/!?]/.test(xml[offset + 1] ?? '')) sorted.aside.set(offset, line);
      else sorted.issues.push({ kind: 'other', detail: message });
    } else sorted.issues.push({ kind: 'other', detail: message });
  }
  return sorted;
}

/* ------------------------------------------------------------------------------------------- */
/* References                                                                                    */
/* ------------------------------------------------------------------------------------------- */

interface Dangling {
  readonly element: ModdleElement;
  /** Qualified name of the property (`bpmn:messageRef`). */
  readonly name: string;
  readonly isMany: boolean;
  /** Every id the property had in the file, in order, and which of them no element has. */
  readonly ids: readonly string[];
  readonly missing: ReadonlySet<number>;
  /** The id of the element, or of the nearest element around it that has one. */
  readonly owner: string | undefined;
}

function dangling(
  unresolved: readonly ModdleWarning[],
  references: readonly { element: ModdleElement; property: string; id: string }[],
): Dangling[] {
  const result: Dangling[] = [];
  const seen = new Map<ModdleElement, Set<string>>();
  for (const { element, property: name } of unresolved) {
    if (element === undefined || name === undefined) continue;
    const names = seen.get(element) ?? new Set<string>();
    seen.set(element, names);
    if (names.has(name)) continue;
    names.add(name);
    const property = element.$descriptor?.propertiesByName[name];
    if (property === undefined) continue;
    const mine = references.filter((r) => r.element === element && r.property === name);
    const missing = new Set(mine.flatMap((r, index) => (unresolved.some((w) => w.element === element && w.property === name && w.value === r.id) ? [index] : [])));
    let holder: ModdleElement | undefined = element;
    while (holder !== undefined && typeof holder.id !== 'string') holder = holder.$parent;
    result.push({ element, name, isMany: property.isMany === true, ids: mine.map((r) => r.id), missing, owner: holder?.id });
  }
  return result;
}

/** The elements bpmn-moddle knows the type of that `root` contains, itself included. */
function* contained(root: ModdleElement): Generator<ModdleElement> {
  const seen = new Set<object>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value !== 'object' || value === null || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      stack.push(...(value as unknown[]));
      continue;
    }
    const element = value as ModdleElement & Record<string, unknown>;
    // Generic content (another vendor's extension) is not part of the model: its `id` is no id.
    if (typeof element.$type !== 'string' || element.$descriptor === undefined || element.$descriptor.isGeneric === true) continue;
    yield element;
    // References are not enumerable on a moddle element: its own keys are what it contains.
    for (const key of Object.keys(element)) if (key !== '$parent') stack.push(element[key]);
  }
}

/**
 * Puts the ids no element has back where they were, as stand-ins that carry only the id (all the
 * serialiser reads of a reference), and returns how to take them out again. A single reference an
 * edit has set since keeps what the edit gave it. An element the edit replaced by another of the
 * same id (`setType`) hands them to its replacement, when that has the property too.
 */
function standIn(danglings: readonly Dangling[], root: ModdleElement, removed: ReadonlySet<string>): () => void {
  const tree = new Set<ModdleElement>();
  const byId = new Map<string, ModdleElement>();
  for (const element of contained(root)) {
    tree.add(element);
    if (typeof element.id === 'string') byId.set(element.id, element);
  }
  const undo: (() => void)[] = [];
  const issues: ContentLossIssue[] = [];
  for (const { element, name, isMany, ids, missing, owner } of danglings) {
    let target = element;
    if (!tree.has(element)) {
      const lost = (): void => {
        for (const index of missing) issues.push({ kind: 'danglingRef', property: local(name), ref: ids[index]!, element: owner ?? element.$type });
      };
      const replacement = typeof element.id === 'string' ? byId.get(element.id) : undefined;
      if (replacement !== undefined) {
        const property = replacement.$descriptor?.propertiesByName[name];
        if (property === undefined || property.isReference !== true || (property.isMany === true) !== isMany) {
          lost();
          continue;
        }
        target = replacement;
      } else if (owner !== undefined && removed.has(owner) && !byId.has(owner)) {
        // Removed on purpose, with what it referred to.
        continue;
      } else {
        lost();
        continue;
      }
    }
    if (!isMany) {
      if (target.get?.(name) !== undefined) continue;
      target.set?.(name, { id: ids[ids.length - 1]! });
      undo.push(() => target.set?.(name, undefined));
      continue;
    }
    const collection = target.get?.(name) as { id?: unknown }[] | undefined;
    if (collection === undefined) continue;
    const before = [...collection];
    // The list as it was read, each id in its place; the references still there are matched in
    // order (one that repeats, each time), and what the edit added stays where the edit put it.
    const next: { id?: unknown }[] = [];
    let from = 0;
    for (const [index, id] of ids.entries()) {
      if (missing.has(index)) {
        next.push({ id });
        continue;
      }
      const at = collection.findIndex((entry, position) => position >= from && entry?.id === id);
      if (at === -1) continue;
      next.push(...collection.slice(from, at + 1));
      from = at + 1;
    }
    next.push(...collection.slice(from));
    collection.splice(0, collection.length, ...next);
    undo.push(() => collection.splice(0, collection.length, ...before));
  }
  const restore = (): void => {
    for (const step of undo) step();
  };
  if (issues.length > 0) {
    restore();
    throw new ContentLossError(issues);
  }
  return restore;
}

/* ------------------------------------------------------------------------------------------- */

/**
 * Reads `xml` with bpmn-moddle (and the `lila` extension) for a writer. Throws `ContentLossError`
 * when the file has content that neither bpmn-moddle nor this module can carry to the output.
 */
export async function readLossless(xml: string): Promise<LosslessBpmn> {
  const moddle = BpmnModdle({ lila });
  let read = await moddle.fromXML(xml);
  // The common case, and the only one before #724: nothing to carry, bpmn-moddle's output as it is.
  if (read.warnings.length === 0) {
    const root = read.rootElement;
    return { moddle, root, reserved: new Set(), holds: () => false, write: async () => (await moddle.toXML(root, { format: true })).xml };
  }

  let sorted = sort(xml, read.warnings);
  let fragments: Fragment[] = [];
  const mark = markFor(xml);
  if (sorted.issues.length === 0) {
    const vendor = vendorContent(xml, new Set(moddle.getPackages().map((pkg) => pkg.uri)), sorted.aside);
    sorted.issues.push(...vendor.issues);
    const aside = new Map([...sorted.aside, ...vendor.aside]);
    if (sorted.issues.length === 0 && aside.size > 0) {
      const cut = setAside(xml, aside, mark);
      fragments = cut.fragments;
      read = await moddle.fromXML(cut.xml);
      sorted = sort(cut.xml, read.warnings);
      sorted.issues.push(...cut.issues);
      // Whatever is still unreadable is not something this module knows how to carry.
      for (const line of sorted.aside.values()) sorted.issues.push({ kind: 'other', detail: `unparsable content at line ${line}` });
    }
  }
  if (sorted.issues.length > 0) throw new ContentLossError(sorted.issues);

  const root = read.rootElement;
  const danglings = dangling(sorted.unresolved, read.references);
  const reserved = new Set<string>();
  for (const { ids, missing } of danglings) for (const index of missing) reserved.add(ids[index]!);
  for (const fragment of fragments) {
    for (const tag of tags(fragment.text)) for (const [name, value] of tag.attrs) if (name === 'id') reserved.add(value);
  }
  /** Shape or edge id → id of the element it draws, as read. */
  const drawn = new Map<string, string>();
  for (const element of contained(root)) {
    if (typeof element.id === 'string' && typeof element.bpmnElement?.id === 'string') drawn.set(element.id, element.bpmnElement.id);
  }
  return {
    moddle,
    root,
    reserved,
    holds: (element) => element.$attrs?.[`${mark.prefix}:at`] !== undefined,
    write: async (options = {}) => {
      const removed = new Set(options.removed ?? []);
      const restore = standIn(danglings, root, removed);
      let out: string;
      try {
        out = (await moddle.toXML(root, { format: true })).xml;
      } finally {
        restore();
      }
      if (fragments.length === 0) return out;
      const ids = new Set<string>();
      for (const element of contained(root)) if (typeof element.id === 'string') ids.add(element.id);
      // The drawing of a removed element is removed with it.
      const gone = (anchor: string): boolean => removed.has(anchor) || removed.has(drawn.get(anchor) ?? '');
      return putBack(out, fragments, mark, gone, ids);
    },
  };
}
