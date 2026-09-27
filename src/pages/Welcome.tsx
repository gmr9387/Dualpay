/**
 * Public marketing / landing page. Not gated behind RequireAuth -- the
 * app's actual home ("/") stays the authenticated Command Center exactly
 * as it was; this is purely additive.
 *
 * Deliberately has no customer logos, testimonials, or performance
 * stats: Claim Clarity doesn't have real customers yet, and fabricating
 * social proof would be dishonest, not just a style choice. Every claim
 * on this page is either a real, verifiable property of the system
 * (deterministic + replayable adjudication, real COB/contract engines)
 * or clearly framed as an illustrative example, not a real result.
 *
 * Motion: scroll-reveal on section entry (useInView + Reveal), a looping
 * marquee for the capability strip, and small pulse/shimmer accents on the
 * mock data cards. All driven by CSS (tailwind.config.ts keyframes) rather
 * than a JS animation library, and disabled globally for
 * prefers-reduced-motion in index.css.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Shield, ArrowRight, FileCheck, Search, RotateCcw, Lock, ShieldCheck, KeyRound, Database, type LucideIcon } from 'lucide-react';
import heroClinician from '@/assets/marketing/hero-clinician.jpg';
import documentReview from '@/assets/marketing/document-review.jpg';

function useInView<T extends HTMLElement>(threshold = 0.15) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  return { ref, inView };
}

/** Fades + slides a section up into place the first time it scrolls into view. */
function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`}
      style={{ transitionDelay: inView ? `${delay}ms` : '0ms' }}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary mb-3">
      <span className="h-1.5 w-1.5 rounded-full bg-gold animate-pulse-dot" />
      {children}
    </div>
  );
}

/** Big faint editorial page-number, bled behind a section's heading column. */
function SectionNumber({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none select-none absolute -top-10 -left-2 md:-left-4 font-display text-[120px] md:text-[160px] font-bold text-primary/[0.06] leading-none z-0"
    >
      {children}
    </span>
  );
}

/** Editorial layering: a thin offset frame sits behind the card, like a
    matted photograph, giving it depth without a gimmicky tilt. Lifts
    slightly on hover. */
function Layered({ children, accent = 'gold' }: { children: ReactNode; accent?: 'gold' | 'primary' }) {
  const frame = accent === 'gold' ? 'border-gold/50' : 'border-primary/30';
  return (
    <div className="relative">
      <div aria-hidden className={`absolute -bottom-3 -right-3 sm:-bottom-4 sm:-right-4 h-full w-full rounded-xl border-2 ${frame}`} />
      <div className="relative rounded-xl shadow-2xl hover:-translate-y-1 transition-transform duration-300 ease-out">
        {children}
      </div>
    </div>
  );
}

function LiveBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-gold/20 text-gold">
      <span className="h-1 w-1 rounded-full bg-gold animate-pulse-dot" />
      {children}
    </span>
  );
}

function MockPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-xl p-8 flex items-center justify-center ${className}`}
      style={{ background: 'linear-gradient(155deg, hsl(152 42% 21%) 0%, hsl(150 45% 12%) 65%, hsl(42 55% 25%) 130%)' }}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 animate-shimmer opacity-60"
        style={{
          backgroundImage: 'linear-gradient(100deg, transparent 35%, hsl(0 0% 100% / 0.10) 50%, transparent 65%)',
          backgroundSize: '200% 100%',
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

function MockCard({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-lg bg-white border border-black/5 shadow-xl overflow-hidden">
      {children}
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div>
      <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground font-display font-bold text-[15px] flex items-center justify-center mb-4">
        {n}
      </div>
      <div className="font-display text-[17px] font-semibold">{title}</div>
      <p className="mt-1.5 text-[13.5px] text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function SecurityFact({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="rounded-xl border bg-card p-6 h-full">
      <div className="h-10 w-10 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center mb-4">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="font-display text-[15px] font-semibold">{title}</div>
      <p className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function PhotoCaption() {
  return (
    <>
      <h3 className="font-display text-white text-[22px] sm:text-[26px] font-semibold tracking-tight leading-tight">
        One record, both teams
      </h3>
      <p className="mt-3 text-[13px] text-white/80 leading-relaxed">
        Both teams look at the same claim, the same contract, and the same
        history. No comparing two different systems after the fact.
      </p>
    </>
  );
}

const CAPABILITIES = [
  { label: 'Same claim, same answer', detail: 'No exceptions' },
  { label: 'Right insurance pays first', detail: 'Every time, automatically' },
  { label: 'Reads your files automatically', detail: 'No new software to learn' },
  { label: 'Catches every mistake', detail: 'Underpaid or overpaid' },
  { label: 'Every decision, provable', detail: 'Replay it any time' },
  { label: 'Built for both sides', detail: 'Providers and payers' },
];

export default function Welcome() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Nav */}
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <span className="font-display font-bold text-[16px] tracking-tight">DualPay</span>
          </div>
          <Link to="/login" className="h-9 px-4 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 transition-colors">
            Sign in <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-16 grid lg:grid-cols-[1.05fr_0.95fr] gap-12 items-center">
        <div className="animate-fade-up">
          <Eyebrow>Get Paid What You're Owed</Eyebrow>
          <h1 className="font-display text-[46px] sm:text-[58px] font-semibold tracking-tight leading-[1.02]">
            One tool for both sides of every claim.
          </h1>
          <p className="mt-5 text-[16px] text-muted-foreground max-w-lg leading-relaxed">
            Every claim gets checked against your contract, automatically. If a
            provider was underpaid, we recover it. If a payer overpaid, we catch
            that too — from the same system.
          </p>
          <div className="mt-8 flex items-center gap-3">
            <Link to="/login" className="h-11 px-6 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground text-[14px] font-medium hover:bg-primary/90 transition-colors">
              Sign in <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <p className="mt-4 text-[12px] text-muted-foreground/70">Access is invite-only. Contact your administrator to be added.</p>
        </div>
        <div className="relative animate-fade-up" style={{ animationDelay: '150ms' }}>
          <div className="rounded-2xl overflow-hidden border shadow-xl aspect-[4/5] lg:aspect-[3/4]">
            <img src={heroClinician} alt="Clinician reviewing claims on a laptop" className="w-full h-full object-cover" />
          </div>
          <div className="absolute -bottom-5 -left-5 rounded-lg bg-card border shadow-lg px-4 py-3 hidden sm:block">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-dot" /> Verified
            </div>
            <div className="font-display text-[15px] font-semibold text-primary">Same answer, every time</div>
          </div>
        </div>
      </section>

      {/* How it works -- the process, in plain terms, before the capability
          facts and feature deep-dives get specific. */}
      <section className="max-w-6xl mx-auto px-6 py-14 border-t">
        <Reveal>
          <Eyebrow>How It Works</Eyebrow>
          <h2 className="font-display text-[26px] sm:text-[30px] font-semibold tracking-tight max-w-lg">
            From raw files to a provable answer
          </h2>
        </Reveal>
        <div className="mt-9 grid sm:grid-cols-3 gap-8">
          <Reveal delay={0}>
            <Step n={1} title="Send us what you have" body="Claims, remittances, and contracts — in whatever format they're already in." />
          </Reveal>
          <Reveal delay={100}>
            <Step n={2} title="We check every claim" body="Against the real contract, in both directions, automatically — no sampling." />
          </Reveal>
          <Reveal delay={200}>
            <Step n={3} title="You get the findings" body="Underpayments to recover, overpayments to flag — each one you can replay and prove." />
          </Reveal>
        </div>
      </section>

      {/* Capability facts strip -- real, verifiable properties, not results.
          Full-bleed dark ticker, scrolling on a loop; pauses on hover so it
          stays readable if someone wants to actually read an item. */}
      <section className="overflow-hidden border-y border-gold/20" style={{ background: 'hsl(150 45% 9%)' }}>
        <div className="group py-7">
          <div className="flex w-max animate-marquee items-center group-hover:[animation-play-state:paused]">
            {[...CAPABILITIES, ...CAPABILITIES].map((s, i) => (
              <div key={i} className="flex items-center gap-4 shrink-0 pr-10">
                <span className="h-2 w-2 rounded-full bg-gold animate-pulse-dot shrink-0" />
                <div>
                  <div className="font-display text-white text-[20px] font-bold tracking-tight leading-none whitespace-nowrap">
                    {s.label}
                  </div>
                  <div className="text-[11px] text-gold/85 font-semibold uppercase tracking-wider mt-1.5 whitespace-nowrap">
                    {s.detail}
                  </div>
                </div>
                <span aria-hidden className="text-gold/25 text-3xl font-light pl-6 select-none">/</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Our Platform */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <Reveal>
          <Eyebrow>Our Platform</Eyebrow>
          <h2 className="font-display text-[34px] sm:text-[38px] font-semibold tracking-tight max-w-lg">
            Built for both sides of the claim
          </h2>
        </Reveal>
        <div className="mt-10 grid sm:grid-cols-2 gap-5">
          <Reveal delay={0}>
            <div className="group rounded-xl border bg-card p-7 h-full transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
              <div className="h-12 w-12 rounded-lg bg-accent flex items-center justify-center mb-4 transition-colors group-hover:bg-primary/15">
                <FileCheck className="h-6 w-6 text-primary" />
              </div>
              <div className="font-display text-[19px] font-semibold">Recover What You're Owed</div>
              <p className="mt-1.5 text-[13.5px] text-muted-foreground leading-relaxed">
                Every payment gets compared to your contract. If you were paid less than
                you should have been, we catch it, build the report, and prove it —
                automatically.
              </p>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="group rounded-xl border bg-card p-7 h-full transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
              <div className="h-12 w-12 rounded-lg bg-accent flex items-center justify-center mb-4 transition-colors group-hover:bg-primary/15">
                <Search className="h-6 w-6 text-primary" />
              </div>
              <div className="font-display text-[19px] font-semibold">Stop Overpaying Providers</div>
              <p className="mt-1.5 text-[13.5px] text-muted-foreground leading-relaxed">
                The same check runs in reverse. If you paid a provider more than the
                contract allows, we flag it — along with any insurance mix-ups in the
                same file.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Feature detail: COB */}
      <section className="max-w-6xl mx-auto px-6 py-16 grid md:grid-cols-2 gap-12 items-center overflow-visible">
        <Reveal className="relative">
          <SectionNumber>01</SectionNumber>
          <div className="relative z-10">
            <Eyebrow>Two Insurance Plans</Eyebrow>
            <h3 className="font-display text-[28px] sm:text-[32px] font-semibold tracking-tight leading-tight">
              The right plan pays first, every time
            </h3>
            <p className="mt-4 text-[14px] text-muted-foreground leading-relaxed">
              When a patient has two insurance plans, billing the wrong one first is an
              easy mistake to make. We work out the correct order automatically, using
              the real rules — never a guess. If we need the other plan's EOB first,
              the claim is routed there on its own.
            </p>
          </div>
        </Reveal>
        <Reveal delay={150}>
          <Layered accent="gold">
            <MockPanel>
              <MockCard>
                <div className="bg-[hsl(150_45%_12%)] px-4 py-2.5 flex items-center justify-between">
                  <span className="text-white text-[12.5px] font-medium">Member Coverage — COB Check</span>
                  <LiveBadge>RESOLVED</LiveBadge>
                </div>
                <div className="p-4 space-y-2 text-[12px] font-mono">
                  <div className="flex justify-between"><span className="text-muted-foreground">Primary</span><span>Employer Plan A</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Secondary</span><span>Spouse Plan B</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Rule applied</span><span>Birthday rule</span></div>
                  <div className="flex justify-between pt-2 border-t"><span className="text-muted-foreground">Status</span><span className="text-primary font-semibold">Routed to primary</span></div>
                </div>
              </MockCard>
            </MockPanel>
          </Layered>
        </Reveal>
      </section>

      {/* Feature detail: overpayment finding */}
      <section className="max-w-6xl mx-auto px-6 py-16 grid md:grid-cols-2 gap-12 items-center overflow-visible">
        <Reveal className="md:order-2 relative">
          <SectionNumber>02</SectionNumber>
          <div className="relative z-10">
            <Eyebrow>Payment Integrity</Eyebrow>
            <h3 className="font-display text-[28px] sm:text-[32px] font-semibold tracking-tight leading-tight">
              Catch payments that were too high
            </h3>
            <p className="mt-4 text-[14px] text-muted-foreground leading-relaxed">
              If a claim paid more than your contract allows, we catch it — and show
              exactly which rate was broken, by how much, and how serious it is.
            </p>
          </div>
        </Reveal>
        <Reveal className="md:order-1" delay={150}>
          <Layered accent="primary">
            <MockPanel>
              <MockCard>
                <div className="bg-[hsl(150_45%_12%)] px-4 py-2.5 flex items-center justify-between">
                  <span className="text-white text-[12.5px] font-medium">Payer Findings</span>
                  <LiveBadge>OVERPAYMENT</LiveBadge>
                </div>
                <div className="p-4 space-y-2 text-[12px] font-mono">
                  <div className="flex justify-between"><span className="text-muted-foreground">CPT</span><span>99214</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Contracted</span><span>$148.00</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span>$210.00</span></div>
                  <div className="flex justify-between pt-2 border-t"><span className="text-muted-foreground">Variance</span><span className="text-status-denied font-semibold">$62.00 · critical</span></div>
                </div>
              </MockCard>
            </MockPanel>
          </Layered>
        </Reveal>
      </section>

      {/* Feature detail: replay */}
      <section className="max-w-6xl mx-auto px-6 py-16 grid md:grid-cols-2 gap-12 items-center overflow-visible">
        <Reveal className="relative">
          <SectionNumber>03</SectionNumber>
          <div className="relative z-10">
            <Eyebrow>Proof, Not Guesswork</Eyebrow>
            <h3 className="font-display text-[28px] sm:text-[32px] font-semibold tracking-tight leading-tight">
              Show your work, any time
            </h3>
            <p className="mt-4 text-[14px] text-muted-foreground leading-relaxed">
              Run the same claim twice, get the same answer twice. Every decision is
              saved, so you can always go back and show exactly how we got that number —
              no digging through old faxes or spreadsheets.
            </p>
          </div>
        </Reveal>
        <Reveal delay={150}>
          <Layered accent="gold">
            <MockPanel>
              <MockCard>
                <div className="bg-[hsl(150_45%_12%)] px-4 py-2.5 flex items-center gap-2">
                  <RotateCcw className="h-3.5 w-3.5 text-gold" />
                  <span className="text-white text-[12.5px] font-medium">Decision Log</span>
                </div>
                <div className="p-4 space-y-2 text-[12px] font-mono">
                  <div className="flex justify-between"><span className="text-muted-foreground">Record ID</span><span className="truncate max-w-[140px]">a3f9…c221</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Rules checked</span><span>7</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Steps calculated</span><span>12</span></div>
                  <div className="flex justify-between pt-2 border-t"><span className="text-muted-foreground">Re-run result</span><span className="text-primary font-semibold">Same answer</span></div>
                </div>
              </MockCard>
            </MockPanel>
          </Layered>
        </Reveal>
      </section>

      {/* Security & compliance -- only claims that trace to something real
          in the codebase (docs/SECURITY.md, docs/HIPAA_OVERVIEW.md): RLS
          tenant isolation, role-scoped writes, TLS/AES-256, private
          storage. SOC 2 / a signed BAA are roadmap items, not claimed as
          done -- stated plainly rather than left implied. */}
      <section id="security" className="max-w-6xl mx-auto px-6 py-20 border-t scroll-mt-16">
        <Reveal>
          <Eyebrow>Security &amp; Compliance</Eyebrow>
          <h2 className="font-display text-[34px] sm:text-[38px] font-semibold tracking-tight max-w-lg">
            Built for data that can't leak
          </h2>
          <p className="mt-4 text-[14px] text-muted-foreground max-w-2xl leading-relaxed">
            DualPay handles protected health information. That shapes the system from
            the database up, not just the parts you can see.
          </p>
        </Reveal>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <Reveal delay={0}>
            <SecurityFact icon={Lock} title="Encrypted everywhere" body="TLS in transit, AES-256 at rest, for every claim and every document." />
          </Reveal>
          <Reveal delay={80}>
            <SecurityFact icon={ShieldCheck} title="Isolated by organization" body="Row-level security enforced in the database itself, not just hidden in the app." />
          </Reveal>
          <Reveal delay={160}>
            <SecurityFact icon={KeyRound} title="Role-based access" body="Analyst, manager, admin, owner — each permission checked at the database layer." />
          </Reveal>
          <Reveal delay={240}>
            <SecurityFact icon={Database} title="Private storage, always" body="Documents and evidence live in private buckets behind signed, single-use links." />
          </Reveal>
        </div>
        <Reveal delay={320}>
          <p className="mt-8 text-[12.5px] text-muted-foreground/80">
            SOC 2 and a signed HIPAA Business Associate Agreement are in progress —
            ask us for our current security documentation.
          </p>
        </Reveal>
      </section>

      {/* Full-width photo band. Caption sits centered below the photo at
          every size, rather than overlaid on it, so it never covers the
          image and looks the same on phone and desktop. */}
      <Reveal className="mx-6 mb-16">
        <section>
          <div className="rounded-2xl overflow-hidden">
            <img
              src={documentReview}
              alt="Team reviewing claim documentation together"
              className="w-full h-[220px] sm:h-[360px] lg:h-[440px] object-cover"
              style={{ objectPosition: '50% 13%' }}
            />
          </div>
          <div className="mt-5 sm:mt-6 mx-auto max-w-lg text-center rounded-xl p-5 sm:p-6"
            style={{ background: 'hsl(150 45% 9% / 0.94)' }}>
            <PhotoCaption />
          </div>
        </section>
      </Reveal>

      {/* Final CTA */}
      <Reveal className="mx-6 mb-16 rounded-2xl overflow-hidden">
        <section>
          <div className="px-8 py-16 sm:px-16 text-center"
            style={{ background: 'linear-gradient(135deg, hsl(150 45% 10%) 0%, hsl(152 42% 21%) 55%, hsl(42 55% 30%) 130%)' }}>
            <h2 className="font-display text-white text-[30px] sm:text-[36px] font-semibold tracking-tight max-w-xl mx-auto">
              Claims are complicated. Getting paid correctly shouldn't be.
            </h2>
            <Link to="/login" className="mt-7 h-11 px-6 inline-flex items-center gap-2 rounded-md bg-white text-[hsl(150_45%_12%)] text-[14px] font-medium hover:bg-white/90 transition-colors">
              Sign in <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </Reveal>

      <footer className="border-t">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row sm:items-start justify-between gap-6 text-[12px] text-muted-foreground">
          <div>
            <span className="font-display font-semibold text-foreground">DualPay</span>
            <div className="mt-2 space-y-0.5">
              <div>Detroit, MI</div>
              <div>
                <a href="tel:+13138269096" className="hover:text-foreground">(313) 826-9096</a>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <a href="#security" className="hover:text-foreground">Security</a>
            <Link to="/login" className="hover:text-foreground">Sign in</Link>
          </div>
        </div>
        <div className="border-t">
          <div className="max-w-6xl mx-auto px-6 py-4 text-[11px] text-muted-foreground/70">
            © {new Date().getFullYear()} DualPay
          </div>
        </div>
      </footer>
    </div>
  );
}
