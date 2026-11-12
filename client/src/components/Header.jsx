export default function Header() {
  return (
    <header className="border-b-2 border-ink bg-cream">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        {/* Not a heading: each page has its own <h1>, and a logo is not one. */}
        <span className="font-heading text-2xl font-extrabold uppercase tracking-tight">NavTailor</span>
        <span className="border-2 border-ink px-2 py-1 font-mono text-xs uppercase">
          Resume tailoring
        </span>
      </div>
    </header>
  );
}
