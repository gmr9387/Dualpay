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
          <Eyebrow>Healthcare Revenue &amp; Payment Intelligence</Eyebrow>
          <h1 className="font-display text-[42px] sm:text-[52px] font-semibold tracking-tight leading-[1.05]">
            One platform. Both sides of the claim.
          </h1>
          <p className="mt-5 text-[16px] text-muted-foreground max-w-lg leading-relaxed">
            Deterministic claims adjudication, coordination of benefits, and contract-driven
            variance detection — built to recover what a provider is owed, and to catch what
            a payer overpaid, from the same engine.
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
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Replay check</div>
            <div className="font-display text-[15px] font-semibold text-primary">Match — every run</div>
          </div>
        </div>
      </section>

      {/* Capability facts strip -- real, verifiable properties, not results */}
      <section className="border-y bg-card">
        <div className="max-w-6xl mx-auto px-6 py-6 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {[
            { label: 'Deterministic adjudication', detail: 'Every decision is replayable' },
            { label: 'Real COB primacy engine', detail: 'Birthday rule + payer order' },
            { label: 'X12 835 / 837 native', detail: 'Remittance and claim EDI' },
            { label: 'Provider + payer, one engine', detail: 'Under- and overpayment' },
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
            <div className="font-display text-[17px] font-semibold">Provider Recovery</div>
            <p className="mt-1.5 text-[13.5px] text-muted-foreground leading-relaxed">
              Match every remittance line against your real contracts and fee schedules.
              Underpayments become disputes automatically, with a client-facing recovery
              report and a full audit trail from claim to check.
            </p>
          </div>
          <div className="rounded-xl border bg-card p-6">
            <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center mb-4">
              <Search className="h-5 w-5 text-primary" />
            </div>
            <div className="font-display text-[17px] font-semibold">Payer Payment Integrity</div>
            <p className="mt-1.5 text-[13.5px] text-muted-foreground leading-relaxed">
              The same fee-schedule match, read the other direction: claims paid above
              the contracted rate surface as findings, alongside COB conflicts flagged
              from the same 835 import.
            </p>
          </div>
        </div>
      </section>

      {/* Feature detail: COB */}
      <section className="max-w-6xl mx-auto px-6 py-16 grid md:grid-cols-2 gap-12 items-center">
        <div>
          <Eyebrow>Coordination of Benefits</Eyebrow>
          <h3 className="font-display text-[26px] font-semibold tracking-tight leading-tight">
            Primacy determined correctly, every time
          </h3>
          <p className="mt-4 text-[14px] text-muted-foreground leading-relaxed">
            The birthday rule, plan-type precedence, and payer sequencing run as real logic
            against a member's actual coverage — not a lookup table someone forgot to update.
            When a claim needs primary EOB before it can move, it's routed there automatically.
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
            Find what was paid above contract
          </h3>
          <p className="mt-4 text-[14px] text-muted-foreground leading-relaxed">
            The same engine that catches provider underpayments runs in reverse: when a
            paid amount exceeds the contracted rate, it's flagged, severity-scored, and
            traceable back to the exact fee-schedule row that should have governed it.
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
          <Eyebrow>Auditability</Eyebrow>
          <h3 className="font-display text-[26px] font-semibold tracking-tight leading-tight">
            Every decision replays to the same result
          </h3>
          <p className="mt-4 text-[14px] text-muted-foreground leading-relaxed">
            Adjudication is deterministic: the same claim, contract, and plan inputs always
            produce the same output, and every run is logged with a fingerprint you can
            replay later to prove exactly how a payment decision was reached.
          </p>
        </div>
        <MockPanel>
          <MockCard>
            <div className="bg-[hsl(150_45%_12%)] px-4 py-2.5 flex items-center gap-2">
              <RotateCcw className="h-3.5 w-3.5 text-gold" />
              <span className="text-white text-[12.5px] font-medium">Replay Ledger</span>
            </div>
            <div className="p-4 space-y-2 text-[12px] font-mono">
              <div className="flex justify-between"><span className="text-muted-foreground">Fingerprint</span><span className="truncate max-w-[140px]">a3f9…c221</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Rule firings</span><span>7</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Math steps</span><span>12</span></div>
              <div className="flex justify-between pt-2 border-t"><span className="text-muted-foreground">Replay check</span><span className="text-primary font-semibold">Match</span></div>
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
            One record, both sides of the review
          </h3>
          <p className="mt-3 text-[13px] text-white/80 leading-relaxed">
            Provider recovery and payer payment integrity teams work from the same
            claim, the same contract, and the same audit trail — no reconciling
            two systems after the fact.
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
