/**
 * A minimal DOM, enough to render the frontend's modules under `node:test`.
 *
 * The UI is plain ES modules building real nodes, so a small stub lets the
 * actual view code run in a test process. This exists because a
 * use-before-declaration bug in `taskRow` reached the browser unnoticed: the
 * module parsed fine, so `node --check` passed, and nothing ever executed it.
 */

export class StubNode {
  childNodes: StubNode[] = [];
  parentNode: StubNode | null = null;
}

export class StubText extends StubNode {
  data: string;
  constructor(data: string) {
    super();
    this.data = data;
  }
}

export class StubElement extends StubNode {
  className = '';
  attributes = new Map<string, string>();
  listeners = new Map<string, ((event: unknown) => void)[]>();
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  value = '';
  disabled = false;
  selectedOptions: StubElement[] = [];
  #innerHTML = '';

  tagName: string;

  constructor(tagName: string) {
    super();
    this.tagName = tagName;
  }

  get innerHTML(): string {
    return this.#innerHTML;
  }
  set innerHTML(value: string) {
    this.#innerHTML = value;
    this.childNodes = [];
  }

  get textContent(): string {
    return this.childNodes
      .map((child) => (child instanceof StubText ? child.data : (child as StubElement).textContent))
      .join('');
  }
  set textContent(value: string) {
    this.childNodes = [new StubText(value)];
  }

  get firstChild(): StubNode | null {
    return this.childNodes[0] ?? null;
  }

  /**
   * Mirrors the browser: anything that is not a Node is converted to a string,
   * so passing `null` appends the literal text "null" exactly as it would on a
   * real page. Tests then catch that rather than the stub masking it.
   */
  append(...nodes: unknown[]): void {
    for (const node of nodes) {
      const child = node instanceof StubNode ? node : new StubText(String(node));
      child.parentNode = this;
      this.childNodes.push(child);
    }
  }

  get parentElement(): StubElement | null {
    return this.parentNode instanceof StubElement ? this.parentNode : null;
  }

  removeChild(child: StubNode): void {
    this.childNodes = this.childNodes.filter((c) => c !== child);
  }

  replaceChildren(...nodes: unknown[]): void {
    this.childNodes = [];
    this.append(...nodes);
  }

  setAttribute(key: string, value: string): void {
    this.attributes.set(key, value);
    if (key === 'value') this.value = value;
  }

  /**
   * `<details>` reflects its `open` attribute onto the property and back, so
   * the stub does the same — otherwise a view that opens a panel by property
   * and a test that reads the attribute would disagree.
   */
  get open(): boolean {
    return this.attributes.has('open');
  }
  set open(value: boolean) {
    if (value) this.attributes.set('open', '');
    else this.attributes.delete('open');
  }

  getAttribute(key: string): string | null {
    return this.attributes.get(key) ?? null;
  }

  removeAttribute(key: string): void {
    this.attributes.delete(key);
  }

  hasAttribute(key: string): boolean {
    return this.attributes.has(key);
  }

  addEventListener(name: string, fn: (event: unknown) => void): void {
    const list = this.listeners.get(name) ?? [];
    list.push(fn);
    this.listeners.set(name, list);
  }

  /** Supports the simple class selectors the views actually use. */
  querySelector(selector: string): StubElement | null {
    const parts = selector.trim().split(/\s+/);
    const matchesPart = (node: StubElement, part: string): boolean => {
      if (part.startsWith('.')) return node.classList().includes(part.slice(1));
      return node.tagName === part;
    };
    const search = (node: StubElement, remaining: string[]): StubElement | null => {
      const [head, ...tail] = remaining;
      if (head === undefined) return node;
      for (const child of node.elements()) {
        if (matchesPart(child, head)) {
          const found = search(child, tail);
          if (found) return found;
        }
        const deeper = search(child, remaining);
        if (deeper && deeper !== child) return deeper;
      }
      return null;
    };
    return search(this, parts);
  }

  classList(): string[] {
    return this.className.split(/\s+/).filter(Boolean);
  }

  elements(): StubElement[] {
    return this.childNodes.filter((c): c is StubElement => c instanceof StubElement);
  }

  /** Flattened text of the whole subtree, for assertions. */
  text(): string {
    return this.textContent;
  }

  /** Every class name used anywhere in the subtree. */
  allClasses(): string[] {
    return [...this.classList(), ...this.elements().flatMap((e) => e.allClasses())];
  }
}

export type DomHandle = {
  root: StubElement;
  restore: () => void;
};

/** Install the stub as the process-wide `document`/`Node`/`localStorage`. */
export function installDom(): DomHandle {
  const store = new Map<string, string>();
  const toast = new StubElement('div');

  const document = {
    createElement: (tag: string) => new StubElement(tag),
    createTextNode: (text: string) => new StubText(text),
    getElementById: (id: string) => (id === 'toast' ? toast : new StubElement('div')),
    body: new StubElement('body'),
  };

  const previous = {
    document: (globalThis as Record<string, unknown>).document,
    Node: (globalThis as Record<string, unknown>).Node,
    localStorage: (globalThis as Record<string, unknown>).localStorage,
    location: (globalThis as Record<string, unknown>).location,
  };

  Object.assign(globalThis as Record<string, unknown>, {
    document,
    Node: StubNode,
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
    location: { hash: '' },
  });

  return {
    root: new StubElement('div'),
    restore: () => Object.assign(globalThis as Record<string, unknown>, previous),
  };
}

/**
 * Point the frontend's relative `fetch` calls at a running test server, so the
 * views run against the real API rather than fixtures.
 */
export function installFetch(baseUrl: string): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' && input.startsWith('/') ? `${baseUrl}${input}` : input;
    return real(url as string, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}
