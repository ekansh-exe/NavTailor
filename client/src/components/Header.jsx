export default function Header() {
  return (
    <header className="border-b-2 border-ink bg-cream">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <h1 className="text-2xl tracking-tight">NavTailor</h1>
        <span className="border-2 border-ink px-2 py-1 font-mono text-xs uppercase">
          Resume tailoring
        </span>
      </div>
    </header>
  );
}
