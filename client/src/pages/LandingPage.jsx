import {
  ArrowRight,
  FileText,
  Gauge,
  ListChecks,
  ScanSearch,
  ShieldCheck,
  SplitSquareHorizontal,
} from 'lucide-react';
import GoogleSignInButton from '../components/GoogleSignInButton.jsx';
import SkipLink from '../components/SkipLink.jsx';

// Every claim here describes something the app really does. Keep it that way.
const FEATURES = [
  {
    icon: ScanSearch,
    title: 'Reads the job post',
    body: 'Pulls the skills, tools and duties out of the description so you see what the role is asking for.',
  },
  {
    icon: Gauge,
    title: 'Ranks your bullets',
    body: 'Scores every item in your master profile against the role and puts the strongest ones first.',
  },
  {
    icon: ShieldCheck,
    title: 'No invented facts',
    body: 'Rewrites are checked against your profile. New numbers, tools or employers get rejected.',
  },
  {
    icon: FileText,
    title: 'Fits one page',
    body: 'Compiles real LaTeX to PDF and trims the weakest lines until the resume lands on a single page.',
  },
  {
    icon: ListChecks,
    title: 'Shows the gaps',
    body: 'Lists what the role wants that your profile does not cover yet, plus questions to fill it in.',
  },
  {
    icon: SplitSquareHorizontal,
    title: 'You approve edits',
    body: 'Every reworded line sits next to the original. Keep it or throw it out before you download.',
  },
];

const MARQUEE_ITEMS = [
  'One master profile',
  'Any job description',
  'Tailored in minutes',
  'LaTeX to PDF',
  'One page, every time',
  'Your facts only',
];

export default function LandingPage() {
  return (
    <main id="main" tabIndex={-1} className="focus:outline-none">
      <Hero />
      <Marquee />
      <FeatureGrid />
      <SignInBlock />
    </main>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-5xl px-6 pb-16 pt-14 sm:pt-20">
      <span className="inline-block border-2 border-ink bg-alert px-3 py-1 font-mono text-xs font-bold uppercase shadow-hard">
        Resume tailoring, minus the guesswork
      </span>

      <h1 className="mt-8 text-5xl leading-[0.95] tracking-tight sm:text-7xl">
        One profile.
        <br />
        Every job.
        <br />
        Zero fiction.
      </h1>

      <p className="mt-8 max-w-2xl text-lg">
        Keep a single master profile. Paste a job description. NavTailor picks your most relevant
        experience, sharpens the wording and hands back a one-page PDF built only from what you
        actually did.
      </p>

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <a
          href="#start"
          className="inline-flex items-center gap-2 border-2 border-ink bg-ink px-6 py-3 font-mono text-sm font-bold uppercase text-cream shadow-hard active:translate-x-1 active:translate-y-1 active:shadow-none"
        >
          Tailor my resume
          <ArrowRight size={18} strokeWidth={2.5} aria-hidden="true" />
        </a>
        <span className="font-mono text-xs uppercase">Free. Google sign-in.</span>
      </div>
    </section>
  );
}

function Marquee() {
  // The track holds the list twice. The animation slides it left by exactly one copy,
  // then jumps back to the start, which looks like an endless loop.
  const copy = (hidden) => (
    <ul className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {MARQUEE_ITEMS.map((item) => (
        <li key={item} className="flex items-center whitespace-nowrap">
          <span className="px-6 font-heading text-lg font-extrabold uppercase">{item}</span>
          <span className="text-alert" aria-hidden="true">
            ✦
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="overflow-hidden border-y-2 border-ink bg-ink py-4 text-cream">
      <div className="flex w-max animate-marquee motion-reduce:animate-none">
        {copy(false)}
        {copy(true)}
      </div>
    </div>
  );
}

function FeatureGrid() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20">
      <span className="font-mono text-xs uppercase">What it does</span>
      <h2 className="mt-2 text-3xl sm:text-4xl">Built to get you shortlisted</h2>

      {/* Negative margins + borders on each cell give one shared 2px grid line. */}
      <div className="mt-10 grid border-2 border-ink bg-cream shadow-hard sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <article key={title} className="-mb-[2px] -mr-[2px] border-b-2 border-r-2 border-ink p-6">
            <div className="inline-flex border-2 border-ink bg-alert p-2">
              <Icon size={22} strokeWidth={2.5} aria-hidden="true" />
            </div>
            <h3 className="mt-4 text-lg">{title}</h3>
            <p className="mt-2 text-sm">{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function SignInBlock() {
  return (
    <section id="start" className="mx-auto max-w-5xl scroll-mt-6 px-6 pb-24">
      <div className="flex flex-col items-start gap-6 border-2 border-ink bg-cream p-8 shadow-hard sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl sm:text-3xl">Start with your profile</h2>
          <p className="mt-2 font-mono text-sm">Sign in, import your current resume, then tailor.</p>
        </div>
        <GoogleSignInButton />
      </div>
    </section>
  );
}
