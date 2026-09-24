import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ClarityShell } from "@/components/clarity/ClarityShell";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { OrgProvider } from "@/hooks/use-org";
import { RequireAuth } from "@/components/auth/RequireAuth";
import Login from "./pages/Login";
import Welcome from "./pages/Welcome";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import CommandCenter from "./pages/CommandCenter";
import ExecutiveCommand from "./pages/ExecutiveCommand";
import TodaysOpportunities from "./pages/TodaysOpportunities";
import DenialIntelligence from "./pages/DenialIntelligence";
import DenialDetail from "./pages/DenialDetail";
import WorkQueues from "./pages/WorkQueues";
import AppealsWorkbench from "./pages/AppealsWorkbench";
import AppealPacket from "./pages/AppealPacket";
import EvidenceVault from "./pages/EvidenceVault";
import EvidenceDocumentPage from "./pages/EvidenceDocumentPage";
import EvidenceClaimPage from "./pages/EvidenceClaimPage";
import EvidenceDenialPage from "./pages/EvidenceDenialPage";
import RevenueLeak from "./pages/RevenueLeak";
import PayerIntel from "./pages/PayerIntel";
import PayerRequirements from "./pages/PayerRequirements";
import Playbooks from "./pages/Playbooks";
import RecoveryPipeline from "./pages/RecoveryPipeline";
import RecoveryForecast from "./pages/RecoveryForecast";
import TeamOperations from "./pages/TeamOperations";
import ExecutiveReporting from "./pages/ExecutiveReporting";
import Ingestion from "./pages/Ingestion";
import AuditTrace from "./pages/AuditTrace";
import ClaimsWorkbench from "./pages/ClaimsWorkbench";
import TransparencyCenter from "./pages/TransparencyCenter";
import TransparencyDetail from "./pages/TransparencyDetail";
import RecoveryIntelligence from "./pages/RecoveryIntelligence";
import OutcomeLog from "./pages/OutcomeLog";
import ExecutivePipeline from "./pages/ExecutivePipeline";
import SLAManagement from "./pages/SLAManagement";
import Escalations from "./pages/Escalations";
import WorkloadManagement from "./pages/WorkloadManagement";
import RecoveryOpsDashboard from "./pages/RecoveryOpsDashboard";
import PayerOperations from "./pages/PayerOperations";
import RecoveryFactory from "./pages/RecoveryFactory";
import ImportCenter from "./pages/ImportCenter";
import ImportHistory from "./pages/ImportHistory";
import ExceptionQueue from "./pages/ExceptionQueue";
import ExceptionDetail from "./pages/ExceptionDetail";
import RemittanceIntake from "./pages/RemittanceIntake";
import ExecutiveHome from "./pages/ExecutiveHome";
import ExecutiveRecovery from "./pages/ExecutiveRecovery";
import ExecutivePayers from "./pages/ExecutivePayers";
import ExecutivePlaybooks from "./pages/ExecutivePlaybooks";
import ExecutiveValue from "./pages/ExecutiveValue";
import AdminConsole from "./pages/AdminConsole";
import AdminSecurity from "./pages/AdminSecurity";
import AdminAudit from "./pages/AdminAudit";
import ContractsHome from "./pages/ContractsHome";
import ContractDetail from "./pages/ContractDetail";
import ContractUpload from "./pages/ContractUpload";
import ContractDisputes from "./pages/ContractDisputes";
import ContractAnalytics from "./pages/ContractAnalytics";
import PayerFindings from "./pages/PayerFindings";
import PlanBenefitsHome from "./pages/PlanBenefitsHome";
import PlanBenefitsUpload from "./pages/PlanBenefitsUpload";
import AutomationHome from "./pages/AutomationHome";
import AutomationJobs from "./pages/AutomationJobs";
import AutomationRules from "./pages/AutomationRules";
import AutomationHistory from "./pages/AutomationHistory";
import PlatformHome from "./pages/PlatformHome";
import PlatformJobs from "./pages/PlatformJobs";
import PlatformWorkers from "./pages/PlatformWorkers";
import PlatformFailures from "./pages/PlatformFailures";
import LineageHome from "./pages/LineageHome";
import LineageClaim from "./pages/LineageClaim";
import EdiHome from "./pages/EdiHome";
import EdiImport from "./pages/EdiImport";
import EdiTransactions from "./pages/EdiTransactions";
import EdiErrors from "./pages/EdiErrors";
import NotFound from "./pages/NotFound";
import MyWorklist from "./pages/MyWorklist";
import GuidedRecovery from "./pages/GuidedRecovery";

const queryClient = new QueryClient();

const ProtectedShell = () => (
  <RequireAuth>
    <OrgProvider>
      <ClarityShell>
        <Routes>
          <Route path="/" element={<CommandCenter />} />
          <Route path="/command" element={<ExecutiveCommand />} />
          <Route path="/today" element={<TodaysOpportunities />} />
          <Route path="/pipeline" element={<RecoveryPipeline />} />
          <Route path="/forecast" element={<RecoveryForecast />} />
          <Route path="/team" element={<TeamOperations />} />
          <Route path="/playbooks" element={<Playbooks />} />
          <Route path="/denials" element={<DenialIntelligence />} />
          <Route path="/denials/:claimId" element={<DenialDetail />} />
          <Route path="/queues" element={<WorkQueues />} />
          <Route path="/queues/:queueId" element={<WorkQueues />} />
          <Route path="/claims" element={<ClaimsWorkbench />} />
          <Route path="/claims/:claimId" element={<ClaimsWorkbench />} />
          <Route path="/appeals" element={<AppealsWorkbench />} />
          <Route path="/packet" element={<AppealPacket />} />
          <Route path="/packet/:claimId" element={<AppealPacket />} />
          <Route path="/evidence" element={<EvidenceVault />} />
          <Route path="/vault" element={<EvidenceVault />} />
          <Route path="/vault/claim/:claimId" element={<EvidenceClaimPage />} />
          <Route path="/vault/denial/:denialId" element={<EvidenceDenialPage />} />
          <Route path="/vault/:documentId" element={<EvidenceDocumentPage />} />
          <Route path="/leak" element={<RevenueLeak />} />
          <Route path="/payers" element={<PayerIntel />} />
          <Route path="/payer-requirements" element={<PayerRequirements />} />
          <Route path="/reports" element={<ExecutiveReporting />} />
          <Route path="/transparency" element={<TransparencyCenter />} />
          <Route path="/transparency/:claimId" element={<TransparencyDetail />} />
          <Route path="/recovery-intel" element={<RecoveryIntelligence />} />
          <Route path="/outcomes" element={<OutcomeLog />} />
          <Route path="/ops" element={<RecoveryOpsDashboard />} />
          <Route path="/pipeline-exec" element={<ExecutivePipeline />} />
          <Route path="/sla" element={<SLAManagement />} />
          <Route path="/escalations" element={<Escalations />} />
          <Route path="/workload" element={<WorkloadManagement />} />
          <Route path="/payer-ops" element={<PayerOperations />} />
          <Route path="/factory" element={<RecoveryFactory />} />
          <Route path="/factory/import" element={<ImportCenter />} />
          <Route path="/factory/history" element={<ImportHistory />} />
          <Route path="/factory/exceptions" element={<ExceptionQueue />} />
          <Route path="/factory/exceptions/:exceptionId" element={<ExceptionDetail />} />
          <Route path="/factory/remittance" element={<RemittanceIntake />} />
          <Route path="/ingest" element={<Ingestion />} />
          <Route path="/audit" element={<AuditTrace />} />
          <Route path="/executive" element={<ExecutiveHome />} />
          <Route path="/executive/recovery" element={<ExecutiveRecovery />} />
          <Route path="/executive/payers" element={<ExecutivePayers />} />
          <Route path="/executive/playbooks" element={<ExecutivePlaybooks />} />
          <Route path="/executive/value" element={<ExecutiveValue />} />
          <Route path="/admin" element={<AdminConsole />} />
          <Route path="/admin/security" element={<AdminSecurity />} />
          <Route path="/admin/audit" element={<AdminAudit />} />
          <Route path="/contracts" element={<ContractsHome />} />
          <Route path="/contracts/upload" element={<ContractUpload />} />
          <Route path="/contracts/disputes" element={<ContractDisputes />} />
          <Route path="/contracts/analytics" element={<ContractAnalytics />} />
          <Route path="/payer-findings" element={<PayerFindings />} />
          <Route path="/contracts/:contractId" element={<ContractDetail />} />
          <Route path="/plan-benefits" element={<PlanBenefitsHome />} />
          <Route path="/plan-benefits/upload" element={<PlanBenefitsUpload />} />
          <Route path="/plan-benefits/:planId/edit" element={<PlanBenefitsUpload />} />
          <Route path="/automation" element={<AutomationHome />} />
          <Route path="/automation/jobs" element={<AutomationJobs />} />
          <Route path="/automation/rules" element={<AutomationRules />} />
          <Route path="/automation/history" element={<AutomationHistory />} />
          <Route path="/platform" element={<PlatformHome />} />
          <Route path="/platform/jobs" element={<PlatformJobs />} />
          <Route path="/platform/workers" element={<PlatformWorkers />} />
          <Route path="/platform/failures" element={<PlatformFailures />} />
          <Route path="/lineage" element={<LineageHome />} />
          <Route path="/lineage/claim/:claimId" element={<LineageClaim />} />
          <Route path="/edi" element={<EdiHome />} />
          <Route path="/edi/import" element={<EdiImport />} />
          <Route path="/edi/transactions" element={<EdiTransactions />} />
          <Route path="/edi/errors" element={<EdiErrors />} />
          <Route path="/worklist" element={<MyWorklist />} />
          <Route path="/recover" element={<GuidedRecovery />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ClarityShell>
    </OrgProvider>
  </RequireAuth>
);

// The root path is the one place unauthenticated visitors actually land
// on ("showing up to the site"), so it can't just fall into RequireAuth's
// blanket redirect to /login the way every other route correctly does.
// Logged in -> the exact same authenticated shell as before (nothing
// changes for existing users). Logged out -> the marketing page, not a
// login form as the very first thing a visitor sees.
const RootGate = () => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  return user ? <ProtectedShell /> : <Welcome />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<RootGate />} />
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/*" element={<ProtectedShell />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
