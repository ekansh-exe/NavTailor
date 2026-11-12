import { useEffect, useRef } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';

// Loading, error and empty states, one look everywhere.

// role="status" makes screen readers announce the label politely when it appears.
export function Loading({ label = 'Loading', className = '' }) {
  return (
    <div role="status" className={`flex items-center gap-3 border-2 border-ink bg-cream p-6 font-mono text-sm uppercase ${className}`}>
      <Spinner />
      {label}…
    </div>
  );
}

export function Spinner({ size = 16 }) {
  return <Loader2 size={size} strokeWidth={2.5} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />;
}

// role="alert" announces the message at once. `focus` moves keyboard focus to the box, for errors
// that appear after a button press, so the user lands on the explanation instead of the page top.
export function ErrorBox({ message, onRetry, retryLabel = 'Try again', focus = false, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus, message]);

  return (
    <div ref={ref} role="alert" tabIndex={-1} className="border-2 border-ink bg-alert p-4 shadow-hard">
      <p className="flex items-start gap-2 font-mono text-sm font-bold">
        <TriangleAlert size={16} strokeWidth={2.5} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </p>
      {children}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 cursor-pointer border-2 border-ink bg-cream px-3 py-2 font-mono text-xs font-bold uppercase shadow-hard active:translate-x-1 active:translate-y-1 active:shadow-none"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

// A small "nothing here yet" line for lists inside a card (jobs, bullets, links...).
export function EmptyNote({ children }) {
  return <p className="border-2 border-ink bg-cream p-4 font-mono text-sm">{children}</p>;
}
