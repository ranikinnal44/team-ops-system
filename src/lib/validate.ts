/**
 * A small, fully typed schema validator.
 *
 * Deliberately hand-rolled rather than pulling in a dependency: the surface we
 * need is narrow, and it keeps the runtime dependency count at zero. Each
 * validator parses `unknown` into a known type or throws an `AppError` carrying
 * per-field details.
 */
import { validationError, type ErrorDetail } from './errors.ts';
import { isIsoDate } from './dates.ts';

export type Validator<T> = {
  readonly parse: (value: unknown, path: string, sink: ErrorDetail[]) => T | undefined;
  readonly optional?: true;
};

type Out<V> = V extends Validator<infer T> ? T : never;
type Shape = Record<string, Validator<unknown>>;
type OptionalKeys<S extends Shape> = {
  [K in keyof S]: undefined extends Out<S[K]> ? K : never;
}[keyof S];
type RequiredKeys<S extends Shape> = Exclude<keyof S, OptionalKeys<S>>;

export type Infer<S extends Shape> = {
  [K in RequiredKeys<S>]: Out<S[K]>;
} & {
  [K in OptionalKeys<S>]?: Out<S[K]>;
};

const fail = (sink: ErrorDetail[], path: string, message: string): undefined => {
  sink.push({ path, message });
  return undefined;
};

export function str(opts: { min?: number; max?: number; pattern?: RegExp; trim?: boolean } = {}): Validator<string> {
  const { min = 1, max = 10_000, pattern, trim = true } = opts;
  return {
    parse(value, path, sink) {
      if (typeof value !== 'string') return fail(sink, path, 'must be a string');
      const out = trim ? value.trim() : value;
      if (out.length < min) return fail(sink, path, `must be at least ${min} character(s)`);
      if (out.length > max) return fail(sink, path, `must be at most ${max} character(s)`);
      if (pattern && !pattern.test(out)) return fail(sink, path, 'has an invalid format');
      return out;
    },
  };
}

export function int(opts: { min?: number; max?: number } = {}): Validator<number> {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = opts;
  return {
    parse(value, path, sink) {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isInteger(n)) return fail(sink, path, 'must be an integer');
      if (n < min) return fail(sink, path, `must be >= ${min}`);
      if (n > max) return fail(sink, path, `must be <= ${max}`);
      return n;
    },
  };
}

export function bool(): Validator<boolean> {
  return {
    parse(value, path, sink) {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return fail(sink, path, 'must be a boolean');
    },
  };
}

export function isoDate(): Validator<string> {
  return {
    parse(value, path, sink) {
      if (typeof value !== 'string' || !isIsoDate(value)) {
        return fail(sink, path, 'must be a calendar date formatted YYYY-MM-DD');
      }
      return value;
    },
  };
}

/**
 * An http(s) URL. Evidence links point at Drive/GitHub/etc., so we accept any
 * web URL but reject other schemes.
 */
export function url(): Validator<string> {
  return {
    parse(value, path, sink) {
      if (typeof value !== 'string') return fail(sink, path, 'must be a string');
      const trimmed = value.trim();
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        return fail(sink, path, 'must be a valid URL');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return fail(sink, path, 'must be an http(s) URL');
      }
      return trimmed;
    },
  };
}

export function oneOf<const T extends readonly string[]>(values: T): Validator<T[number]> {
  return {
    parse(value, path, sink) {
      if (typeof value !== 'string' || !values.includes(value)) {
        return fail(sink, path, `must be one of: ${values.join(', ')}`);
      }
      return value as T[number];
    },
  };
}

export function arrayOf<T>(item: Validator<T>, opts: { max?: number } = {}): Validator<T[]> {
  const { max = 200 } = opts;
  return {
    parse(value, path, sink) {
      if (!Array.isArray(value)) return fail(sink, path, 'must be an array');
      if (value.length > max) return fail(sink, path, `must contain at most ${max} item(s)`);
      const before = sink.length;
      const out = value.map((entry, i) => item.parse(entry, `${path}[${i}]`, sink));
      return sink.length === before ? (out as T[]) : undefined;
    },
  };
}

/** Accepts `null` or the wrapped type. Used for clearable columns. */
export function nullable<T>(inner: Validator<T>): Validator<T | null> {
  return {
    parse(value, path, sink) {
      if (value === null) return null;
      return inner.parse(value, path, sink);
    },
  };
}

/** Marks a key as absent-able. Combine with `nullable` for "absent or null". */
export function optional<T>(inner: Validator<T>): Validator<T | undefined> {
  return {
    optional: true,
    parse(value, path, sink) {
      if (value === undefined) return undefined;
      return inner.parse(value, path, sink);
    },
  };
}

/** `optional(nullable(x))`, the common shape for a clearable optional field. */
export const optionalNullable = <T>(inner: Validator<T>): Validator<T | null | undefined> =>
  optional(nullable(inner));

export function object<S extends Shape>(shape: S): Validator<Infer<S>> {
  return {
    parse(value, path, sink) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail(sink, path || 'body', 'must be an object');
      }
      const source = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      const before = sink.length;
      for (const [key, validator] of Object.entries(shape)) {
        const childPath = path ? `${path}.${key}` : key;
        const raw = source[key];
        if (raw === undefined && !validator.optional) {
          fail(sink, childPath, 'is required');
          continue;
        }
        const parsed = validator.parse(raw, childPath, sink);
        if (parsed !== undefined || (key in source && raw === undefined && validator.optional)) {
          if (parsed !== undefined) out[key] = parsed;
        }
      }
      return sink.length === before ? (out as Infer<S>) : undefined;
    },
  };
}

/** Run a validator, throwing a single aggregated `AppError` on failure. */
export function parseOrThrow<T>(validator: Validator<T>, value: unknown, path = ''): T {
  const sink: ErrorDetail[] = [];
  const parsed = validator.parse(value, path, sink);
  if (sink.length > 0 || parsed === undefined) {
    throw validationError('Request validation failed', sink);
  }
  return parsed;
}

/** True when a PATCH-style payload set at least one field. */
export function hasAnyKey(payload: object): boolean {
  return Object.keys(payload).length > 0;
}
