// The first Tab stop on every page. Hidden until focused, then it jumps past the header and nav
// straight to <main id="main">. Without it, keyboard users tab through the whole nav on every page.
export default function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only border-2 border-ink bg-ink px-4 py-2 font-mono text-xs font-bold uppercase text-cream shadow-hard focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50"
    >
      Skip to content
    </a>
  );
}
