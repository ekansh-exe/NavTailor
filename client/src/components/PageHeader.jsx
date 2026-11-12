// Title row for every /app page: small mono tag, the page's one <h1>, optional actions on the right.
export default function PageHeader({ tag, title, children }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {tag && <span className="font-mono text-xs uppercase">{tag}</span>}
        <h1 className="mt-1 text-3xl sm:text-4xl">{title}</h1>
      </div>
      {children}
    </div>
  );
}
