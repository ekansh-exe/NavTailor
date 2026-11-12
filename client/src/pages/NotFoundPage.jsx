import { Link } from 'react-router';

export default function NotFoundPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-24">
      <span className="border-2 border-ink bg-alert px-3 py-1 font-mono text-xs font-bold uppercase shadow-hard">
        404
      </span>
      <h2 className="mt-8 text-5xl leading-[0.95] sm:text-6xl">Page not found</h2>
      <p className="mt-6 font-mono text-sm">Nothing lives at this address.</p>
      <Link
        to="/"
        className="mt-8 inline-block border-2 border-ink bg-ink px-6 py-3 font-mono text-sm font-bold uppercase text-cream shadow-hard active:translate-x-1 active:translate-y-1 active:shadow-none"
      >
        Go home
      </Link>
    </main>
  );
}
