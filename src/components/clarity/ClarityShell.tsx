import { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, AlertOctagon, ListChecks, FileSearch, Gavel,
  TrendingDown, Building2, Upload, ScrollText, Shield, Search,
  HelpCircle, Bell, Database, Activity, Target, FolderOpen, BarChart3,
  BookOpen, GitBranch, TrendingUp, Users, FileCheck, BookText, ShieldCheck,
  Award, ClipboardList, Siren, Scale, Phone, Gauge, Factory, FileInput, History, AlertOctagon as AlertIcon,
  Bot, Settings2, Cpu, AlertTriangle,
} from 'lucide-react';
import { UserOrgMenu, NoOrgEmptyState } from '@/components/auth/UserOrgMenu';
import { useOrg, type OrgRole } from '@/hooks/use-org';
import { roleAtLeast } from '@/lib/role-permissions';

interface NavItem { to: string; label: string; icon: typeof LayoutDashboard; badge?: string }
interface NavSection { title: string; items: NavItem[]; minRole?: OrgRole }

const SECTIONS: NavSection[] = [
  {
    title: 'Command',
    items: [
      { to: '/',         label: 'Command Center',     icon: LayoutDashboard },
      { to: '/command',  label: 'Executive Command',  icon: BarChart3, badge: 'EXEC' },
      { to: '/today',    label: "Today's Recovery",   icon: Target },
    ],
  },
  {
    title: 'Executive Intelligence',
    minRole: 'manager',
    items: [
      { to: '/executive',            label: 'Executive Home',       icon: BarChart3, badge: 'NEW' },
      { to: '/executive/value',      label: 'Value Realization',    icon: TrendingUp, badge: 'NEW' },
      { to: '/executive/recovery',   label: 'Recovery Attribution', icon: Target, badge: 'NEW' },
      { to: '/executive/payers',     label: 'Payer Scorecards',     icon: Building2, badge: 'NEW' },
      { to: '/executive/playbooks',  label: 'Playbook Effectiveness', icon: Award, badge: 'NEW' },
    ],
  },
  {
    title: 'Recovery Operations',
    items: [
      { to: '/ops',           label: 'Operations Dashboard', icon: Gauge },
      { to: '/pipeline-exec', label: 'Executive Pipeline',   icon: BarChart3 },
      { to: '/sla',           label: 'SLA Management',       icon: ShieldCheck },
      { to: '/escalations',   label: 'Escalations',          icon: Siren },
      { to: '/workload',      label: 'Workload Management',  icon: Scale },
      { to: '/payer-ops',     label: 'Payer Operations',     icon: Phone },
    ],
  },
  {
    title: 'Recovery Factory',
    minRole: 'analyst',
    items: [
      { to: '/factory',             label: 'Factory Dashboard', icon: Factory,   badge: 'NEW' },
      { to: '/factory/import',      label: 'Import Center',     icon: FileInput, badge: 'NEW' },
      { to: '/factory/remittance',  label: 'Remittance Intake', icon: Database,  badge: '835' },
      { to: '/factory/exceptions',  label: 'Exception Queue',   icon: AlertIcon, badge: 'NEW' },
      { to: '/factory/history',     label: 'Import History',    icon: History,   badge: 'NEW' },
    ],
  },
  {
    title: 'Contract Intelligence',
    minRole: 'manager',
    items: [
      { to: '/contracts',           label: 'Contracts',          icon: BookText,    badge: 'NEW' },
      { to: '/plan-benefits',       label: 'Plan Benefits',      icon: ShieldCheck, badge: 'NEW' },
      { to: '/contracts/disputes',  label: 'Contract Recovery',  icon: AlertOctagon, badge: 'NEW' },
      { to: '/contracts/analytics', label: 'Contract Analytics', icon: BarChart3,   badge: 'NEW' },
      { to: '/payer-findings',      label: 'Payer Findings',     icon: Search,      badge: 'NEW' },
    ],
  },
  {
    title: 'Automation',
    minRole: 'admin',
    items: [
      { to: '/automation',         label: 'Automation Center', icon: Bot,        badge: 'NEW' },
      { to: '/automation/jobs',    label: 'Jobs',              icon: ListChecks, badge: 'NEW' },
      { to: '/automation/rules',   label: 'Rules',             icon: Settings2,  badge: 'NEW' },
      { to: '/automation/history', label: 'History',           icon: History,    badge: 'NEW' },
    ],
  },
  {
    title: 'Platform',
    minRole: 'admin',
    items: [
      { to: '/platform',          label: 'Platform Operations', icon: Cpu,            badge: 'NEW' },
      { to: '/platform/jobs',     label: 'Job Queue',           icon: ListChecks,     badge: 'NEW' },
      { to: '/platform/workers',  label: 'Workers',             icon: Cpu,            badge: 'NEW' },
      { to: '/platform/failures', label: 'Failure Center',      icon: AlertTriangle,  badge: 'NEW' },
    ],
  },
  {
    title: 'Lineage',
    minRole: 'manager',
    items: [
      { to: '/lineage', label: 'Recovery Lineage', icon: GitBranch, badge: 'NEW' },
    ],
  },
  {
    title: 'EDI Gateway',
    minRole: 'admin',
    items: [
      { to: '/edi',              label: 'EDI Overview',     icon: Database,  badge: 'X12' },
      { to: '/edi/import',       label: 'EDI Import',       icon: Upload,    badge: 'X12' },
      { to: '/edi/transactions', label: 'EDI Transactions', icon: FileSearch, badge: 'X12' },
      { to: '/edi/errors',       label: 'EDI Errors',       icon: AlertTriangle, badge: 'X12' },
    ],
  },
  {
    title: 'Execute',
    items: [
      { to: '/worklist',   label: 'My Worklist',         icon: Target, badge: 'NEW' },
      { to: '/pipeline',   label: 'Recovery Pipeline',  icon: GitBranch },
      { to: '/queues',     label: 'Work Queues',         icon: ListChecks },
      { to: '/appeals',    label: 'Appeals Workbench',   icon: Gavel },
      { to: '/packet',     label: 'Appeal Packet',       icon: FileCheck },
      { to: '/playbooks',  label: 'Recovery Playbooks',  icon: BookOpen },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { to: '/denials',         label: 'Denial Command',     icon: AlertOctagon, badge: 'PRIME' },
      { to: '/recovery-intel',  label: 'Recovery Intelligence', icon: Award, badge: 'NEW' },
      { to: '/outcomes',        label: 'Outcome Log',         icon: ClipboardList, badge: 'NEW' },
      { to: '/transparency',    label: 'Decision Transparency', icon: ShieldCheck, badge: 'TRUST' },
      { to: '/leak',            label: 'Revenue Leak',        icon: TrendingDown },
      { to: '/forecast',        label: 'Recovery Forecast',   icon: TrendingUp },
      { to: '/vault',           label: 'Evidence Vault',      icon: FolderOpen, badge: 'NEW' },
    ],
  },
  {
    title: 'Payers & Team',
    items: [
      { to: '/payers',              label: 'Payer Intelligence',  icon: Building2 },
      { to: '/payer-requirements',  label: 'Payer Requirements',  icon: BookText, badge: 'NEW' },
      { to: '/team',                label: 'Team Operations',     icon: Users, badge: 'NEW' },
    ],
  },
  {
    title: 'Admin',
    minRole: 'admin',
    items: [
      { to: '/claims',          label: 'Claims Workbench',    icon: FileSearch },
      { to: '/reports',         label: 'Executive Reporting', icon: BarChart3 },
      { to: '/ingest',          label: 'Ingestion',           icon: Upload },
      { to: '/audit',           label: 'Audit & Trace',       icon: ScrollText },
      { to: '/admin',           label: 'Admin Console',       icon: Shield, badge: 'NEW' },
      { to: '/admin/security',  label: 'Security Inventory',  icon: ShieldCheck, badge: 'NEW' },
      { to: '/admin/audit',     label: 'Audit Export',        icon: ScrollText, badge: 'NEW' },
    ],
  },
];

interface ClarityShellProps {
  children: ReactNode;
  cloudOnline?: boolean;
}

export function ClarityShell({ children, cloudOnline = true }: ClarityShellProps) {
  const { pathname } = useLocation();
  const crumbs = breadcrumbsFor(pathname);
  const { currentOrg } = useOrg();
  const role = currentOrg?.role;
  const visibleSections = SECTIONS.filter(s => !s.minRole || roleAtLeast(role, s.minRole));

  return (
    <div className="flex h-screen w-full overflow-hidden bg-surface-0 text-foreground">
      <aside className="w-60 shrink-0 flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="h-14 flex items-center gap-2.5 px-4 border-b border-sidebar-border">
          <div className="h-8 w-8 rounded-md bg-sidebar-primary/15 border border-sidebar-primary/30 flex items-center justify-center">
            <Shield className="h-4 w-4 text-sidebar-primary" />
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-bold tracking-tight">Claim Clarity</div>
            <div className="text-[10px] font-mono text-sidebar-foreground/55">Healthcare Adjudication Intelligence</div>
            <div className="text-[9px] font-mono text-sidebar-primary/70 mt-0.5">Powered by ValtariOS</div>
          </div>
        </div>

        <nav className="flex-1 px-2 py-2 space-y-3 overflow-y-auto">
          {visibleSections.map(section => (
            <div key={section.title}>
              <div className="px-2 pb-1 text-[9.5px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                {section.title}
              </div>
              <div className="space-y-0.5">
                {section.items.map(item => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      className={({ isActive }) =>
                        `w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12.5px] transition-colors border-l-2 ${
                          isActive
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium border-gold'
                            : 'border-transparent text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                        }`
                      }
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      {item.badge && (
                        <span className="text-[8.5px] font-mono font-semibold tracking-wider px-1 py-0.5 rounded bg-gold/15 text-gold border border-gold/30">
                          {item.badge}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-3 py-2.5 border-t border-sidebar-border space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10.5px] font-mono">
            <Database className={`h-3 w-3 ${cloudOnline ? 'text-status-paid' : 'text-status-denied'}`} />
            <span className="text-sidebar-foreground/70">Persistence</span>
            <span className={cloudOnline ? 'text-status-paid' : 'text-status-denied'}>
              {cloudOnline ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10.5px] font-mono">
            <Activity className="h-3 w-3 text-status-paid" />
            <span className="text-sidebar-foreground/70">Intel Engine</span>
            <span className="text-status-paid">ONLINE</span>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 flex items-center gap-4 px-5 border-b bg-card">
          <nav className="flex items-center gap-1.5 text-[13px] min-w-0">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-muted-foreground/50">/</span>}
                <span className={i === crumbs.length - 1 ? 'text-foreground font-semibold' : 'text-muted-foreground'}>
                  {c}
                </span>
              </span>
            ))}
          </nav>

          <div className="flex-1 max-w-md ml-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                placeholder="Search claims, denials, payers, members…"
                className="w-full h-8 pl-8 pr-3 text-[12.5px] rounded-md bg-muted/60 border border-transparent focus:bg-card focus:border-input focus:outline-none focus:ring-2 focus:ring-ring/40 placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] font-mono font-semibold tracking-wider px-2 py-0.5 rounded border border-status-pending/40 bg-status-pending/10 text-status-pending">
              PROD
            </span>
            <button className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground">
              <HelpCircle className="h-4 w-4" />
            </button>
            <button className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground relative">
              <Bell className="h-4 w-4" />
              <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-status-denied" />
            </button>
            <UserOrgMenu />
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-hidden"><ShellBody>{children}</ShellBody></main>
      </div>
    </div>
  );
}

function ShellBody({ children }: { children: ReactNode }) {
  const { orgs, loading } = useOrg();
  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading organization…</div>;
  if (orgs.length === 0) return <NoOrgEmptyState />;
  return <>{children}</>;
}

function breadcrumbsFor(pathname: string): string[] {
  const map: Record<string, string[]> = {
    '/':                    ['Operations', 'Command Center'],
    '/command':             ['Operations', 'Executive Command'],
    '/today':               ['Execute',    "Today's Recovery"],
    '/ops':                 ['Recovery Operations', 'Operations Dashboard'],
    '/pipeline-exec':       ['Recovery Operations', 'Executive Pipeline'],
    '/sla':                 ['Recovery Operations', 'SLA Management'],
    '/escalations':         ['Recovery Operations', 'Escalations'],
    '/workload':            ['Recovery Operations', 'Workload Management'],
    '/payer-ops':           ['Recovery Operations', 'Payer Operations'],
    '/payer-findings':      ['Contract Intelligence', 'Payer Findings'],
    '/pipeline':            ['Execute',    'Recovery Pipeline'],
    '/forecast':            ['Intelligence','Recovery Forecast'],
    '/team':                ['Payers & Team','Team Operations'],
    '/playbooks':           ['Execute',    'Recovery Playbooks'],
    '/denials':             ['Intelligence','Denial Command'],
    '/queues':              ['Execute',    'Work Queues'],
    '/worklist':            ['Execute',    'My Worklist'],
    '/claims':              ['Admin',      'Claims Workbench'],
    '/appeals':             ['Execute',    'Appeals Workbench'],
    '/packet':              ['Execute',    'Appeal Packet'],
    '/evidence':            ['Intelligence','Evidence Vault'],
    '/vault':               ['Intelligence','Evidence Vault'],
    '/leak':                ['Intelligence','Revenue Leak'],
    '/payers':              ['Payers & Team','Payer Intelligence'],
    '/payer-requirements':  ['Payers & Team','Payer Requirements'],
    '/reports':             ['Admin',      'Executive Reporting'],
    '/transparency':        ['Intelligence','Decision Transparency'],
    '/recovery-intel':      ['Intelligence','Recovery Intelligence'],
    '/outcomes':            ['Intelligence','Outcome Log'],
    '/factory':              ['Recovery Factory', 'Factory Dashboard'],
    '/factory/import':       ['Recovery Factory', 'Import Center'],
    '/factory/exceptions':   ['Recovery Factory', 'Exception Queue'],
    '/factory/history':      ['Recovery Factory', 'Import History'],
    '/ingest':              ['Admin',      'Ingestion'],
    '/audit':               ['Admin',      'Audit & Trace'],
    '/executive':            ['Executive Intelligence', 'Executive Home'],
    '/executive/value':      ['Executive Intelligence', 'Value Realization'],
    '/executive/recovery':   ['Executive Intelligence', 'Recovery Attribution'],
    '/executive/payers':     ['Executive Intelligence', 'Payer Scorecards'],
    '/executive/playbooks':  ['Executive Intelligence', 'Playbook Effectiveness'],
  };
  if (map[pathname]) return map[pathname];
  if (pathname.startsWith('/denials/')) return ['Intelligence', 'Denial Command', pathname.split('/')[2]];
  if (pathname.startsWith('/claims/'))  return ['Admin', 'Claims Workbench', pathname.split('/')[2]];
  if (pathname.startsWith('/queues/'))       return ['Execute', 'Work Queues', decodeURIComponent(pathname.split('/')[2])];
  if (pathname.startsWith('/packet/'))       return ['Execute', 'Appeal Packet', pathname.split('/')[2]];
  if (pathname.startsWith('/transparency/')) return ['Intelligence', 'Decision Transparency', pathname.split('/')[2]];
  if (pathname.startsWith('/factory/exceptions/')) return ['Recovery Factory', 'Exception Queue', pathname.split('/')[3]];
  if (pathname.startsWith('/vault/claim/'))   return ['Intelligence', 'Evidence Vault', 'Claim ' + pathname.split('/')[3]];
  if (pathname.startsWith('/vault/denial/'))  return ['Intelligence', 'Evidence Vault', 'Denial ' + pathname.split('/')[3]];
  if (pathname.startsWith('/vault/'))         return ['Intelligence', 'Evidence Vault', 'Document'];
  return ['Operations'];
}
