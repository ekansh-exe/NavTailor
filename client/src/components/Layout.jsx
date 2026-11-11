import Header from './Header.jsx';

export default function Layout({ children }) {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-4xl px-6 py-10">{children}</main>
    </div>
  );
}
