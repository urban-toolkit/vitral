export function debounce<T extends (...args: any[]) => void>(fn: T, waitMs: number) {
  let t: number | undefined;

  const wrapped = (...args: Parameters<T>) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), waitMs);
  };

  wrapped.cancel = () => {
    if (t) window.clearTimeout(t);
    t = undefined;
  };

  return wrapped as T & { cancel: () => void };
}
