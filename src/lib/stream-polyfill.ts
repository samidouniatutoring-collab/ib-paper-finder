// Safari (incl. installed web apps) can't do `for await (const x of readableStream)`; pdf.js 5 relies on it
// for text extraction, so uploads failed with "undefined is not a function (near '...i of e...')".
// Adds ReadableStream async iteration where it's missing. Safe to load more than once.
type Iter = AsyncIterableIterator<unknown> & { return(v?: unknown): Promise<IteratorResult<unknown>> };
const RS = (globalThis as unknown as { ReadableStream?: { prototype: Record<PropertyKey, unknown> } }).ReadableStream;
if (RS && typeof RS.prototype[Symbol.asyncIterator] !== "function") {
  const values = function (this: ReadableStream, opts: { preventCancel?: boolean } = {}): Iter {
    const reader = this.getReader();
    const it: Iter = {
      async next() {
        try {
          const r = await reader.read();
          if (r.done) reader.releaseLock();
          return r as IteratorResult<unknown>;
        } catch (e) {
          reader.releaseLock();
          throw e;
        }
      },
      async return(value?: unknown) {
        if (!opts.preventCancel) {
          const p = reader.cancel(value);
          reader.releaseLock();
          await p;
        } else reader.releaseLock();
        return { done: true, value };
      },
      [Symbol.asyncIterator]() {
        return it;
      },
    };
    return it;
  };
  if (typeof RS.prototype.values !== "function") RS.prototype.values = values;
  RS.prototype[Symbol.asyncIterator] = RS.prototype.values;
}
export {};
