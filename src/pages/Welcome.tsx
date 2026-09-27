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
 */
import { Link } from 'react-router-dom';
import { Shield, ArrowRight, FileCheck, Search, RotateCcw } from 'lucide-react';
import heroClinician from '@/assets/marketing/hero-clinician.jpg';
import documentReview from '@/assets/marketing/document-review.jpg';

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary mb-3">
      <span className="h-1.5 w-1.5 rounded-full bg-gold" />
      {children}
    </div>
  );
}

function MockPanel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl p-8 flex items-center justify-center ${className}`}
      style={{ background: 'linear-gradient(155deg, hsl(152 42% 21%) 0%, hsl(150 45% 12%) 65%, hsl(42 55% 25%) 130%)' }}>
      {children}
    </div>
  );
}

function MockCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-lg bg-white border border-black/5 shadow-xl overflow-hidden">
      {children}
    </div>
  );
}

export default function Welcome() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <span className="font-display font-bold text-[16px] tracking-tight">DualPay</span>
          </div>
          <Link to="/login" className="h-9 px-4 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90">
            Sign in <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-16 grid lg:grid-cols-[1.05fr_0.95fr] gap-12 items-center">
        <div>
          <Eyebrow>Get Paid What You're Owed</Eyebrow>
          <h1 className="font-display text-[42px] sm:text-[52px] font-semibold tracking-tight leading-[1.05]">
            One tool for both sides of every claim.
          </h1>
          <p className="mt-5 text-[16px] text-muted-foreground max-w-lg leading-relaxed">
            Every claim gets checked against your contract, automatically. If a
            provider was underpaid, we recover it. If a payer overpaid, we catch
            that too — from the same system.
          </p>
          <div className="mt-8 flex items-center gap-3">
            <Link to="/login" className="h-11 px-6 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground text-[14px] font-medium hover:bg-primary/90">
              Sign in <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <p className="mt-4 text-[12px] text-muted-foreground/70">Access is invite-only. Contact your administrator to be added.</p>
        </div>
        <div className="relative">
          <div className="rounded-2xl overflow-hidden border shadow-xl aspect-[4/5] lg:aspect-[3/4]">
            <img src={heroClinician} alt="Clinician reviewing claims on a laptop" className="w-full h-full object-cover" />
          </div>
          <div className="absolute -bottom-5 -left-5 rounded-lg bg-card border shadow-lg px-4 py-3 hidden sm:block">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Verified</div>
            <div className="font-display text-[15px] font-semibold text-primary">Same answer, every time</div>
          </div>
        </div>
      </section>

      {/* Capability facts strip -- real, verifiable properties, not results */}
      <section className="border-y bg-card">
        <div className="max-w-6xl mx-auto px-6 py-6 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {[
            { label: 'Same claim, same answer', detail: 'No exceptions' },
            { label: 'Right insurance pays first', detail: 'Every time, automatically' },
            { label: 'Reads your files automatically', detail: 'No new software to learn' },
            { label: 'Catches every mistake', detail: 'Underpaid or overpaid' },
          ].map(s => (
            <div key={s.label}>
              <div className="font-display text-[15px] font-semibold">{s.label}</div>
              <div className="text-[11.5px] text-muted-foreground mt-0.5">{s.detail}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Our Platform */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <Eyebrow>Our Platform</Eyebrow>
        <h2 className="font-display text-[30px] font-semibold tracking-tight max-w-lg">
          Built for both sides of the claim
        </h2>
        <div className="mt-10 grid sm:grid-cols-2 gap-5">
          <div className="rounded-xl border bg-card p-6">
            <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center mb-4">
              <FileCheck className="h-5 w-5 text-primary" />
            </div>
            <div className="font-display text-[17px] font-semibold">Recover What You're Owed</div>
            <p className="mt-1.5 text-[13.5px] text-muted-foreground leading-relaxed">
              Every payment gets compared to your contract. If you were paid less than
              you should have been, we catch it, build the report, and prove it —
              automatically.
            </p>
          </div>
          <div className="rounded-xl border bg-card p-6">
            <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center mb-4">
              <Search className="h-5 w-5 text-primary" />
            </div>
            <div className="font-display text-[17px] font-semibold">Stop Overpaying Providers</div>
            <p className="mt-1.5 text-[13.5px] text-muted-foreground leading-relaxed">
              The same check runs in reverse. If you paid a provider more than the
              contract allows, we flag it — along with any insurance mix-ups in the
              same file.
            </p>
          </div>
        </div>
      </section>

      {/* Feature detail: COB */}
      <section className="max-w-6xl mx-auto px-6 py-16 grid md:grid-cols-2 gap-12 items-center">
        <div>
          <Eyebrow>Two Insurance Plans</Eyebrow>
          <h3 className="font-display text-[26px] font-semibold tracking-tight leading-tight">
            The right plan pays first, every time
          </h3>
          <p className="mt-4 text-[14px] text-muted-foreground leading-relaxed">
            When a patient has two insurance plans, billing the wrong one first is an
            easy mistake to make. We work out the correct order automatically, using
            the real rules — never a guess. If we need the other plan's EOB first,
            the claim is routed there on its own.
          </p>
        </div>
        <MockPanel>
          <MockCard>
            <div className="bg-[hsl(150_45%_12%)] px-4 py-2.5 flex items-center justify-between">
              <span className="text-white text-[12.5px] font-medium">Member Coverage — COB Check</span>
              <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-gold/20 text-gold">RESOLVED</span>
            </div>
            <div className="p-4 space-y-2 text-[12px] font-mono">
              <div className="flex justify-between"><span className="text-muted-foreground">Primary</span><span>Employer Plan A</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Secondary</span><span>Spouse Plan B</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Rule applied</span><span>Birthday rule</span></div>
              <div className="flex justify-between pt-2 border-t"><span className="text-muted-foreground">Status</span><span className="text-primary font-semibold">Routed to primary</span></div>
            </div>
          </MockCard>
        </MockPanel>
      </section>

      {/* Feature detail: overpayment finding */}
      <section className="max-w-6xl mx-auto px-6 py-16 grid md:grid-cols-2 gap-12 items-center">
        <div className="md:order-2">
          <Eyebrow>Payment Integrity</Eyebrow>
          <h3 className="font-display text-[26px] font-semibold tracking-tight leading-tight">
            Catch payments that were too high
          </h3>
          <p className="mt-4 text-[14px] text-muted-foreground leading-relaxed">
            If a claim paid more than your contract allows, we catch it — and show
            exactly which rate was broken, by how much, and how serious it is.
          </p>
        </div>
        <MockPanel className="md:order-1">
          <MockCard>
            <div className="bg-[hsl(150_45%_12%)] px-4 py-2.5 flex items-center justify-between">
              <span className="text-white text-[12.5px] font-medium">Payer Findings</span>
              <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-gold/20 text-gold">OVERPAYMENT</span>
            </div>
            <div className="p-4 space-y-2 text-[12px] font-mono">
              <div className="flex justify-between"><span className="text-muted-foreground">CPT</span><span>99214</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Contracted</span><span>$148.00</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span>$210.00</span></div>
              <div className="flex justify-between pt-2 border-t"><span className="text-muted-foreground">Variance</span><span className="text-status-denied font-semibold">$62.00 · critical</span></div>
            </div>
          </MockCard>
        </MockPanel>
      </section>

      {/* Feature detail: replay */}
      <section className="max-w-6xl mx-auto px-6 py-16 grid md:grid-cols-2 gap-12 items-center">
        <div>
          <Eyebrow>Proof, Not Guesswork</Eyebrow>
          <h3 className="font-display text-[26px] font-semibold tracking-tight leading-tight">
            Show your work, any time
          </h3>
          <p className="mt-4 text-[14px] text-muted-foreground leading-relaxed">
            Run the same claim twice, get the same answer twice. Every decision is
            saved, so you can always go back and show exactly how we got that number —
            no digging through old faxes or spreadsheets.
          </p>
        </div>
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
      </section>

      {/* Full-width photo band */}
      <section className="relative mx-6 mb-16 rounded-2xl overflow-hidden">
        <img
          src={documentReview}
          alt="Team reviewing claim documentation together"
          className="w-full h-[280px] sm:h-[360px] lg:h-[440px] object-cover"
          style={{ objectPosition: '50% 13%' }}
        />
        <div className="absolute bottom-5 left-5 right-5 sm:bottom-8 sm:left-8 sm:right-auto sm:max-w-sm rounded-xl p-5 sm:p-6 shadow-xl"
          style={{ background: 'hsl(150 45% 9% / 0.94)' }}>
          <h3 className="font-display text-white text-[22px] sm:text-[26px] font-semibold tracking-tight leading-tight">
            One record, both teams
          </h3>
          <p className="mt-3 text-[13px] text-white/80 leading-relaxed">
            Both teams look at the same claim, the same contract, and the same
            history. No comparing two different systems after the fact.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-6 mb-16 rounded-2xl overflow-hidden">
        <div className="px-8 py-16 sm:px-16 text-center"
          style={{ background: 'linear-gradient(135deg, hsl(150 45% 10%) 0%, hsl(152 42% 21%) 55%, hsl(42 55% 30%) 130%)' }}>
          <h2 className="font-display text-white text-[30px] sm:text-[36px] font-semibold tracking-tight max-w-xl mx-auto">
            Claims are complicated. Getting paid correctly shouldn't be.
          </h2>
          <Link to="/login" className="mt-7 h-11 px-6 inline-flex items-center gap-2 rounded-md bg-white text-[hsl(150_45%_12%)] text-[14px] font-medium hover:bg-white/90">
            Sign in <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t">
        <div className="max-w-6xl mx-auto px-6 py-8 flex items-center justify-between text-[12px] text-muted-foreground">
          <span>DualPay</span>
          <Link to="/login" className="hover:text-foreground">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
