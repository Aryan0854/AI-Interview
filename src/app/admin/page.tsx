"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import { titleCase } from "@/lib/utils";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Loader2, 
  ArrowLeft, 
  ArrowRight,
  FileText, 
  ClipboardList, 
  Eye, 
  Download, 
  Sparkles, 
  Upload, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  RefreshCcw, 
  AlertCircle, 
  HelpCircle,
  Video,
  Mail,
  X,
  Users,
  Settings,
  Activity,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Edit2
} from "lucide-react";
import dynamic from "next/dynamic";
const AdminResumeDetails = dynamic(() => import("@/components/AdminResumeDetails").then(mod => mod.AdminResumeDetails), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-50 bg-indigo-900/60 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl flex items-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
        <span className="font-bold text-slate-800 dark:text-slate-200 animate-pulse">Loading analysis details...</span>
      </div>
    </div>
  )
});
import ThemeToggle from "@/components/ThemeToggle";

function adminFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = typeof window !== "undefined" ? window.sessionStorage.getItem("admin_token") : null;
  const headersObj: Record<string, string> = {};

  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((value, key) => {
        headersObj[key] = value;
      });
    } else if (Array.isArray(init.headers)) {
      init.headers.forEach(([key, value]) => {
        headersObj[key] = value;
      });
    } else {
      Object.assign(headersObj, init.headers);
    }
  }

  if (token) {
    headersObj["Authorization"] = `Bearer ${token}`;
  }

  // Remove Content-Type for FormData requests so browser can set boundary automatically
  if (init?.body && typeof init.body !== "string" && !(init.body instanceof URLSearchParams)) {
    delete headersObj["Content-Type"];
  }

  return window.fetch(input, {
    ...init,
    headers: headersObj,
  }).then((res) => {
    if (res.status === 401 && typeof window !== "undefined") {
      window.sessionStorage.removeItem("resume-admin-authenticated");
      window.sessionStorage.removeItem("admin-email");
      window.sessionStorage.removeItem("admin_token");
      window.location.reload();
    }
    return res;
  });
}

const fetch = adminFetch;

function extractSkillsFromText(text: string): string[] {
  if (!text) return [];
  const COMMON_TECH_SKILLS = [
    "javascript", "typescript", "python", "java", "c++", "c#", "c", "ruby", "golang", "php", "rust", "swift", "kotlin", "perl", "r", "scala",
    "react", "angular", "vue", "next.js", "nextjs", "nuxt", "node.js", "nodejs", "express", "django", "flask", "spring", "springboot", "asp.net", "laravel", "rails",
    "sql", "postgresql", "postgres", "oracle", "mysql", "sql server", "sqlite", "mongodb", "mongo", "redis", "cassandra", "dynamodb", "mariadb", "couchdb", "neo4j",
    "aws", "amazon web services", "azure", "gcp", "google cloud", "docker", "kubernetes", "k8s", "jenkins", "ansible", "terraform", "ci/cd", "cicd", "git", "github", "gitlab",
    "linux", "windows", "unix", "ubuntu", "centos", "redhat", "red hat", "debian", "macos", "shell", "bash", "powershell",
    "splunk", "datadog", "dynatrace", "appdynamics", "new relic", "prometheus", "grafana", "elk", "elasticsearch", "logstash", "kibana", "service now", "servicenow", "jira", "confluence",
    "manual testing", "manual", "automation", "selenium", "postman", "jmeter", "cucumber", "testing",
    "microservices", "api", "apis", "rest", "graphql", "soap", "kafka", "rabbitmq", "mq", "activemq", "architecture", "architect", "estimation", "rca", "incident management", "problem management", "change management"
  ];
  
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const skill of COMMON_TECH_SKILLS) {
    const escaped = skill.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(^|[^a-zA-Z0-9_#+])(${escaped})([^a-zA-Z0-9_#+]|$)`, 'i');
    if (regex.test(lower)) {
      if (skill === "postgres") found.add("PostgreSQL");
      else if (skill === "nodejs") found.add("Node.js");
      else if (skill === "nextjs") found.add("Next.js");
      else if (skill === "amazon web services") found.add("AWS");
      else if (skill === "google cloud") found.add("GCP");
      else if (skill === "servicenow") found.add("ServiceNow");
      else if (skill === "red hat") found.add("RedHat");
      else if (skill === "apis") found.add("API");
      else {
        const pretty = skill.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        found.add(pretty);
      }
    }
  }
  return Array.from(found);
}

function calculateCandidateMatch(row: any, jdText: string): { score: number; matchingSkills: string[] } {
  if (!row || !jdText) {
    return { score: 0, matchingSkills: [] };
  }
  
  const candSkills = [
    ...(row.parsed?.skills?.technical || []),
    ...(row.parsed?.skills?.tools || [])
  ];
  
  const jdSkillsList = extractSkillsFromText(jdText);
  if (candSkills.length === 0 || jdSkillsList.length === 0) {
    return { score: 0, matchingSkills: [] };
  }
  
  const candSkillsLower = candSkills.map((s: string) => s.toLowerCase());
  const jdSkillsLower = jdSkillsList.map((s: string) => s.toLowerCase());
  
  const matchingLower = candSkillsLower.filter((s: string) => jdSkillsLower.includes(s));
  const matchingSkills = candSkills.filter((s: string) => matchingLower.includes(s.toLowerCase()));
  
  const divisor = Math.min(8, jdSkillsLower.length);
  const score = Math.min(100, Math.round((matchingLower.length / divisor) * 100));
  
  return { score, matchingSkills };
}



interface UploadFileStatus {
  name: string;
  status: "pending" | "uploading" | "completed" | "failed";
  error?: string;
  score?: number;
  suitability?: "suitable" | "unsuitable";
}

interface ResetLog {
  id: string;
  candidateEmail: string;
  resetBy: string;
  source: string;
  createdAt: string;
}

function resolveJdId(jdId: string): string {
  if (jdId === "42494d90-ab41-4f39-87a1-c01be666e9f7") {
    return "5ca7d4fe-c80a-4b9a-a360-c787dbdc5f8b"; // Maps to 49238BR
  }
  if (jdId === "a5b156cf-c501-4410-a3f9-2a50b766347a") {
    return "5bf4e5d4-6578-4cb0-a8c5-16c8b29ecbba"; // Maps to 47652BR
  }
  return jdId;
}

export default function AdminResumeDashboard() {
  const [resumes, setResumes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // JD to BR Modal states
  const [showJdToBrModal, setShowJdToBrModal] = useState(false);
  const [jdToBrFiles, setJdToBrFiles] = useState<File[]>([]);
  const [excelTemplate, setExcelTemplate] = useState<File | null>(null);
  const [jdCustomIds, setJdCustomIds] = useState<{ [filename: string]: string }>({});
  
  // Wizard States for prompting per-JD Auto Req IDs
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardIndex, setWizardIndex] = useState(0);
  const [wizardTempIds, setWizardTempIds] = useState<{ [filename: string]: string }>({});

  // Processing States
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Export Outputs
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [outputFilename, setOutputFilename] = useState<string>('');
  const [selectedResume, setSelectedResume] = useState<any>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [authError, setAuthError] = useState("");

  // Job Description states
  const [jds, setJds] = useState<any[]>([]);
  const [selectedJdId, setSelectedJdId] = useState<string>("");
  const [editingJdId, setEditingJdId] = useState<string | null>(null);
  const [editingRmEmail, setEditingRmEmail] = useState<string>("");
  const [editingBrId, setEditingBrId] = useState<string | null>(null);
  const [editingBrValue, setEditingBrValue] = useState<string>("");
  const [editingSkillsId, setEditingSkillsId] = useState<string | null>(null);
  const [editingSkillsValue, setEditingSkillsValue] = useState<string>("");
  const [undoStack, setUndoStack] = useState<any[]>([]);
  const [jdText, setJdText] = useState("");
  const [isJdLoading, setIsJdLoading] = useState(false);
  const [isJdEditing, setIsJdEditing] = useState(false);
  const [jdSavedText, setJdSavedText] = useState("");
  const jdFileInputRef = useRef<HTMLInputElement>(null);
  const isInitialLoadRef = useRef(true);
  const [isJdDragging, setIsJdDragging] = useState(false);

  // Invite Configuration Modal states
  const [inviteTargetResume, setInviteTargetResume] = useState<any | null>(null);
  const [inviteType, setInviteType] = useState<"technical" | "non-technical">("technical");
  
  // Tech section counts
  const [countOverlapping, setCountOverlapping] = useState(8);
  const [countGap, setCountGap] = useState(3);
  const [countProjects, setCountProjects] = useState(4);
  const [countCoding, setCountCoding] = useState(2);

  // Non-tech section counts
  const [countBehavioral, setCountBehavioral] = useState(5);
  const [countLeadership, setCountLeadership] = useState(5);
  const [countSoftSkills, setCountSoftSkills] = useState(5);

  // Upload JD Modal states
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [modalJdText, setModalJdText] = useState("");
  const [modalRmEmail, setModalRmEmail] = useState("");
  const [modalFile, setModalFile] = useState<File | null>(null);
  const [modalTab, setModalTab] = useState<"file" | "paste">("file");
  const [modalIsUploading, setModalIsUploading] = useState(false);
  const [modalError, setModalError] = useState("");

  // Reset candidate by email states
  const [resetEmailInput, setResetEmailInput] = useState("");
  const [isResettingEmail, setIsResettingEmail] = useState(false);

  // Delete supervisor verification states
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deletePasswordInput, setDeletePasswordInput] = useState("");
  const [deleteModalError, setDeleteModalError] = useState<string | null>(null);

  // Reset candidate verification states
  const [resetTargetResume, setResetTargetResume] = useState<any | null>(null);
  const [resetEmailTarget, setResetEmailTarget] = useState<string | null>(null);

  // Bulk Upload states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const unifiedFileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadQueue, setUploadQueue] = useState<UploadFileStatus[]>([]);
  const [isBulkUploading, setIsBulkUploading] = useState(false);
  const [duplicateFiles, setDuplicateFiles] = useState<{ file: File; replace: boolean }[]>([]);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);

  const [resetLogs, setResetLogs] = useState<ResetLog[]>([]);
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  const [showClearLogsModal, setShowClearLogsModal] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<"employee" | "suitable" | "unsuitable" | "outbox" | "requirements" | "logs" | "employee-portal">("employee");
  const [allTestResults, setAllTestResults] = useState<any[]>([]);
  const [registeredAccounts, setRegisteredAccounts] = useState<any[]>([]);
  const [testResultsSearch, setTestResultsSearch] = useState("");
  const [expandedEmployees, setExpandedEmployees] = useState<Record<string, boolean>>({});
  const [expandedTestReviews, setExpandedTestReviews] = useState<Record<string, boolean>>({});
  const [testReviewCache, setTestReviewCache] = useState<Record<string, any[]>>({});
  const [loadingTestReview, setLoadingTestReview] = useState<Record<string, boolean>>({});
  const [emails, setEmails] = useState<any[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<any>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [isEmailsLoading, setIsEmailsLoading] = useState(false);
  const [selectedResumeIds, setSelectedResumeIds] = useState<string[]>([]);
  const [selectedEmailIds, setSelectedEmailIds] = useState<string[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);

  const [employees, setEmployees] = useState<any[]>([]);
  const [isEmployeesLoading, setIsEmployeesLoading] = useState(false);
  const [isDispatchingMails, setIsDispatchingMails] = useState(false);
  const [isBulkDispatchingMails, setIsBulkDispatchingMails] = useState(false);
  const [activeEmployee, setActiveEmployee] = useState<any>(null);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [requirementSearch, setRequirementSearch] = useState("");
  const [candidateSearch, setCandidateSearch] = useState("");
  const [outboxSearch, setOutboxSearch] = useState("");
  const [expandedJdId, setExpandedJdId] = useState<string | null>(null);

  const [portalSettings, setPortalSettings] = useState({
    showEffectivenessTab: true,
    showManagerConsoleTab: true,
    portalFeaturesEnabled: true
  });
  const [isUpdatingSettings, setIsUpdatingSettings] = useState(false);

  // Logs state
  const [systemLogs, setSystemLogs] = useState<any[]>([]);
  const [isSystemLogsLoading, setIsSystemLogsLoading] = useState(false);
  const [logsSearch, setLogsSearch] = useState("");
  const [logsModuleFilter, setLogsModuleFilter] = useState("all");
  const [logsStatusFilter, setLogsStatusFilter] = useState("all");

  // Ingestion status state
  const [pipelineStatus, setPipelineStatus] = useState("Ingestion: Idle");
  const [activityLogs, setActivityLogs] = useState<string[]>([]);
  const [uploadCategory, setUploadCategory] = useState("resume");

  // Clear selections when tab changes
  useEffect(() => {
    setSelectedResumeIds([]);
    setSelectedEmailIds([]);
    setSelectedEmployeeIds([]);
  }, [activeTab]);

  // General Action Loading states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedEmail = window.sessionStorage.getItem("admin-email");
      if (storedEmail) {
        setAdminEmail(storedEmail);
        setAuthenticated(true);
      }
    }
    setAuthInitialized(true);
  }, []);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/admin")) {
        window.sessionStorage.removeItem("resume-admin-authenticated");
        window.sessionStorage.removeItem("admin-email");
        window.sessionStorage.removeItem("admin_token");
      }
    };
  }, []);

  useEffect(() => {
    if (!authenticated || !adminEmail) {
      setLoading(false);
      return;
    }

    loadInitialData(adminEmail);
  }, [authenticated, adminEmail]);

  useEffect(() => {
    if (authenticated && adminEmail) {
      if (isInitialLoadRef.current) {
        return;
      }
      loadEmployees();
    }
  }, [authenticated, adminEmail, selectedJdId]);

  useEffect(() => {
    if (authenticated && adminEmail) {
      if (isInitialLoadRef.current) {
        return;
      }
      loadLogs();
    }
  }, [logsModuleFilter, logsStatusFilter, logsSearch]);

  const handleToggleResumeSelect = (id: string) => {
    setSelectedResumeIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleToggleAllResumes = () => {
    const currentList = activeTab === "suitable" ? suitableCandidates : unsuitableCandidates;
    const currentListIds = currentList.map(r => r.id);
    const allSelected = currentListIds.every(id => selectedResumeIds.includes(id));
    if (allSelected) {
      setSelectedResumeIds(prev => prev.filter(id => !currentListIds.includes(id)));
    } else {
      setSelectedResumeIds(prev => Array.from(new Set([...prev, ...currentListIds])));
    }
  };

  const handleToggleEmailSelect = (id: string) => {
    setSelectedEmailIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleToggleAllEmails = () => {
    const allEmailIds = emails.map(e => e.id);
    const allSelected = allEmailIds.every(id => selectedEmailIds.includes(id));
    if (allSelected) {
      setSelectedEmailIds([]);
    } else {
      setSelectedEmailIds(allEmailIds);
    }
  };

  const handleBulkDeleteResumes = () => {
    if (selectedResumeIds.length === 0) return;
    setDeleteTargetId("bulk");
    setDeletePasswordInput("");
    setDeleteModalError(null);
  };

  const handleBulkDeleteEmails = () => {
    if (selectedEmailIds.length === 0) return;
    setDeleteTargetId("bulk-emails");
    setDeletePasswordInput("");
    setDeleteModalError(null);
  };

  const toggleTestReview = async (testId: string) => {
    const willExpand = !expandedTestReviews[testId];
    setExpandedTestReviews(prev => ({ ...prev, [testId]: willExpand }));
    if (willExpand && !testReviewCache[testId]) {
      setLoadingTestReview(prev => ({ ...prev, [testId]: true }));
      try {
        const res = await adminFetch(`/api/admin/employees/test-review?testId=${testId}`);
        const data = await res.json();
        setTestReviewCache(prev => ({ ...prev, [testId]: data.questions || [] }));
      } catch (err) {
        console.error("Failed to load test review", err);
        setTestReviewCache(prev => ({ ...prev, [testId]: [] }));
      } finally {
        setLoadingTestReview(prev => ({ ...prev, [testId]: false }));
      }
    }
  };

  const handleToggleEmployeeSelect = (id: string) => {
    setSelectedEmployeeIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleToggleAllEmployees = () => {
    const filtered = employees.filter(emp => {
      if (!employeeSearch) return true;
      const term = employeeSearch.toLowerCase();
      return (
        emp.full_name?.toLowerCase().includes(term) ||
        emp.employee_id?.toLowerCase().includes(term) ||
        emp.skills?.toLowerCase().includes(term)
      );
    });
    const currentListIds = filtered.map(emp => emp.employee_id);
    const allSelected = currentListIds.every(id => selectedEmployeeIds.includes(id));
    if (allSelected) {
      setSelectedEmployeeIds(prev => prev.filter(id => !currentListIds.includes(id)));
    } else {
      setSelectedEmployeeIds(prev => Array.from(new Set([...prev, ...currentListIds])));
    }
  };

  const handleBulkDeleteEmployees = () => {
    if (selectedEmployeeIds.length === 0) return;
    setDeleteTargetId("bulk-employees-pool");
    setDeletePasswordInput("");
    setDeleteModalError(null);
  };

  const handleBulkDispatchEmployees = async () => {
    if (selectedEmployeeIds.length === 0) return;
    const token = typeof window !== "undefined" ? window.sessionStorage.getItem("admin_token") || "" : "";
    setIsBulkDispatchingMails(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const response = await fetch("/api/admin/employees/dispatch_mail", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token, adminEmail, employeeIds: selectedEmployeeIds }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to dispatch email invitations.");
      }
      setActionSuccess(`Successfully dispatched assessment invitations to ${data.count} selected employee(s).`);
      setSelectedEmployeeIds([]);
      await loadEmails();
    } catch (err: any) {
      console.error(err);
      setActionError(err.message || "Failed to dispatch emails.");
    } finally {
      setIsBulkDispatchingMails(false);
    }
  };

  const loadResumes = async (emailToUse?: string) => {
    const email = emailToUse || adminEmail;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/resumes?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      setResumes(data.resumes || []);
    } catch (err) {
      console.error("Failed to fetch resumes", err);
    } finally {
      setLoading(false);
    }
  };

  const loadJobDescriptions = async (emailToUse?: string) => {
    const email = emailToUse || adminEmail;
    setIsJdLoading(true);
    try {
      const res = await fetch(`/api/admin/jd?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (data.jds) {
        setJds(data.jds || []);
        if (data.jds.length > 0) {
          setSelectedJdId((prevId) => {
            const exists = data.jds.some((j: any) => j.id === prevId);
            if (exists && prevId && prevId !== "all") {
              const current = data.jds.find((j: any) => j.id === prevId);
              setJdSavedText(current.jdText);
              setJdText(current.jdText);
              return prevId;
            }

            // Default to 47652BR if it exists, otherwise fallback to 46401BR / 46394BR
            const defaultJd = data.jds.find((j: any) => 
              (j.fileName && j.fileName.includes("47652")) || 
              (j.brId && j.brId.includes("47652")) ||
              (j.id && j.id.includes("47652"))
            ) || data.jds.find((j: any) => 
              (j.fileName && (j.fileName.includes("46401") || j.fileName.includes("46394"))) || 
              (j.brId && (j.brId.includes("46401") || j.brId.includes("46394")))
            ) || data.jds[0];

            if (defaultJd) {
              setJdSavedText(defaultJd.jdText);
              setJdText(defaultJd.jdText);
              return defaultJd.id;
            }
            return "all";
          });
        } else {
          setSelectedJdId(email === "admin@infinite.com" ? "all" : "");
          setJdSavedText("");
          setJdText("");
        }
      }
    } catch (err) {
      console.error("Failed to load JDs", err);
    } finally {
      setIsJdLoading(false);
    }
  };

  const loadEmails = async (emailToUse?: string) => {
    const email = emailToUse || adminEmail;
    setIsEmailsLoading(true);
    try {
      const res = await fetch(`/api/admin/emails?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      setEmails(data.emails || []);
    } catch (err) {
      console.error("Failed to fetch emails", err);
    } finally {
      setIsEmailsLoading(false);
    }
  };

  const loadResetLogs = async () => {
    setIsLogsLoading(true);
    try {
      const res = await fetch("/api/admin/reset_logs");
      const data = await res.json();
      setResetLogs(data.logs || []);
    } catch (err) {
      console.error("Failed to fetch reset logs", err);
    } finally {
      setIsLogsLoading(false);
    }
  };

  const loadEmployees = async () => {
    setIsEmployeesLoading(true);
    try {
      const sendJdId = (selectedJdId && !selectedJdId.includes("@")) ? selectedJdId : "all";
      const jdQuery = `?activeJdId=${encodeURIComponent(sendJdId)}`;
      const res = await fetch(`/api/admin/employees${jdQuery}`);
      const data = await res.json();
      setEmployees(data.employees || []);
      setAllTestResults(data.allTestResults || []);
      setRegisteredAccounts(data.registeredAccounts || []);
    } catch (err) {
      console.error("Failed to fetch employees", err);
    } finally {
      setIsEmployeesLoading(false);
    }
  };

  // Unified Employee Portal roster: every registered account from Supabase,
  // UNIONed with every employeeId that shows up in test results. This makes
  // sure a newly signed-up employee with zero test attempts still appears
  // (previously the portal list was built solely from allTestResults, so
  // brand-new accounts were invisible until they took a test).
  const portalAccounts = useMemo(() => {
    const ids = new Set<string>();
    registeredAccounts.forEach(a => { if (a.employee_id) ids.add(a.employee_id); });
    allTestResults.forEach(t => { if (t.employeeId) ids.add(t.employeeId); });

    return Array.from(ids).map(empId => {
      const empTests = allTestResults.filter(t => t.employeeId === empId);
      const registered = registeredAccounts.find(a => a.employee_id === empId);
      const matchingEmp = employees.find(e => e.employee_id === empId);

      const name = registered?.full_name || matchingEmp?.full_name || empTests[0]?.employeeName || empId;
      const department = registered?.department || matchingEmp?.department || "Auto-Registered";
      const designation = registered?.role || matchingEmp?.designation || "External Candidate";
      const registeredStatus = registered ? "Registered" : (matchingEmp?.status || "Not in Employees Table");
      const skills = matchingEmp?.skills || "—";

      const completedTests = empTests.filter(t => t.status === "completed");
      const totalAttempted = completedTests.reduce((sum, t) => sum + (t.attemptedCount || 0), 0);
      const totalCorrect = completedTests.reduce((sum, t) => sum + (t.correctCount || 0), 0);
      const avgScore = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : null;

      return {
        empId,
        name,
        department,
        designation,
        registeredStatus,
        skills,
        testsCount: completedTests.length,
        avgScore,
        tests: empTests,
      };
    });
  }, [registeredAccounts, allTestResults, employees]);

  const handleExportPortalData = async () => {
    try {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Employee Portal Results');

      // Define columns
      worksheet.columns = [
        { header: 'Employee Name', key: 'name', width: 25 },
        { header: 'Employee ID', key: 'empId', width: 15 },
        { header: 'Department', key: 'department', width: 20 },
        { header: 'Designation', key: 'designation', width: 22 },
        { header: 'Registered Status', key: 'registeredStatus', width: 18 },
        { header: 'Skills', key: 'skills', width: 30 },
        { header: 'Tests Taken', key: 'testsCount', width: 12 },
        { header: 'Average Score', key: 'avgScore', width: 15 },
        { header: 'Detailed Test Attempts', key: 'testDetails', width: 50 }
      ];

      // Format header row (Row 1)
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4F46E5' } // Indigo color
      };
      headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
      headerRow.height = 25;

      const accounts = portalAccounts.map(acc => ({
        name: acc.name,
        empId: acc.empId,
        department: acc.department,
        designation: acc.designation,
        registeredStatus: acc.registeredStatus,
        skills: acc.skills,
        testsCount: acc.testsCount,
        avgScore: acc.avgScore !== null ? `${acc.avgScore}%` : "—",
        testDetails: acc.tests.map((t: any) => `${t.topicTitle} (${t.status === 'completed' ? t.score + '%' : t.status})`).join("; ")
      }));

      // Add rows to worksheet
      accounts.forEach(acc => {
        worksheet.addRow(acc);
      });

      // Add styling and borders to data cells
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          row.height = 20;
          row.eachCell((cell) => {
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
            };
          });
        }
      });

      // Write to buffer
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `employee_portal_test_results_${new Date().toISOString().split('T')[0]}.xlsx`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (excelErr) {
      console.error("Failed to export Excel:", excelErr);
    }
  };

  const loadLogs = async () => {
    setIsSystemLogsLoading(true);
    try {
      const moduleParam = logsModuleFilter;
      const statusParam = logsStatusFilter;
      const searchParam = encodeURIComponent(logsSearch);
      const res = await fetch(`/api/admin/logs?module=${moduleParam}&status=${statusParam}&search=${searchParam}`);
      const data = await res.json();
      setSystemLogs(data.logs || []);
    } catch (err) {
      console.error("Failed to fetch system logs", err);
    } finally {
      setIsSystemLogsLoading(false);
    }
  };

  const loadPortalSettings = async () => {
    try {
      const res = await fetch("/api/portal_settings");
      const data = await res.json();
      if (data && typeof data === "object") {
        setPortalSettings({
          showEffectivenessTab: data.showEffectivenessTab !== false,
          showManagerConsoleTab: data.showManagerConsoleTab !== false,
          portalFeaturesEnabled: data.portalFeaturesEnabled !== false
        });
      }
    } catch (err) {
      console.error("Failed to load portal settings:", err);
    }
  };

  const loadInitialData = async (emailToUse?: string) => {
    const email = emailToUse || adminEmail;
    setLoading(true);
    setIsJdLoading(true);
    setIsEmailsLoading(true);
    setIsEmployeesLoading(true);
    setIsLogsLoading(true);
    setIsSystemLogsLoading(true);

    try {
      // 1. Fetch JDs first to compute default selectedJdId
      const jdRes = await fetch(`/api/admin/jd?email=${encodeURIComponent(email)}`);
      const jdData = await jdRes.json();
      const fetchedJds = jdData.jds || [];

      let initialJdId = "all";
      let initialJdText = "";
      if (fetchedJds.length > 0) {
        const defaultJd = fetchedJds.find((j: any) => 
          (j.fileName && j.fileName.includes("47652")) || 
          (j.brId && j.brId.includes("47652")) ||
          (j.id && j.id.includes("47652"))
        ) || fetchedJds.find((j: any) => 
          (j.fileName && (j.fileName.includes("46401") || j.fileName.includes("46394"))) || 
          (j.brId && (j.brId.includes("46401") || j.brId.includes("46394")))
        ) || fetchedJds[0];
        
        if (defaultJd) {
          initialJdId = defaultJd.id;
          initialJdText = defaultJd.jdText;
        }
      }

      // 2. Fetch all other states in parallel using computed default JD ID
      const sendJdId = (initialJdId && !initialJdId.includes("@")) ? initialJdId : "all";
      const [resumesRes, emailsRes, employeesRes, resetLogsRes, logsRes, settingsRes] = await Promise.all([
        fetch(`/api/admin/resumes?email=${encodeURIComponent(email)}`),
        fetch(`/api/admin/emails?email=${encodeURIComponent(email)}`),
        fetch(`/api/admin/employees?activeJdId=${encodeURIComponent(sendJdId)}`),
        fetch("/api/admin/reset_logs"),
        fetch(`/api/admin/logs?module=${logsModuleFilter}&status=${logsStatusFilter}&search=${encodeURIComponent(logsSearch)}`),
        fetch("/api/portal_settings").catch(() => null)
      ]);

      const [resumesData, emailsData, employeesData, resetLogsData, logsData, settingsData] = await Promise.all([
        resumesRes.json(),
        emailsRes.json(),
        employeesRes.json(),
        resetLogsRes.json(),
        logsRes.json(),
        settingsRes ? settingsRes.json().catch(() => ({})) : Promise.resolve({})
      ]);

      // 3. Batch state updates together
      setJds(fetchedJds);
      setResumes(resumesData.resumes || []);
      setEmails(emailsData.emails || []);
      setEmployees(employeesData.employees || []);
      setAllTestResults(employeesData.allTestResults || []);
      setRegisteredAccounts(employeesData.registeredAccounts || []);
      setResetLogs(resetLogsData.logs || []);
      setSystemLogs(logsData.logs || []);
      
      if (settingsData && typeof settingsData === "object") {
        setPortalSettings({
          showEffectivenessTab: settingsData.showEffectivenessTab !== false,
          showManagerConsoleTab: settingsData.showManagerConsoleTab !== false,
          portalFeaturesEnabled: settingsData.portalFeaturesEnabled !== false
        });
      }

      if (fetchedJds.length > 0) {
        setSelectedJdId(initialJdId);
        setJdSavedText(initialJdText);
        setJdText(initialJdText);
      } else {
        setSelectedJdId(email === "admin@infinite.com" ? "all" : "");
        setJdSavedText("");
        setJdText("");
      }

    } catch (err) {
      console.error("Failed to load initial data", err);
    } finally {
      isInitialLoadRef.current = false;
      setLoading(false);
      setIsJdLoading(false);
      setIsEmailsLoading(false);
      setIsEmployeesLoading(false);
      setIsLogsLoading(false);
      setIsSystemLogsLoading(false);
    }
  };

  const handleTogglePortalSetting = async (key: "showEffectivenessTab" | "showManagerConsoleTab" | "portalFeaturesEnabled") => {
    setIsUpdatingSettings(true);
    const updatedVal = !portalSettings[key];
    const newSettings = {
      ...portalSettings,
      [key]: updatedVal
    };
    
    // Optimistic UI update
    setPortalSettings(newSettings);
    
    try {
      const token = typeof window !== "undefined" ? window.sessionStorage.getItem("admin_token") || "" : "";
      const res = await fetch("/api/admin/portal_settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          settings: newSettings,
          adminEmail
        })
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || "Failed to update portal settings.");
      }
      setActionSuccess("Employee portal configuration updated successfully.");
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      // Revert optimistic update
      setPortalSettings(portalSettings);
      setActionError(err.message || "Failed to update settings.");
      setTimeout(() => setActionError(null), 3000);
    } finally {
      setIsUpdatingSettings(false);
    }
  };

  const handleRefresh = async (type: "requirements" | "candidates" | "employees" | "interviews") => {
    setPipelineStatus(`Ingestion: Refreshing ${type}...`);
    setActivityLogs(prev => [`[${new Date().toLocaleTimeString()}] Starting refresh for ${type}...`, ...prev]);
    try {
      const sendJdId = (selectedJdId && !selectedJdId.includes("@")) ? selectedJdId : "all";
      const jdQuery = `&activeJdId=${encodeURIComponent(sendJdId)}`;
      const res = await fetch(`/api/admin/refresh?type=${type}${jdQuery}`, {
        method: "POST"
      });
      const result = await res.json();
      if (result.success) {
        setPipelineStatus(`Ingestion: Idle (Last refresh: ${new Date().toLocaleTimeString()})`);
        setActivityLogs(prev => [`[${new Date().toLocaleTimeString()}] Refresh ${type} completed.`, ...prev]);
        
        if (type === "requirements") {
          await loadJobDescriptions();
        } else if (type === "candidates") {
          await loadResumes();
        } else if (type === "employees") {
          await loadEmployees();
        }
        await loadLogs();
        setActionSuccess(`Refresh of ${type} completed successfully.`);
        setTimeout(() => setActionSuccess(null), 3000);
      } else {
        throw new Error(result.error || "Failed");
      }
    } catch (err: any) {
      setPipelineStatus("Ingestion: Error");
      setActivityLogs(prev => [`[${new Date().toLocaleTimeString()}] Refresh ${type} failed: ${err.message}`, ...prev]);
      setActionError(`Refresh of ${type} failed: ${err.message}`);
      setTimeout(() => setActionError(null), 5000);
    }
  };

  const handleUnifiedUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPipelineStatus(`Ingestion: Uploading ${file.name}...`);
    setActivityLogs(prev => [`[${new Date().toLocaleTimeString()}] Uploading ${file.name} to ${uploadCategory}...`, ...prev]);
    
    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", uploadCategory);
    const sendJdId = (selectedJdId && !selectedJdId.includes("@")) ? selectedJdId : "";
    if (sendJdId) {
      formData.append("activeJdId", sendJdId);
    }

    try {
      const res = await fetch("/api/admin/upload_unified", {
        method: "POST",
        body: formData
      });
      const result = await res.json();
      if (result.success) {
        setPipelineStatus(`Ingestion: Idle`);
        setActivityLogs(prev => [`[${new Date().toLocaleTimeString()}] Successfully uploaded and parsed ${file.name}`, ...prev]);
        
        if (uploadCategory === "resume") {
          await loadResumes();
        } else if (uploadCategory === "jd" || uploadCategory === "br") {
          await loadJobDescriptions();
        } else if (uploadCategory === "employee") {
          await loadEmployees();
        }
        await loadLogs();
        
        setActionSuccess(`Upload and automated ingestion of ${file.name} successful.`);
        setTimeout(() => setActionSuccess(null), 3000);
      } else {
        throw new Error(result.error || "Failed to process upload");
      }
    } catch (err: any) {
      setPipelineStatus("Ingestion: Error");
      setActivityLogs(prev => [`[${new Date().toLocaleTimeString()}] Unified upload failed: ${err.message}`, ...prev]);
      setActionError(`Upload failed: ${err.message}`);
      setTimeout(() => setActionError(null), 5000);
    } finally {
      if (e.target) e.target.value = "";
    }
  };

  const handleShortlistEmployee = async (employeeId: string) => {
    try {
      const res = await fetch("/api/admin/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId })
      });
      const result = await res.json();
      if (result.success) {
        setEmployees(prev => prev.map(e => e.employee_id === employeeId ? { ...e, shortlisted: !e.shortlisted } : e));
      } else {
        throw new Error(result.error || "Failed");
      }
    } catch (err: any) {
      setActionError(`Shortlist toggle failed: ${err.message}`);
      setTimeout(() => setActionError(null), 3000);
    }
  };

  const handleExportEmployees = () => {
    const sendJdId = (selectedJdId && !selectedJdId.includes("@")) ? selectedJdId : "all";
    const jdQuery = `&activeJdId=${encodeURIComponent(sendJdId)}`;
    const token = typeof window !== "undefined" ? window.sessionStorage.getItem("admin_token") || "" : "";
    window.location.href = `/api/admin/employees?export=true${jdQuery}&token=${encodeURIComponent(token)}`;
  };

  const handleDispatchEmployeeMails = async () => {
    const token = typeof window !== "undefined" ? window.sessionStorage.getItem("admin_token") || "" : "";
    setIsDispatchingMails(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const response = await fetch("/api/admin/employees/dispatch_mail", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token, adminEmail }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to dispatch email invitations.");
      }
      setActionSuccess(`Successfully dispatched assessment invitation to ${data.count} shortlisted employee(s).`);
      await loadEmails();
    } catch (err: any) {
      console.error(err);
      setActionError(err.message || "Failed to dispatch emails.");
    } finally {
      setIsDispatchingMails(false);
    }
  };

  const handleDownloadSystemLogs = () => {
    const token = typeof window !== "undefined" ? window.sessionStorage.getItem("admin_token") || "" : "";
    window.location.href = `/api/admin/logs?module=${logsModuleFilter}&download=true&token=${encodeURIComponent(token)}`;
  };

  const handleExportInterviews = () => {
    const token = typeof window !== "undefined" ? window.sessionStorage.getItem("admin_token") || "" : "";
    window.location.href = `/api/admin/interviews/export?token=${encodeURIComponent(token)}`;
  };

  const handleClearSystemLogs = async () => {
    if (!confirm("Are you sure you want to clear all system logs? This cannot be undone.")) return;
    try {
      const res = await fetch("/api/admin/logs", {
        method: "DELETE"
      });
      const result = await res.json();
      if (result.success) {
        setSystemLogs([]);
        setActionSuccess("System logs cleared successfully.");
        setTimeout(() => setActionSuccess(null), 3000);
      }
    } catch (err: any) {
      console.error("Failed to clear system logs:", err);
    }
  };

  const handleConfirmClearLogs = async () => {
    setShowClearLogsModal(false);
    try {
      await fetch("/api/admin/reset_logs", { method: "DELETE" });
      setResetLogs([]);
      setActionSuccess("Reset log activity history cleared successfully.");
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      console.error("Failed to clear logs", err);
      setActionError("Failed to clear reset logs.");
      setTimeout(() => setActionError(null), 3000);
    }
  };

  const handleResetEmailSessionClick = () => {
    const email = resetEmailInput.trim().toLowerCase();
    if (!email) {
      setActionError("Please enter a valid candidate email address to reset.");
      return;
    }
    setResetEmailTarget(email);
  };

  const handleConfirmEmailReset = async () => {
    if (!resetEmailTarget) return;
    const email = resetEmailTarget;

    setResetEmailTarget(null);
    setIsResettingEmail(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const response = await fetch("/api/admin/resumes/reset_by_email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, adminEmail }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to reset session");

      setActionSuccess(`Session for candidate ${email} has been reset and reactivated.`);
      setTimeout(() => setActionSuccess(null), 5000);
      setResetEmailInput("");
      await loadResumes(adminEmail);
      await loadResetLogs();
    } catch (error: any) {
      setActionError(error.message || "Failed to reset session.");
    } finally {
      setIsResettingEmail(false);
    }
  };

  const handleClearOutbox = () => {
    setDeleteTargetId("clear-outbox");
    setDeletePasswordInput("");
    setDeleteModalError(null);
  };

  const handleSaveJd = async () => {
    if (!jdText.trim()) return;
    setIsJdLoading(true);
    setActionError(null);
    try {
      const sendJdId = (selectedJdId && !selectedJdId.includes("@")) ? selectedJdId : undefined;
      const currentJd = sendJdId ? jds.find((j) => j.id === sendJdId) : undefined;
      const rmEmailToUse = currentJd ? currentJd.rmEmail : (selectedJdId.includes("@") ? selectedJdId : adminEmail);

      const response = await fetch("/api/admin/jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jd: jdText.trim(),
          rmEmail: rmEmailToUse,
          jdId: sendJdId || undefined
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save Job Description");

      if (data.jd) {
        setJdSavedText(data.jd.jdText);
        setJdText(data.jd.jdText);
      }
      setIsJdEditing(false);
      setActionSuccess("Job Description saved successfully.");
      setTimeout(() => setActionSuccess(null), 3000);
      await loadJobDescriptions(adminEmail);
    } catch (error: any) {
      setActionError(error.message || "Failed to save Job Description.");
    } finally {
      setIsJdLoading(false);
    }
  };

  const handleJdFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setModalFile(e.target.files[0]);
      setModalTab("file");
      setModalRmEmail(adminEmail);
      setModalError("");
      setShowUploadModal(true);
      if (jdFileInputRef.current) jdFileInputRef.current.value = "";
    }
  };

  const handleJdDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsJdDragging(true);
  };

  const handleJdDragLeave = () => {
    setIsJdDragging(false);
  };

  const handleJdDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsJdDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setModalFile(e.dataTransfer.files[0]);
      setModalTab("file");
      setModalRmEmail(adminEmail);
      setModalError("");
      setShowUploadModal(true);
    }
  };

  const handleModalUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError("");
    
    const emailToTag = modalRmEmail.trim().toLowerCase();
    if (!emailToTag) {
      setModalError("RM Email is required.");
      return;
    }
    if (!emailToTag.endsWith("@infinite.com")) {
      setModalError("RM Email must end with @infinite.com");
      return;
    }

    setModalIsUploading(true);

    try {
      if (modalTab === "file") {
        if (!modalFile) {
          setModalError("Please select a file to upload.");
          setModalIsUploading(false);
          return;
        }

        const formData = new FormData();
        formData.append("file", modalFile);
        formData.append("rmEmail", emailToTag);

        const response = await fetch("/api/admin/jd", {
          method: "POST",
          body: formData,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to parse Job Description file");

        setActionSuccess("Job Description uploaded and parsed successfully.");
        setTimeout(() => setActionSuccess(null), 3000);
        
        await loadJobDescriptions(adminEmail);
        
        if (data.jd?.id) {
          setSelectedJdId(data.jd.id);
          setJdSavedText(data.jd.jdText);
          setJdText(data.jd.jdText);
        }
      } else {
        if (!modalJdText.trim()) {
          setModalError("Please paste the job description text.");
          setModalIsUploading(false);
          return;
        }

        const response = await fetch("/api/admin/jd", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jd: modalJdText.trim(),
            rmEmail: emailToTag
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to save Job Description text");

        setActionSuccess("Job Description saved successfully.");
        setTimeout(() => setActionSuccess(null), 3000);

        await loadJobDescriptions(adminEmail);

        if (data.jd?.id) {
          setSelectedJdId(data.jd.id);
          setJdSavedText(data.jd.jdText);
          setJdText(data.jd.jdText);
        }
      }

      setShowUploadModal(false);
      setModalFile(null);
      setModalJdText("");
      setModalError("");
    } catch (error: any) {
      setModalError(error.message || "An error occurred.");
    } finally {
      setModalIsUploading(false);
    }
  };

  const handleDeleteJd = async (id: string) => {
    if (!id) return;
    const confirm = typeof window !== "undefined"
      ? window.confirm("Are you sure you want to delete this Job Description?")
      : false;
    if (!confirm) return;

    setIsJdLoading(true);
    setActionError(null);
    try {
      const originalJd = jds.find((j) => j.id === id);
      const response = await fetch(`/api/admin/jd?id=${id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete Job Description");

      if (originalJd) {
        setUndoStack((prev) => [
          ...prev,
          {
            type: "delete",
            jd: { ...originalJd }
          }
        ]);
      }

      setActionSuccess("Job Description deleted successfully.");
      setTimeout(() => setActionSuccess(null), 3000);
      
      await loadJobDescriptions(adminEmail);
    } catch (error: any) {
      setActionError(error.message || "Failed to delete Job Description.");
    } finally {
      setIsJdLoading(false);
    }
  };

  const handleUpdateRmEmail = async (jdId: string, currentJdText: string, newRmEmail: string, currentFileName: string) => {
    if (!newRmEmail.trim()) {
      setActionError("Creator/RM email cannot be empty.");
      setTimeout(() => setActionError(null), 4000);
      return;
    }
    setIsJdLoading(true);
    try {
      const originalJd = jds.find((j) => j.id === jdId);
      const response = await fetch("/api/admin/jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jdId: jdId,
          jd: currentJdText,
          rmEmail: newRmEmail.trim().toLowerCase(),
          fileName: currentFileName
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update Creator/RM email");

      if (originalJd) {
        setUndoStack((prev) => [
          ...prev,
          {
            type: "update",
            jd: { ...originalJd }
          }
        ]);
      }
      
      setActionSuccess("Creator/RM updated successfully.");
      setTimeout(() => setActionSuccess(null), 3000);
      
      await loadJobDescriptions(adminEmail);
      setEditingJdId(null);
    } catch (err: any) {
      console.error(err);
      setActionError(err.message || "Failed to update Creator/RM email");
      setTimeout(() => setActionError(null), 4000);
    } finally {
      setIsJdLoading(false);
    }
  };

  const handleUpdateBrId = async (jdId: string, currentJdText: string, currentFileName: string, newBrId: string, currentRmEmail: string) => {
    if (!newBrId.trim()) {
      setActionError("BR ID cannot be empty.");
      setTimeout(() => setActionError(null), 4000);
      return;
    }
    
    // Construct new filename
    let filenamePart = currentFileName || "Pasted Job Description";
    if (filenamePart.includes(" | ")) {
      filenamePart = filenamePart.split(" | ")[1];
    }
    const newFileName = `${newBrId.trim()} | ${filenamePart}`;
    
    setIsJdLoading(true);
    try {
      const originalJd = jds.find((j) => j.id === jdId);
      const response = await fetch("/api/admin/jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jdId: jdId,
          jd: currentJdText,
          rmEmail: currentRmEmail,
          fileName: newFileName
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update BR ID");

      if (originalJd) {
        setUndoStack((prev) => [
          ...prev,
          {
            type: "update",
            jd: { ...originalJd }
          }
        ]);
      }
      
      setActionSuccess("BR ID updated successfully.");
      setTimeout(() => setActionSuccess(null), 3000);
      
      await loadJobDescriptions(adminEmail);
      setEditingBrId(null);
    } catch (err: any) {
      console.error(err);
      setActionError(err.message || "Failed to update BR ID");
      setTimeout(() => setActionError(null), 4000);
    } finally {
      setIsJdLoading(false);
    }
  };

  const handleUpdateSkills = async (jdId: string, currentJdText: string, currentFileName: string, newSkillsString: string, currentRmEmail: string) => {
    // Strip old Skills: ... prefix if it exists
    let rawJd = currentJdText;
    const skillsPrefixRegex = /^Skills: (.*?)\n\n([\s\S]*)$/i;
    const match = currentJdText.match(skillsPrefixRegex);
    if (match) {
      rawJd = match[2];
    }
    
    // Prepend new skills
    const updatedJdText = newSkillsString.trim() 
      ? `Skills: ${newSkillsString.trim()}\n\n${rawJd}`
      : rawJd;
      
    setIsJdLoading(true);
    try {
      const originalJd = jds.find((j) => j.id === jdId);
      const response = await fetch("/api/admin/jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jdId: jdId,
          jd: updatedJdText,
          rmEmail: currentRmEmail,
          fileName: currentFileName
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update skills");

      if (originalJd) {
        setUndoStack((prev) => [
          ...prev,
          {
            type: "update",
            jd: { ...originalJd }
          }
        ]);
      }
      
      setActionSuccess("Skills updated successfully.");
      setTimeout(() => setActionSuccess(null), 3000);
      
      await loadJobDescriptions(adminEmail);
      setEditingSkillsId(null);
    } catch (err: any) {
      console.error(err);
      setActionError(err.message || "Failed to update skills");
      setTimeout(() => setActionError(null), 4000);
    } finally {
      setIsJdLoading(false);
    }
  };

  const handleUndo = async () => {
    if (undoStack.length === 0) return;
    const lastAction = undoStack[undoStack.length - 1];
    setIsJdLoading(true);
    try {
      const response = await fetch("/api/admin/jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jdId: lastAction.jd.id,
          jd: lastAction.jd.jdText,
          rmEmail: lastAction.jd.rmEmail,
          fileName: lastAction.jd.fileName,
          createdAt: lastAction.jd.createdAt
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to undo last action");
      
      setActionSuccess(`Undo successful: Restored ${lastAction.type === 'delete' ? 'deleted' : 'previous'} requirement.`);
      setTimeout(() => setActionSuccess(null), 3000);
      
      await loadJobDescriptions(adminEmail);
      setUndoStack((prev) => prev.slice(0, -1));
    } catch (err: any) {
      console.error(err);
      setActionError(err.message || "Failed to undo action");
      setTimeout(() => setActionError(null), 4000);
    } finally {
      setIsJdLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files);
      
      let finalFiles: File[] = [];
      
      for (const file of filesArray) {
        const isZip = file.name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
        if (isZip) {
          try {
            const JSZip = (await import("jszip")).default;
            const zip = new JSZip();
            const contents = await zip.loadAsync(file);
            
            const zipFiles: File[] = [];
            
            // Loop through each entry in the zip file
            for (const [relativePath, entry] of Object.entries(contents.files)) {
              if (entry.dir) continue;
              
              // Skip OS metadata/hidden files
              const baseName = relativePath.split('/').pop() || relativePath;
              if (baseName.startsWith('.') || relativePath.startsWith('__MACOSX')) continue;
              
              const ext = baseName.split('.').pop()?.toLowerCase() || '';
              if (!['pdf', 'doc', 'docx', 'txt'].includes(ext)) continue;
              
              const fileData = await entry.async("blob");
              
              // Map extension to mime type
              let mimeType = 'text/plain';
              if (ext === 'pdf') mimeType = 'application/pdf';
              else if (ext === 'docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
              else if (ext === 'doc') mimeType = 'application/msword';
              
              const extractedFile = new File([fileData], baseName, { type: mimeType });
              zipFiles.push(extractedFile);
            }
            
            finalFiles = [...finalFiles, ...zipFiles];
          } catch (zipError) {
            console.error("Error reading zip file client-side:", zipError);
            setActionError(`Failed to unzip file: ${file.name}`);
            setTimeout(() => setActionError(null), 4000);
          }
        } else {
          finalFiles.push(file);
        }
      }
      
      if (finalFiles.length > 20) {
        setActionError("Maximum 20 CVs can be uploaded at the same time.");
        setTimeout(() => setActionError(null), 4000);
        return;
      }
      
      setSelectedFiles(finalFiles);
      setUploadQueue(
        finalFiles.map((f) => ({
          name: f.name,
          status: "pending",
        }))
      );
    }
  };

  const handleBulkUpload = async () => {
    if (selectedFiles.length === 0) return;

    // Identify duplicates in selected files
    const duplicates = selectedFiles.filter(file => resumes.some(r => r.filename === file.name));
    
    if (duplicates.length > 0) {
      setDuplicateFiles(duplicates.map(file => ({ file, replace: true }))); // default to true (Replace)
      setShowDuplicateModal(true);
    } else {
      startUploadExecution([]);
    }
  };

  const handleConfirmDuplicateModal = () => {
    setShowDuplicateModal(false);
    const choices = duplicateFiles.map(d => ({ name: d.file.name, replace: d.replace }));
    startUploadExecution(choices);
  };

  const handleCancelDuplicateModal = () => {
    setShowDuplicateModal(false);
    setDuplicateFiles([]);
    setSelectedFiles([]);
    setIsBulkUploading(false);
  };

  const startUploadExecution = async (replaceChoices: { name: string; replace: boolean }[]) => {
    setIsBulkUploading(true);
    setActionError(null);

    const choiceMap = new Map<string, boolean>();
    replaceChoices.forEach(c => choiceMap.set(c.name, c.replace));

    // Process files sequentially to show individual progress and avoid server timeouts
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      
      const isDuplicate = resumes.some((r) => r.filename === file.name);
      const shouldReplace = choiceMap.get(file.name) ?? false;
      const skipUpload = isDuplicate && !shouldReplace;
      const forceReplace = isDuplicate && shouldReplace;

      if (skipUpload) {
        setUploadQueue((prev) => {
          const copy = [...prev];
          copy[i].status = "completed";
          const existing = resumes.find(r => r.filename === file.name);
          copy[i].score = existing?.report?.jdMatchScore ?? existing?.analysis?.overallScore ?? 70;
          copy[i].suitability = existing?.report?.suitability ?? "suitable";
          return copy;
        });
        continue;
      }

      setUploadQueue((prev) => {
        const copy = [...prev];
        copy[i].status = "uploading";
        return copy;
      });

      const formData = new FormData();
      formData.append("file", file);
      const sendJdId = (selectedJdId && !selectedJdId.includes("@")) ? selectedJdId : "";
      if (sendJdId) formData.append("jdId", sendJdId);
      formData.append("rmEmail", adminEmail);
      if (jdText) formData.append("jdText", jdText);
      if (forceReplace) formData.append("forceReplace", "true");

      try {
        const res = await fetch("/api/admin/resumes/upload_bulk", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Parsing failed");
        }

        if (data.isZip && data.resumes) {
          const zipResumesQueue = data.resumes.map((r: any) => ({
            name: r.filename,
            status: "completed" as const,
            score: r.report?.jdMatchScore ?? r.analysis?.overallScore ?? 70,
            suitability: r.report?.suitability ?? "suitable",
          }));

          setUploadQueue((prev) => {
            const copy = [...prev];
            copy.splice(i, 1, ...zipResumesQueue);
            return copy;
          });
        } else {
          setUploadQueue((prev) => {
            const copy = [...prev];
            copy[i].status = "completed";
            copy[i].score = data.resume?.report?.jdMatchScore ?? data.resume?.analysis?.overallScore ?? 70;
            copy[i].suitability = data.resume?.report?.suitability ?? "suitable";
            return copy;
          });
        }
      } catch (err: any) {
        setUploadQueue((prev) => {
          const copy = [...prev];
          copy[i].status = "failed";
          copy[i].error = err.message || "Upload failed";
          return copy;
        });
      }
    }

    // Refresh candidate resumes
    await loadResumes(adminEmail);
    setIsBulkUploading(false);
    setSelectedFiles([]);
  };

  const handleOverrideSuitability = async (resumeId: string, currentSuitability: string) => {
    const nextSuitability = currentSuitability === "suitable" ? "unsuitable" : "suitable";
    setActionLoading(resumeId);
    setActionError(null);
    try {
      const activeJdIdToSend = (selectedJdId && selectedJdId !== "all" && !selectedJdId.includes("@")) ? selectedJdId : null;
      const res = await fetch(`/api/admin/resumes/${resumeId}/suitability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suitability: nextSuitability, activeJdId: activeJdIdToSend }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Override failed");

      // Update locally
      setResumes((prev) =>
        prev.map((r) => {
          if (r.id === resumeId) {
            return {
              ...r,
              report: {
                ...r.report,
                suitability: nextSuitability,
                ...(activeJdIdToSend ? { jdId: activeJdIdToSend } : {})
              },
            };
          }
          return r;
        })
      );
      setActionSuccess("Suitability category overridden successfully.");
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (e: any) {
      setActionError(e.message || "Failed to update category.");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  const handleResetSessionClick = (resume: any) => {
    setResetTargetResume(resume);
  };

  const handleConfirmReset = async () => {
    if (!resetTargetResume) return;

    const resumeId = resetTargetResume.id;
    const resetEmail = resetTargetResume.parsed?.personal?.email || "";
    setActionLoading(resumeId);
    setActionError(null);

    // Close modal (but keep email variable)
    setResetTargetResume(null);

    try {
      const res = await fetch(`/api/admin/resumes/${resumeId}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");

      // Update locally to clear completed badge and proctoring info
      setResumes((prev) =>
        prev.map((r) => {
          if (r.id === resumeId) {
            const updatedReport = r.report ? { ...r.report } : {};
            delete updatedReport.videoUrl;
            delete updatedReport.proctoring;

            return {
              ...r,
              interview_attempts: [],
              isConcluded: false,
              report: updatedReport,
              reset: true,
            };
          }
          return r;
        })
      );

      // Remove any sent invitation email for this candidate
      setEmails((prev) => prev.filter((e) => e.to !== resetEmail));
      setActionSuccess("Candidate interview session has been reset and reactivated.");
      setTimeout(() => setActionSuccess(null), 3000);
      await loadResetLogs();
    } catch (e: any) {
      setActionError(e.message || "Failed to reset candidate session.");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  const handleConfirmSendInvite = async () => {
    if (!inviteTargetResume) return;
    const resume = inviteTargetResume;
    const email = resume.parsed?.personal?.email;
    if (!email) {
      setActionError("Cannot send invite: No email address detected in candidate's resume.");
      return;
    }

    setActionLoading(resume.id);
    setActionError(null);
    setActionSuccess(null);
    setInviteTargetResume(null);

    try {
      const interviewConfig = {
        interviewType: inviteType,
        sections: inviteType === "technical" ? {
          overlapping: countOverlapping,
          gap: countGap,
          projects: countProjects,
          coding: countCoding
        } : {
          behavioral: countBehavioral,
          leadership: countLeadership,
          softskills: countSoftSkills
        }
      };

      const response = await fetch(`/api/admin/resumes/${resume.id}/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ interviewConfig })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to dispatch invite email");

      await loadEmails();
      setActionSuccess(`Invitation email simulated & dispatched to ${email}! Secure assessment access is unlocked.`);
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (error: any) {
      setActionError(error.message || "Failed to dispatch invite email.");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendInvite = (resume: any) => {
    const email = resume.parsed?.personal?.email;
    if (!email) {
      setActionError("Cannot send invite: No email address detected in candidate's resume.");
      return;
    }
    setInviteTargetResume(resume);
    setInviteType("technical");
    setCountOverlapping(8);
    setCountGap(3);
    setCountProjects(4);
    setCountCoding(2);
    setCountBehavioral(5);
    setCountLeadership(5);
    setCountSoftSkills(5);
  };

  const handleDeleteRecordClick = (resumeId: string) => {
    setDeleteTargetId(resumeId);
    setDeletePasswordInput("");
    setDeleteModalError(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;

    if (deletePasswordInput !== "qwerty") {
      setDeleteModalError("Invalid supervisor password.");
      return;
    }

    const targetId = deleteTargetId;

    // Close modal
    setDeleteTargetId(null);
    setDeletePasswordInput("");
    setDeleteModalError(null);

    if (targetId === "bulk") {
      setActionLoading("bulk-resumes");
      setActionError(null);
      try {
        const response = await fetch("/api/admin/resumes", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: selectedResumeIds })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to delete records");

        setActionSuccess(`${selectedResumeIds.length} candidate record(s) deleted successfully.`);
        setSelectedResumeIds([]);
        setTimeout(() => setActionSuccess(null), 3000);
        await loadResumes(adminEmail);
      } catch (error: any) {
        setActionError(error.message || "Failed to delete records.");
      } finally {
        setActionLoading(null);
      }
      return;
    }

    if (targetId === "bulk-employees-pool") {
      setActionLoading("bulk-employees-pool");
      setActionError(null);
      try {
        const response = await fetch("/api/admin/employees", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: selectedEmployeeIds })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to delete selected employees");

        setActionSuccess(`${selectedEmployeeIds.length} employee record(s) deleted successfully.`);
        setSelectedEmployeeIds([]);
        setTimeout(() => setActionSuccess(null), 3000);
        await loadEmployees();
      } catch (error: any) {
        setActionError(error.message || "Failed to delete employee records.");
      } finally {
        setActionLoading(null);
      }
      return;
    }

    if (targetId === "bulk-emails") {
      setActionLoading("bulk-emails");
      setActionError(null);
      try {
        const response = await fetch("/api/admin/emails", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: selectedEmailIds })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to delete emails");

        setActionSuccess(`${selectedEmailIds.length} outbox log(s) deleted successfully.`);
        setSelectedEmailIds([]);
        setTimeout(() => setActionSuccess(null), 3000);
        await loadEmails(adminEmail);
      } catch (error: any) {
        setActionError(error.message || "Failed to delete email logs.");
      } finally {
        setActionLoading(null);
      }
      return;
    }

    if (targetId === "clear-outbox") {
      setIsEmailsLoading(true);
      setActionError(null);
      try {
        const response = await fetch("/api/admin/emails", {
          method: "DELETE",
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to clear outbox");

        setEmails([]);
        setActionSuccess("Outbox logs cleared successfully.");
        setTimeout(() => setActionSuccess(null), 3000);
      } catch (error: any) {
        setActionError(error.message || "Failed to clear outbox logs.");
      } finally {
        setIsEmailsLoading(false);
      }
      return;
    }

    if (targetId.startsWith("email-")) {
      const emailId = targetId.substring(6); // remove "email-" prefix
      setActionLoading(targetId);
      setActionError(null);
      try {
        const response = await fetch("/api/admin/emails", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [emailId] })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to delete email log");

        setEmails((prev) => prev.filter((item) => item.id !== emailId));
        setActionSuccess("Simulated invitation email log deleted successfully.");
        setTimeout(() => setActionSuccess(null), 3000);
      } catch (error: any) {
        setActionError(error.message || "Failed to delete email log.");
      } finally {
        setActionLoading(null);
      }
      return;
    }

    if (targetId.startsWith("emp-")) {
      const empId = targetId.substring(4);
      setActionLoading(targetId);
      setActionError(null);
      try {
        const response = await fetch("/api/admin/employees", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId: empId })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to delete employee record");

        setEmployees((prev) => prev.filter((emp) => emp.employee_id !== empId));
        setActionSuccess("Employee record deleted successfully.");
        setTimeout(() => setActionSuccess(null), 3000);
      } catch (error: any) {
        setActionError(error.message || "Failed to delete employee record.");
      } finally {
        setActionLoading(null);
      }
      return;
    }

    setActionLoading(targetId);
    setActionError(null);

    try {
      const response = await fetch(`/api/admin/resumes/${targetId}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error || "Failed to delete record");
      }

      setResumes((prev) => prev.filter((resume) => resume.id !== targetId));
      setActionSuccess("Resume record and candidate session deleted successfully.");
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (error: any) {
      setActionError(error.message || "Failed to delete record");
    } finally {
      setActionLoading(null);
    }
  };

  const handleShowDetails = (resume: any) => {
    setSelectedResume(resume);
    setShowDetails(true);
  };

  const handleDownloadCV = (resumeId: string, filename: string) => {
    const token = typeof window !== "undefined" ? window.sessionStorage.getItem("admin_token") : "";
    const link = document.createElement("a");
    link.href = `/api/admin/resumes/${resumeId}/download?token=${encodeURIComponent(token || "")}`;
    link.download = filename || "resume.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Drag and drop handlers for JDs in JD-to-BR converter
  const handleJdToBrDrag = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleJdToBrDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const files = Array.from(e.dataTransfer.files).filter(f => 
        f.name.endsWith('.docx') || f.name.endsWith('.pdf')
      );
      setJdToBrFiles(prev => [...prev, ...files]);
      resetJdToBrStatus();
    }
  };

  const handleJdToBrSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).filter(f => 
        f.name.endsWith('.docx') || f.name.endsWith('.pdf')
      );
      setJdToBrFiles(prev => [...prev, ...files]);
      resetJdToBrStatus();
    }
  };

  const removeJdToBrFile = (idx: number) => {
    const targetFile = jdToBrFiles[idx];
    if (targetFile) {
      setJdCustomIds(prev => {
        const copy = { ...prev };
        delete copy[targetFile.name];
        return copy;
      });
    }
    setJdToBrFiles(prev => prev.filter((_, i) => i !== idx));
    resetJdToBrStatus();
  };

  // Excel template handler for JD-to-BR converter
  const handleJdToBrExcelSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.name.endsWith('.xlsx')) {
        setExcelTemplate(file);
        resetJdToBrStatus();
      } else {
        setErrorMessage('Please upload a valid Excel spreadsheet template (.xlsx)');
      }
    }
  };

  const resetJdToBrStatus = () => {
    setDownloadUrl(null);
    setErrorMessage(null);
    setProgressText('');
  };

  const handleJdIdChange = (filename: string, val: string) => {
    setJdCustomIds(prev => ({
      ...prev,
      [filename]: val
    }));
  };

  // Submit and process JDs + Excel
  const generateUpdatedExcel = async (customIdsOverride?: { [filename: string]: string }) => {
    if (jdToBrFiles.length === 0) {
      setErrorMessage('Please upload at least one Job Description (.docx or .pdf) file.');
      return;
    }
    if (!excelTemplate) {
      setErrorMessage('Please upload one Excel template (.xlsx) file.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    setDownloadUrl(null);
    setProgressText('Extracting JD text and running AI NLP models...');

    const formData = new FormData();
    jdToBrFiles.forEach(file => {
      formData.append('jds', file);
    });
    formData.append('template', excelTemplate);

    // Conjoin JDs custom IDs mapping
    const activeIds = customIdsOverride || jdCustomIds;
    const mapping: { [filename: string]: string } = {};
    jdToBrFiles.forEach(file => {
      if (activeIds[file.name]) {
        mapping[file.name] = activeIds[file.name];
      }
    });
    formData.append('jdReqIdsMapping', JSON.stringify(mapping));

    try {
      const progressTimer = setTimeout(() => {
        setProgressText('Mapping fields and cloning cell-level borders/styles...');
      }, 2000);

      const res = await fetch('/api/admin/jd-to-br', {
        method: 'POST',
        body: formData
      });

      clearTimeout(progressTimer);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Spreadsheet processing failed.');
      }

      // Read response as binary blob attachment
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      
      const outName = `updated_${excelTemplate.name}`;
      setDownloadUrl(url);
      setOutputFilename(outName);
      
      setProgressText('');
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'FastAPI parser server connection failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateClick = () => {
    if (jdToBrFiles.length === 0) {
      setErrorMessage('Please upload at least one Job Description (.docx or .pdf) file.');
      return;
    }
    if (!excelTemplate) {
      setErrorMessage('Please upload one Excel template (.xlsx) file.');
      return;
    }

    if (jdToBrFiles.length > 1) {
      setWizardTempIds({ ...jdCustomIds });
      setWizardIndex(0);
      setIsWizardOpen(true);
    } else {
      generateUpdatedExcel();
    }
  };

  const handleWizardNext = () => {
    if (wizardIndex < jdToBrFiles.length - 1) {
      setWizardIndex(prev => prev + 1);
    } else {
      setJdCustomIds({ ...wizardTempIds });
      setIsWizardOpen(false);
      generateUpdatedExcel(wizardTempIds);
    }
  };

  const isJdSet = !!jdSavedText.trim();

  const selectedSelectValue = (() => {
    if (!selectedJdId || selectedJdId === "all") return "all";
    if (selectedJdId.includes("@")) return selectedJdId;
    const currentJd = jds.find(j => j.id === selectedJdId);
    if (currentJd) {
      return (currentJd.rmEmail || "admin@infinite.com").toLowerCase().trim();
    }
    return "all";
  })();

  // Categorize candidate list
  const activeJdResumes = resumes.filter((r) => {
    if (selectedJdId && selectedJdId !== "all") {
      if (selectedJdId.includes("@")) {
        const emailJds = jds.filter(j => (j.rmEmail || "admin@infinite.com").toLowerCase().trim() === selectedJdId.toLowerCase().trim());
        const emailJdIds = emailJds.map(j => j.id);
        const emailJdDuplicateIds = emailJds.flatMap(j => Array.isArray(j.duplicateIds) ? j.duplicateIds.map(resolveJdId) : []);
        const candidateJdId = resolveJdId(r.report?.jdId);
        return emailJdIds.includes(candidateJdId) || emailJdDuplicateIds.includes(candidateJdId);
      }
      // Show all candidate resumes, they will be dynamically classified as suitable/unsuitable based on score
      return true;
    }
    return true;
  });

  const filteredJds = jds.filter((j) => {
    if (selectedJdId && selectedJdId !== "all") {
      if (selectedJdId.includes("@")) {
        return (j.rmEmail || "admin@infinite.com").toLowerCase().trim() === selectedJdId.toLowerCase().trim();
      }
      const activeJd = jds.find(item => item.id === selectedJdId);
      const activeRmEmail = activeJd?.rmEmail || "admin@infinite.com";
      if (activeRmEmail.toLowerCase().trim() === "admin@infinite.com") {
        return true;
      }
      return (j.rmEmail || "admin@infinite.com").toLowerCase().trim() === activeRmEmail.toLowerCase().trim();
    }
    return true;
  });

  const defaultJd = jds.find(j => 
    (j.fileName && j.fileName.includes("47652")) || 
    (j.brId && j.brId.includes("47652")) ||
    (j.id && j.id.includes("47652"))
  ) || jds.find(j => 
    (j.fileName && (j.fileName.includes("46401") || j.fileName.includes("46394"))) || 
    (j.brId && (j.brId.includes("46401") || j.brId.includes("46394")))
  ) || jds[0];
  const activeJdIdForHighlight = (selectedJdId && selectedJdId !== "all" && !selectedJdId.includes("@")) ? selectedJdId : (defaultJd?.id || "");

  const getScore = (r: any) => {
    if (selectedJdId && selectedJdId !== "all" && jdSavedText) {
      return calculateCandidateMatch(r, jdSavedText).score;
    }
    return r.report?.jdMatchScore ?? r.analysis?.overallScore ?? 0;
  };

  const getSuitability = (r: any) => {
    if (selectedJdId && selectedJdId !== "all" && jdSavedText) {
      const currentJd = jds.find(j => j.id === selectedJdId);
      const candidateJdId = resolveJdId(r.report?.jdId);
      const isOriginallyForActiveJd = currentJd && (
        candidateJdId === selectedJdId || 
        (Array.isArray(currentJd.duplicateIds) && currentJd.duplicateIds.map(resolveJdId).includes(candidateJdId))
      );
      if (isOriginallyForActiveJd) {
        return r.report?.suitability ?? "suitable";
      }
      const score = getScore(r);
      return score >= 40 ? "suitable" : "unsuitable";
    }
    return r.report?.suitability ?? "suitable";
  };

  const suitableCandidates = activeJdResumes
    .filter((r) => getSuitability(r) === "suitable")
    .sort((a, b) => getScore(b) - getScore(a));

  const unsuitableCandidates = activeJdResumes
    .filter((r) => getSuitability(r) === "unsuitable")
    .sort((a, b) => getScore(b) - getScore(a));

  const rawCandidates = activeTab === "suitable" ? suitableCandidates : unsuitableCandidates;

  const candidatesToRender = rawCandidates.filter(c => {
    if (!candidateSearch) return true;
    const term = candidateSearch.toLowerCase();
    const fullName = c.parsed?.personal?.fullName || "";
    const email = c.parsed?.personal?.email || "";
    const filename = c.filename || "";
    const skills = (c.parsed?.skills?.technical || []).join(" ");
    return (
      fullName.toLowerCase().includes(term) ||
      email.toLowerCase().includes(term) ||
      filename.toLowerCase().includes(term) ||
      skills.toLowerCase().includes(term)
    );
  });

  const filteredEmployees = employees
    .filter(emp => {
      if (!employeeSearch) return true;
      const term = employeeSearch.toLowerCase();
      return (
        emp.full_name?.toLowerCase().includes(term) ||
        emp.employee_id?.toLowerCase().includes(term) ||
        emp.skills?.toLowerCase().includes(term)
      );
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  const bestMatch = employees.length > 0
    ? employees.reduce((best, current) => (current.score || 0) > (best.score || 0) ? current : best, employees[0])
    : null;

  const emailsToRender = emails.filter((email) => {
    if (!outboxSearch) return true;
    const term = outboxSearch.toLowerCase();
    const fullName = email.fullName || "";
    const to = email.to || "";
    const subject = email.subject || "";
    const status = email.status || "";
    return (
      fullName.toLowerCase().includes(term) ||
      to.toLowerCase().includes(term) ||
      subject.toLowerCase().includes(term) ||
      status.toLowerCase().includes(term)
    );
  });

  if (!authInitialized) {
    return (
      <div className="min-h-screen bg-[#f0f4ff] flex items-center justify-center">
        <div className="text-slate-500 font-medium">Loading admin gateway…</div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[#f0f4ff] flex items-center justify-center">
        <div className="text-slate-500 font-medium">Redirecting to login…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f8fafc] via-[#f0f4ff] to-[#e2e8f0] dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 font-sans text-slate-900 dark:text-slate-100 transition-colors duration-300">
      <nav className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-indigo-100 dark:border-slate-800 py-4 px-6 shadow-sm sticky top-0 z-50 transition-colors duration-300">
        <div className="max-w-full mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-md shadow-indigo-500/30">
              <FileText className="w-[18px] h-[18px] text-white" />
            </div>
            <span className="text-lg md:text-xl font-black tracking-tight bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              <span className="hidden sm:inline">HR </span>Screening Console
            </span>
          </div>
          <div className="flex items-center gap-2 md:gap-3 flex-wrap">
            <ThemeToggle />
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => handleRefresh("requirements")}
              className="rounded-xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 gap-1.5 md:gap-2 font-bold text-xs"
            >
              <RefreshCcw className="w-3.5 h-3.5 text-indigo-500" />
              Refresh Requirements
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => handleRefresh("candidates")}
              className="rounded-xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 gap-1.5 md:gap-2 font-bold text-xs"
            >
              <RefreshCcw className="w-3.5 h-3.5 text-indigo-500" />
              Refresh Candidates
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => handleRefresh("employees")}
              className="rounded-xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 gap-1.5 md:gap-2 font-bold text-xs"
            >
              <RefreshCcw className="w-3.5 h-3.5 text-indigo-500" />
              Refresh Employee Data
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => handleRefresh("interviews")}
              className="rounded-xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 gap-1.5 md:gap-2 font-bold text-xs"
            >
              <RefreshCcw className="w-3.5 h-3.5 text-indigo-500" />
              Refresh Interviews
            </Button>
            <Link href="/">
              <Button variant="outline" size="sm" className="rounded-xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 gap-1.5 md:gap-2 font-bold text-xs">
                <ArrowLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Candidate Portal</span>
                <span className="inline sm:hidden">Portal</span>
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-full mx-auto px-6 py-8 space-y-8">
        
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-1">
              <ClipboardList className="w-6 h-6 text-indigo-500" /> Screening Dashboard
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-semibold leading-relaxed">
              Upload job descriptions, screen candidate CVs in bulk, override suitability categories, and reset test sessions.
            </p>
          </div>
        </div>

        {/* Global Action Toasts */}
        {actionSuccess && (
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700 font-semibold flex items-center gap-2 shadow-sm animate-fade-in">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" /> {actionSuccess}
          </div>
        )}
        {actionError && (
          <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600 font-semibold flex items-center gap-2 shadow-sm animate-fade-in">
            <AlertCircle className="w-5 h-5 text-red-500" /> {actionError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:items-stretch items-start">
          
          {/* INGESTION PIPELINE CONTROL CARD */}
          <div className="lg:col-span-3">
            <Card className="p-6 border-indigo-150 dark:border-slate-800 shadow-md bg-white dark:bg-slate-900 rounded-3xl relative overflow-hidden lg:h-full flex flex-col gap-6">
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500" />
              
              <div className="space-y-6">
                <div className="flex justify-between items-center pb-2 border-b border-indigo-50 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <Settings className="w-5 h-5 text-indigo-500 animate-spin-slow" />
                    <div>
                      <h3 className="text-sm font-black text-slate-855 dark:text-slate-100 leading-none">Ingestion Pipeline</h3>
                      <p className="text-[10px] text-slate-400 font-semibold mt-1">Folder-driven automation panel</p>
                    </div>
                  </div>
                  <Badge className={`border-0 font-extrabold uppercase tracking-wider text-[9px] px-2 py-0.5 ${
                    pipelineStatus.includes("Error") ? "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400" :
                    pipelineStatus.includes("Idle") ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" :
                    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 animate-pulse"
                  }`}>
                    {pipelineStatus.includes("Idle") ? "Active" : "Processing"}
                  </Badge>
                </div>

                {/* Pipeline Status Indicator */}
                <div className="rounded-2xl border border-indigo-50 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 p-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative flex h-2 w-2">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                        pipelineStatus.includes("Error") ? "bg-rose-450" :
                        pipelineStatus.includes("Idle") ? "bg-emerald-450" :
                        "bg-amber-450"
                      }`} />
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${
                        pipelineStatus.includes("Error") ? "bg-rose-500" :
                        pipelineStatus.includes("Idle") ? "bg-emerald-500" :
                        "bg-amber-500"
                      }`} />
                    </div>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">{pipelineStatus}</span>
                  </div>
                  {activityLogs.length > 0 && (
                    <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider shrink-0">
                      Auto-Syncing
                    </span>
                  )}
                </div>

                {/* Requirement / Active BR Selector */}
                {jds.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                      Active Requirement (JD / BR)
                    </label>
                    <div className="flex gap-2">
                      {adminEmail === "admin@infinite.com" ? (
                        <select
                          value={selectedSelectValue}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSelectedJdId(val);
                            if (val === "all") {
                              setJdSavedText("");
                              setJdText("");
                            } else {
                              const firstJd = jds.find(j => (j.rmEmail || "admin@infinite.com").toLowerCase().trim() === val.toLowerCase().trim());
                              if (firstJd) {
                                setJdSavedText(firstJd.jdText);
                                setJdText(firstJd.jdText);
                              } else {
                                setJdSavedText("");
                                setJdText("");
                              }
                            }
                          }}
                          className="w-0 flex-1 min-w-0 rounded-xl border border-indigo-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 p-2 text-[11px] font-bold text-slate-755 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-200 truncate"
                        >
                          <option value="all">📁 All Job Descriptions (View All Candidates)</option>
                          {(() => {
                            const seenEmails = new Set();
                            return jds.reduce((acc: any[], j) => {
                              const email = (j.rmEmail || "admin@infinite.com").toLowerCase().trim();
                              if (email !== "admin@infinite.com" && !seenEmails.has(email)) {
                                seenEmails.add(email);
                                acc.push(
                                  <option key={email} value={email} title={email}>
                                    {email}
                                  </option>
                                );
                              }
                              return acc;
                            }, []);
                          })()}
                        </select>
                      ) : (
                        <div className="flex-1 min-w-0 rounded-lg border border-indigo-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 px-2.5 py-2 text-[10px] font-bold text-slate-755 dark:text-slate-200 truncate select-none cursor-default">
                          {adminEmail}
                        </div>
                      )}
                      {selectedJdId && selectedJdId !== "all" && adminEmail === "admin@infinite.com" && (
                        <Button
                          variant="ghost"
                          onClick={() => handleDeleteJd(selectedJdId)}
                          className="h-8 w-8 p-0 hover:bg-rose-50 text-rose-500 hover:text-rose-600 rounded-lg flex items-center justify-center border border-rose-100 dark:border-slate-800"
                          title="Delete this Job Description"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Background Scan Controls */}
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                    Automated Folder Scanning
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      variant="outline"
                      onClick={() => handleRefresh("requirements")}
                      className="flex flex-col items-center justify-center px-1.5 py-2.5 h-auto rounded-2xl border-indigo-50 hover:bg-indigo-50/30 hover:border-indigo-200 dark:border-slate-800 dark:hover:bg-slate-950/40 gap-1 text-center group transition-all duration-300 shadow-sm"
                    >
                      <ClipboardList className="w-4 h-4 text-indigo-500 group-hover:scale-110 transition duration-200" />
                      <span className="text-[10px] font-extrabold text-slate-855 dark:text-slate-200 whitespace-nowrap">Scan Requirements</span>
                      <span className="text-[7.5px] text-slate-400 font-semibold uppercase whitespace-nowrap">/docs/BR & /docs/JD</span>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleRefresh("candidates")}
                      className="flex flex-col items-center justify-center px-1.5 py-2.5 h-auto rounded-2xl border-indigo-50 hover:bg-indigo-50/30 hover:border-indigo-200 dark:border-slate-800 dark:hover:bg-slate-950/40 gap-1 text-center group transition-all duration-300 shadow-sm"
                    >
                      <FileText className="w-4 h-4 text-indigo-500 group-hover:scale-110 transition duration-200" />
                      <span className="text-[10px] font-extrabold text-slate-855 dark:text-slate-200 whitespace-nowrap">Scan Candidates</span>
                      <span className="text-[7.5px] text-slate-400 font-semibold uppercase whitespace-nowrap">/docs/Resumes</span>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleRefresh("employees")}
                      className="flex flex-col items-center justify-center px-1.5 py-2.5 h-auto rounded-2xl border-indigo-50 hover:bg-indigo-50/30 hover:border-indigo-200 dark:border-slate-800 dark:hover:bg-slate-950/40 gap-1 text-center group transition-all duration-300 shadow-sm"
                    >
                      <Users className="w-4 h-4 text-indigo-500 group-hover:scale-110 transition duration-200" />
                      <span className="text-[10px] font-extrabold text-slate-855 dark:text-slate-200 whitespace-nowrap">Scan Employees</span>
                      <span className="text-[7.5px] text-slate-400 font-semibold uppercase whitespace-nowrap">/docs/Corp Pool</span>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleRefresh("interviews")}
                      className="flex flex-col items-center justify-center px-1.5 py-2.5 h-auto rounded-2xl border-indigo-50 hover:bg-indigo-50/30 hover:border-indigo-200 dark:border-slate-800 dark:hover:bg-slate-955/40 gap-1 text-center group transition-all duration-300 shadow-sm"
                    >
                      <Video className="w-4 h-4 text-indigo-500 group-hover:scale-110 transition duration-200" />
                      <span className="text-[10px] font-extrabold text-slate-855 dark:text-slate-200 whitespace-nowrap">Sync Interviews</span>
                      <span className="text-[7.5px] text-slate-400 font-semibold uppercase whitespace-nowrap">Database & CSV</span>
                    </Button>
                  </div>
                </div>
              </div>

              {/* Unified Ingestion Upload */}
              <div className="space-y-3 pt-2 flex-grow flex flex-col min-h-0">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                    Unified File Upload
                  </label>
                  <select
                    value={uploadCategory}
                    onChange={(e) => setUploadCategory(e.target.value)}
                    className="w-full rounded-xl border border-indigo-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 p-2 text-[11px] font-bold text-slate-755 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-200 truncate"
                  >
                    <option value="resume">📄 Candidate Resume</option>
                    <option value="jd">💼 Job Description (JD)</option>
                    <option value="br">📊 Business Requirement (BR)</option>
                    <option value="employee">👥 Employee Pool Data</option>
                    <option value="interview">📝 Interview CSV Sync</option>
                  </select>
                </div>

                <div 
                  onClick={() => unifiedFileInputRef.current?.click()}
                  className="border-2 border-dashed border-indigo-100 dark:border-slate-800 hover:border-indigo-455 dark:hover:border-slate-700 bg-slate-50/30 dark:bg-slate-950/30 hover:bg-indigo-50/20 dark:hover:bg-slate-900/20 rounded-2xl p-5 text-center cursor-pointer transition-all duration-300 flex flex-col items-center justify-center gap-1.5 group flex-1"
                >
                  <Upload className="w-7 h-7 text-indigo-500 group-hover:scale-110 transition-transform duration-200" />
                  <span className="text-[11px] font-bold text-slate-750 dark:text-slate-250">
                    Click to select file for upload
                  </span>
                  <span className="text-[9px] text-slate-400 font-semibold max-w-[240px] leading-relaxed block">
                    {uploadCategory === 'resume' && "Saves to /docs/Resumes & auto-screens"}
                    {uploadCategory === 'jd' && "Saves to /docs/JD & parses details"}
                    {uploadCategory === 'br' && "Saves to /docs/BR as excel template row"}
                    {uploadCategory === 'employee' && "Saves to /docs/Corp Pool & updates match scores"}
                    {uploadCategory === 'interview' && "Syncs and parses candidate_interview_data.csv"}
                  </span>
                  <input
                    type="file"
                    ref={unifiedFileInputRef}
                    onChange={handleUnifiedUpload}
                    className="hidden"
                    accept={
                      uploadCategory === 'resume' ? '.pdf,.doc,.docx,.zip' :
                      uploadCategory === 'jd' ? '.pdf,.doc,.docx,.txt' :
                      uploadCategory === 'br' ? '.xlsx,.csv' :
                      uploadCategory === 'employee' ? '.csv,.xlsx,.pdf,.doc,.docx' :
                      '.csv'
                    }
                  />
                </div>
              </div>
            </Card>
          </div>

          {/* SCREENING RESULTS TAB CONTAINER (9 Columns) */}
          <div className="lg:col-span-9">
            <Card className="border-indigo-100 dark:border-slate-800 shadow-md bg-white dark:bg-slate-900 rounded-3xl overflow-hidden flex flex-col lg:h-full">
              
              {/* Tab Header Navigation */}
              <div className="flex overflow-x-auto scrollbar-none border-b border-indigo-50 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 shrink-0">
                <button
                  onClick={() => setActiveTab("requirements")}
                  className={`flex-1 py-4 px-6 font-black text-sm transition-all duration-300 border-b-2 flex items-center justify-center gap-2 flex-shrink-0 whitespace-nowrap ${
                    activeTab === "requirements"
                      ? "border-indigo-600 text-indigo-700 bg-white dark:bg-slate-900 dark:text-violet-400"
                      : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
                  }`}
                >
                  <ClipboardList className="w-4 h-4 text-indigo-500" />
                  Requirements (BR / JD)
                  <Badge className={`border-0 text-[10px] ${activeTab === "requirements" ? "bg-indigo-100 text-indigo-700 dark:bg-slate-800 dark:text-violet-400" : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"}`}>
                    {filteredJds.length}
                  </Badge>
                </button>
                <button
                  onClick={() => setActiveTab("employee")}
                  className={`flex-1 py-4 px-6 font-black text-sm transition-all duration-300 border-b-2 flex items-center justify-center gap-2 flex-shrink-0 whitespace-nowrap ${
                    activeTab === "employee"
                      ? "border-indigo-600 text-indigo-700 bg-white dark:bg-slate-900 dark:text-violet-400"
                      : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
                  }`}
                >
                  Employee Data
                  <Badge className={`border-0 text-[10px] ${activeTab === "employee" ? "bg-indigo-100 text-indigo-700 dark:bg-slate-800 dark:text-violet-400" : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"}`}>
                    {employees.length}
                  </Badge>
                </button>
                <button
                  onClick={() => setActiveTab("suitable")}
                  className={`flex-1 py-4 px-6 font-black text-sm transition-all duration-300 border-b-2 flex items-center justify-center gap-2 flex-shrink-0 whitespace-nowrap ${
                    activeTab === "suitable"
                      ? "border-indigo-600 text-indigo-700 bg-white dark:bg-slate-900 dark:text-violet-400"
                      : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
                  }`}
                >
                  Suitable Candidates
                  <Badge className={`border-0 text-[10px] ${activeTab === "suitable" ? "bg-indigo-100 text-indigo-700 dark:bg-slate-800 dark:text-violet-400" : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"}`}>
                    {suitableCandidates.length}
                  </Badge>
                </button>
                <button
                  onClick={() => setActiveTab("unsuitable")}
                  className={`flex-1 py-4 px-6 font-black text-sm transition-all duration-300 border-b-2 flex items-center justify-center gap-2 flex-shrink-0 whitespace-nowrap ${
                    activeTab === "unsuitable"
                      ? "border-indigo-600 text-indigo-700 bg-white dark:bg-slate-900 dark:text-violet-400"
                      : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
                  }`}
                >
                  Non-Suitable Candidates
                  <Badge className={`border-0 text-[10px] ${activeTab === "unsuitable" ? "bg-indigo-100 text-indigo-700 dark:bg-slate-800 dark:text-violet-400" : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"}`}>
                    {unsuitableCandidates.length}
                  </Badge>
                </button>
                <button
                  onClick={() => setActiveTab("employee-portal")}
                  className={`flex-1 py-4 px-6 font-black text-sm transition-all duration-300 border-b-2 flex items-center justify-center gap-2 flex-shrink-0 whitespace-nowrap ${
                    activeTab === "employee-portal"
                      ? "border-indigo-600 text-indigo-700 bg-white dark:bg-slate-900 dark:text-violet-400"
                      : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
                  }`}
                >
                  Employee Portal
                  <Badge className={`border-0 text-[10px] ${activeTab === "employee-portal" ? "bg-indigo-100 text-indigo-700 dark:bg-slate-800 dark:text-violet-400" : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"}`}>
                    {portalAccounts.length}
                  </Badge>
                </button>
                <button
                  onClick={() => setActiveTab("outbox")}
                  className={`flex-1 py-4 px-6 font-black text-sm transition-all duration-300 border-b-2 flex items-center justify-center gap-2 flex-shrink-0 whitespace-nowrap ${
                    activeTab === "outbox"
                      ? "border-indigo-600 text-indigo-700 bg-white dark:bg-slate-900 dark:text-violet-400"
                      : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
                  }`}
                >
                  <Mail className="w-4 h-4 text-indigo-500" />
                  Email Outbox
                  <Badge className={`border-0 text-[10px] ${activeTab === "outbox" ? "bg-indigo-100 text-indigo-700 dark:bg-slate-800 dark:text-violet-400" : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"}`}>
                    {emails.length}
                  </Badge>
                </button>
              </div>

              {/* Candidates List Container */}
              <div className="p-6">
                {loading ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-24 gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                    <p className="text-slate-500 font-bold text-sm">Loading records…</p>
                  </div>
                ) : activeTab === "requirements" ? (
                  <div className="space-y-4">
                    {/* Search requirements */}
                    <div className="flex flex-col sm:flex-row gap-3 justify-between items-center shrink-0">
                      <div className="w-full sm:w-72 relative">
                        <input
                          type="text"
                          placeholder="Search requirements..."
                          value={requirementSearch}
                          onChange={(e) => setRequirementSearch(e.target.value)}
                          className="w-full rounded-xl border border-indigo-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 p-2.5 pl-3 text-xs font-semibold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-200"
                        />
                      </div>
                    </div>

                    {/* Requirements Table */}
                    <div className="border border-indigo-50 dark:border-slate-800 rounded-2xl overflow-hidden">
                      <div className="overflow-auto max-h-[500px]">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-100/90 dark:bg-slate-950/90 backdrop-blur-md border-b border-indigo-50 dark:border-slate-800 text-slate-500 font-extrabold uppercase tracking-wider text-[10px] sticky top-0 z-10">
                              <th className="p-3 w-8"></th>
                              <th className="p-3 w-20">BR ID</th>
                              <th className="p-3 w-1/4">Requirement / File</th>
                              <th className="p-3 w-1/4">Extracted Skills</th>
                              <th className="p-3 w-32">Creator / RM</th>
                              <th className="p-3 w-24">Created Date</th>
                              <th className="p-3 w-40 text-center">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-indigo-50/50 dark:divide-slate-800/50">
                            {(() => {
                              const baseJds = [...filteredJds].filter((j) => {
                                const searchLower = requirementSearch.toLowerCase();
                                const displayName = j.fileName || "";
                                const email = j.rmEmail || "";
                                const text = j.jdText || "";
                                return (
                                  displayName.toLowerCase().includes(searchLower) ||
                                  email.toLowerCase().includes(searchLower) ||
                                  text.toLowerCase().includes(searchLower)
                                );
                              });

                              // Group JDs by text to identify duplicates
                              const textGroups: { [key: string]: any[] } = {};
                              baseJds.forEach((j) => {
                                const normalizedText = (j.jdText || "").trim().toLowerCase();
                                if (!textGroups[normalizedText]) {
                                  textGroups[normalizedText] = [];
                                }
                                textGroups[normalizedText].push(j);
                              });

                              // For each group, sort by createdAt ascending (oldest is OG)
                              const ogJds: any[] = [];
                              const duplicatesMap = new Map<string, any[]>();
                              Object.values(textGroups).forEach((group) => {
                                group.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                                const og = group[0];
                                ogJds.push(og);
                                if (group.length > 1) {
                                  duplicatesMap.set(og.id, group.slice(1));
                                }
                              });

                              // Sort OG JDs: keep 46401BR at the very top, followed by 49238BR, then by skills
                              ogJds.sort((a, b) => {
                                const isA46401 = (a.fileName && (a.fileName.includes("46401") || a.fileName.includes("46394"))) || (a.brId && (a.brId.includes("46401") || a.brId.includes("46394")));
                                const isB46401 = (b.fileName && (b.fileName.includes("46401") || b.fileName.includes("46394"))) || (b.brId && (b.brId.includes("46401") || b.brId.includes("46394")));
                                
                                const isA49238 = (a.fileName && a.fileName.includes("49238")) || (a.brId && a.brId.includes("49238"));
                                const isB49238 = (b.fileName && b.fileName.includes("49238")) || (b.brId && b.brId.includes("49238"));

                                // 46401BR is always first
                                if (isA46401 && !isB46401) return -1;
                                if (!isA46401 && isB46401) return 1;

                                // 49238BR is second
                                if (isA49238 && !isB49238) return -1;
                                if (!isA49238 && isB49238) return 1;

                                const aSkills = extractSkillsFromText(a.jdText).length;
                                const bSkills = extractSkillsFromText(b.jdText).length;
                                if (aSkills === 0 && bSkills > 0) return 1;
                                if (bSkills === 0 && aSkills > 0) return -1;
                                return bSkills - aSkills;
                              });

                              // Flatten into final rendering order: OG followed immediately by duplicates
                              const orderedJds: { jd: any; isDuplicate: boolean; ogJd?: any }[] = [];
                              ogJds.forEach((og) => {
                                orderedJds.push({ jd: og, isDuplicate: false });
                                const dups = duplicatesMap.get(og.id);
                                if (dups) {
                                  dups.forEach((dup) => {
                                    orderedJds.push({ jd: dup, isDuplicate: true, ogJd: og });
                                  });
                                }
                              });

                              return orderedJds.map(({ jd: j, isDuplicate, ogJd }) => {
                                let brNo = "N/A";
                                let filename = j.fileName || "Pasted Job Description";
                                if (filename.includes(" | ")) {
                                  const parts = filename.split(" | ");
                                  brNo = parts[0];
                                  filename = parts[1];
                                } else if (filename.match(/^\d+BR$/i)) {
                                  brNo = filename;
                                }
                                const isActive = activeJdIdForHighlight === j.id;
                                const isExpanded = expandedJdId === j.id;
                                const skills = extractSkillsFromText(j.jdText);

                                let ogBrNo = "";
                                if (isDuplicate && ogJd) {
                                  const ogFileName = ogJd.fileName || "";
                                  if (ogFileName.includes(" | ")) {
                                    ogBrNo = ogFileName.split(" | ")[0];
                                  } else if (ogFileName.match(/^\d+BR$/i)) {
                                    ogBrNo = ogFileName;
                                  } else {
                                    ogBrNo = ogFileName.substring(0, 15) + (ogFileName.length > 15 ? "..." : "");
                                  }
                                }

                                return (
                                  <React.Fragment key={j.id}>
                                    <tr className={`hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition-colors duration-150 ${
                                      isActive ? "bg-indigo-50/10 dark:bg-indigo-950/10" : ""
                                    } ${
                                      isDuplicate ? "bg-amber-50/5 dark:bg-amber-950/5 border-l-2 border-amber-400 dark:border-amber-550" : ""
                                    }`}>
                                      <td className="p-3 text-center">
                                        <button
                                          onClick={() => setExpandedJdId(isExpanded ? null : j.id)}
                                          className="text-slate-400 hover:text-indigo-650 transition animate-fade-in"
                                        >
                                          {isExpanded ? (
                                            <ChevronUp className="w-4 h-4" />
                                          ) : (
                                            <ChevronDown className="w-4 h-4" />
                                          )}
                                        </button>
                                      </td>
                                      <td className={`p-3 font-black text-slate-800 dark:text-slate-200 whitespace-nowrap ${isDuplicate ? "pl-6" : ""}`}>
                                        <div className="flex items-center gap-1.5">
                                          {isDuplicate && <span className="text-amber-550 dark:text-amber-400 font-black text-xs">↳</span>}
                                          {editingBrId === j.id ? (
                                            <div className="flex items-center gap-1">
                                              <input
                                                type="text"
                                                value={editingBrValue}
                                                onChange={(e) => setEditingBrValue(e.target.value)}
                                                className="w-20 p-1 text-[10px] font-bold rounded border border-indigo-200 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-indigo-400 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-200"
                                                placeholder="BR ID"
                                                autoFocus
                                              />
                                              <button
                                                onClick={() => handleUpdateBrId(j.id, j.jdText, j.fileName, editingBrValue, j.rmEmail)}
                                                className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                                                title="Save"
                                              >
                                                <CheckCircle2 className="w-3.5 h-3.5" />
                                              </button>
                                              <button
                                                onClick={() => setEditingBrId(null)}
                                                className="p-1 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                                                title="Cancel"
                                              >
                                                <X className="w-3.5 h-3.5" />
                                              </button>
                                            </div>
                                          ) : (
                                            <div className="flex items-center gap-1 group">
                                              {brNo !== "N/A" ? (
                                                <Badge className="bg-indigo-100 dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 font-extrabold border-0 text-[10px] px-2 py-0.5">
                                                  {brNo}
                                                </Badge>
                                              ) : (
                                                <span className="text-slate-400 italic">No BR ID</span>
                                              )}
                                              {adminEmail === "admin@infinite.com" && (
                                                <button
                                                  onClick={() => {
                                                    setEditingBrId(j.id);
                                                    setEditingBrValue(brNo === "N/A" ? "" : brNo);
                                                  }}
                                                  className="p-0.5 rounded text-slate-400 hover:text-indigo-650 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                                                  title="Edit BR ID"
                                                >
                                                  <Edit2 className="w-3 h-3" />
                                                </button>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      </td>
                                      <td className={`p-3 ${isDuplicate ? "pl-6" : ""}`}>
                                        <div className="font-bold text-slate-800 dark:text-slate-200 max-w-[200px] truncate" title={filename}>
                                          {filename}
                                        </div>
                                        <div className="text-[10px] text-slate-400 font-semibold max-w-[200px] truncate">
                                          {j.jdText ? j.jdText.substring(0, 85) + "..." : ""}
                                        </div>
                                        {isDuplicate && (
                                          <div className="mt-1.5">
                                            <Badge className="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-extrabold border border-amber-200/50 dark:border-amber-900/50 text-[9px] px-1.5 py-0.5 inline-flex items-center gap-1 shadow-sm">
                                              <AlertCircle className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400 shrink-0" />
                                              <span>Duplicate of {ogBrNo || "Original"}</span>
                                            </Badge>
                                          </div>
                                        )}
                                      </td>
                                      <td className="p-3">
                                        {editingSkillsId === j.id ? (
                                          <div className="flex items-center gap-1">
                                            <input
                                              type="text"
                                              value={editingSkillsValue}
                                              onChange={(e) => setEditingSkillsValue(e.target.value)}
                                              className="w-48 p-1 text-[10px] font-bold rounded border border-indigo-200 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-indigo-400 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-200"
                                              placeholder="comma-separated skills"
                                              autoFocus
                                            />
                                            <button
                                              onClick={() => handleUpdateSkills(j.id, j.jdText, j.fileName, editingSkillsValue, j.rmEmail)}
                                              className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                                              title="Save"
                                            >
                                              <CheckCircle2 className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                              onClick={() => setEditingSkillsId(null)}
                                              className="p-1 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                                              title="Cancel"
                                            >
                                              <X className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        ) : (
                                          <div className="flex items-center gap-1 group">
                                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                                              {skills.length > 0 ? (
                                                skills.slice(0, 4).map((s) => (
                                                  <Badge key={s} className="bg-slate-100 dark:bg-slate-800 border-0 text-slate-700 dark:text-slate-300 text-[9px] px-1.5 py-0 font-bold">
                                                    {s}
                                                  </Badge>
                                                ))
                                              ) : (
                                                <span className="text-slate-400 italic text-[10px]">No skills extracted</span>
                                              )}
                                              {skills.length > 4 && (
                                                <span className="text-slate-400 text-[9px] font-extrabold self-center">
                                                  +{skills.length - 4} more
                                                </span>
                                              )}
                                            </div>
                                            <button
                                              onClick={() => {
                                                setEditingSkillsId(j.id);
                                                setEditingSkillsValue(skills.join(", "));
                                              }}
                                              className="p-0.5 rounded text-slate-400 hover:text-indigo-650 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                                              title="Edit Skills"
                                            >
                                              <Edit2 className="w-3 h-3" />
                                            </button>
                                          </div>
                                        )}
                                      </td>
                                      <td className="p-3">
                                        {editingJdId === j.id ? (
                                          <div className="flex items-center gap-1">
                                            <input
                                              type="text"
                                              value={editingRmEmail}
                                              onChange={(e) => setEditingRmEmail(e.target.value)}
                                              className="w-24 p-1 text-[10px] font-bold rounded border border-indigo-200 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-indigo-400 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-200"
                                              placeholder="RM Email"
                                              autoFocus
                                            />
                                            <button
                                              onClick={() => handleUpdateRmEmail(j.id, j.jdText, editingRmEmail, j.fileName)}
                                              className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                                              title="Save"
                                            >
                                              <CheckCircle2 className="w-4 h-4" />
                                            </button>
                                            <button
                                              onClick={() => setEditingJdId(null)}
                                              className="p-1 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                                              title="Cancel"
                                            >
                                              <X className="w-4 h-4" />
                                            </button>
                                          </div>
                                        ) : (
                                          <div className="flex items-center gap-1 group">
                                            <span className="truncate max-w-[110px]" title={j.rmEmail}>
                                              {j.rmEmail}
                                            </span>
                                            <button
                                              onClick={() => {
                                                setEditingJdId(j.id);
                                                setEditingRmEmail(j.rmEmail || "admin@infinite.com");
                                              }}
                                              className="p-0.5 rounded text-slate-400 hover:text-indigo-650 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                                              title="Edit Creator / RM"
                                            >
                                              <Edit2 className="w-3 h-3" />
                                            </button>
                                          </div>
                                        )}
                                      </td>
                                      <td className="p-3 text-slate-500 font-medium whitespace-nowrap">
                                        {new Date(j.createdAt).toLocaleDateString()}
                                      </td>
                                      <td className="p-3 text-center">
                                        <div className="flex items-center justify-center gap-1.5">
                                          <Button
                                            size="sm"
                                            variant={isActive ? "outline" : "default"}
                                            onClick={() => {
                                              setSelectedJdId(j.id);
                                              setJdSavedText(j.jdText);
                                              setJdText(j.jdText);
                                              setActiveTab("employee");
                                            }}
                                            className={`h-7 px-2.5 rounded-lg text-[10px] font-extrabold transition duration-200 ${
                                              isActive
                                                ? "border-indigo-200 text-indigo-600 dark:border-slate-800"
                                                : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                                            }`}
                                          >
                                            {isActive ? "Viewing Candidates" : "Select & Screen"}
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            onClick={() => handleDeleteJd(j.id)}
                                            className="h-7 w-7 p-0 hover:bg-rose-50 text-rose-500 hover:text-rose-600 rounded-lg flex items-center justify-center border border-rose-100 dark:border-slate-800"
                                            title="Delete this Job Description"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </Button>
                                        </div>
                                      </td>
                                    </tr>
                                    {isExpanded && (
                                      <tr className="bg-slate-50/40 dark:bg-slate-900/10">
                                        <td colSpan={7} className="p-4 border-t border-indigo-50/50 dark:border-slate-800/50 animate-fade-in">
                                          <div className="space-y-3 max-w-4xl mx-auto">
                                            <div>
                                              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Full Job Description</h4>
                                              <pre className="text-xs text-slate-700 dark:text-slate-355 bg-slate-50/80 dark:bg-slate-950 p-4 rounded-2xl border border-indigo-50/60 dark:border-slate-800 max-h-60 overflow-y-auto whitespace-pre-wrap font-sans leading-relaxed">
                                                {j.jdText}
                                              </pre>
                                            </div>
                                            {skills.length > 0 && (
                                              <div>
                                                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">All Detected Technical Skills ({skills.length})</h4>
                                                <div className="flex flex-wrap gap-1.5">
                                                  {skills.map((s) => (
                                                    <Badge key={s} className="bg-indigo-50 dark:bg-slate-800 border-0 text-indigo-700 dark:text-indigo-300 text-[10px] px-2.5 py-0.5 font-bold">
                                                      {s}
                                                    </Badge>
                                                  ))}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                );
                              });
                            })()}
                            {jds.length === 0 && (
                              <tr>
                                <td colSpan={7} className="text-center py-12 text-slate-400 italic">
                                  No Job Descriptions / BRs uploaded or scanned yet.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : activeTab === "employee" ? (
                  isEmployeesLoading ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-24 gap-3">
                      <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                      <p className="text-slate-500 font-bold text-sm">Loading employee pool…</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Summary Metrics */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
                        <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-indigo-50 dark:border-slate-800 rounded-2xl shadow-sm text-center">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Total Employees</span>
                          <span className="text-xl md:text-2xl font-black text-indigo-600 dark:text-violet-400">{employees.length}</span>
                        </div>
                        <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-indigo-50 dark:border-slate-800 rounded-2xl shadow-sm text-center flex flex-col items-center justify-center min-h-[70px]">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Matches &gt;60% (JD)</span>
                          {selectedJdId && selectedJdId !== "all" ? (
                            <div className="w-full">
                              <span className="text-xl md:text-2xl font-black text-emerald-600 dark:text-emerald-400 block leading-none">
                                {employees.filter(e => (e.score || 0) > 60).length}
                              </span>
                              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block mt-1.5 leading-none">
                                Qualified Profiles
                              </span>
                            </div>
                          ) : (
                            <span className="text-xl md:text-2xl font-black text-slate-400 block mt-1 leading-none">N/A</span>
                          )}
                        </div>
                        <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-indigo-50 dark:border-slate-800 rounded-2xl shadow-sm text-center">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Shortlisted</span>
                          <span className="text-xl md:text-2xl font-black text-violet-600 dark:text-fuchsia-400">
                            {employees.filter(e => e.shortlisted).length}
                          </span>
                        </div>
                        <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-indigo-50 dark:border-slate-800 rounded-2xl shadow-sm text-center">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Avg Match Score</span>
                          <span className="text-xl md:text-2xl font-black text-indigo-600 dark:text-violet-400">
                            {employees.length > 0 ? Math.round(employees.reduce((acc, curr) => acc + (curr.score || 0), 0) / employees.length) : 0}%
                          </span>
                        </div>
                      </div>

                      {/* Search and export controls */}
                      <div className="flex flex-col sm:flex-row gap-3 justify-between items-center shrink-0">
                        <div className="w-full sm:w-72 relative">
                          <input
                            type="text"
                            placeholder="Search employees..."
                            value={employeeSearch}
                            onChange={(e) => setEmployeeSearch(e.target.value)}
                            className="w-full rounded-xl border border-indigo-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 p-2.5 pl-3 text-xs font-semibold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-200"
                          />
                        </div>
                        <div className="flex gap-2 w-full sm:w-auto">
                          {employees.filter(e => e.shortlisted).length > 0 && (
                            <Button
                              onClick={handleDispatchEmployeeMails}
                              disabled={isDispatchingMails}
                              className="flex-1 sm:flex-none rounded-xl bg-violet-600 hover:bg-violet-700 text-white gap-1.5 font-bold text-xs"
                            >
                              {isDispatchingMails ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Mail className="w-3.5 h-3.5" />
                              )}
                              Dispatch Mail
                            </Button>
                          )}
                          <Button
                            onClick={handleExportEmployees}
                            variant="outline"
                            size="sm"
                            className="flex-1 sm:flex-none rounded-xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 gap-1.5 font-bold text-xs"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Export Pool
                          </Button>
                          <Button
                            onClick={handleExportInterviews}
                            variant="outline"
                            size="sm"
                            className="flex-1 sm:flex-none rounded-xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 gap-1.5 font-bold text-xs"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Export Interviews
                          </Button>
                        </div>
                      </div>

                      {/* Bulk action banner */}
                      {selectedEmployeeIds.length > 0 && (
                        <div className="flex items-center justify-between p-3.5 bg-indigo-50/50 dark:bg-slate-900/40 border border-indigo-100 dark:border-slate-800/80 rounded-2xl shadow-sm animate-fade-in shrink-0">
                          <span className="text-xs font-bold text-indigo-900 dark:text-indigo-200">
                            {selectedEmployeeIds.length} employee{selectedEmployeeIds.length > 1 ? "s" : ""} selected for bulk actions
                          </span>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isBulkDispatchingMails}
                              onClick={handleBulkDispatchEmployees}
                              className="h-8 text-xs font-bold rounded-xl flex items-center gap-1.5 px-3 border border-indigo-200 dark:border-slate-700 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 shadow-sm"
                            >
                              {isBulkDispatchingMails ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Dispatching...
                                </>
                              ) : (
                                <>
                                  <Mail className="w-3.5 h-3.5" /> Bulk Dispatch
                                </>
                              )}
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={actionLoading === "bulk-employees-pool"}
                              onClick={handleBulkDeleteEmployees}
                              className="h-8 text-xs font-bold rounded-xl flex items-center gap-1.5 px-3 bg-red-600 hover:bg-red-700 text-white shadow-sm shadow-red-500/25"
                            >
                              {actionLoading === "bulk-employees-pool" ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Deleting...
                                </>
                              ) : (
                                <>
                                  <Trash2 className="w-3.5 h-3.5" /> Delete Selected
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Employee Table */}
                      <div className="border border-indigo-50 dark:border-slate-800 rounded-2xl overflow-hidden">
                        <div className="overflow-auto max-h-[500px]">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-slate-100/90 dark:bg-slate-950/90 backdrop-blur-md border-b border-indigo-50 dark:border-slate-800 text-slate-500 font-extrabold uppercase tracking-wider text-[10px] sticky top-0 z-10">
                                <th className="p-3 w-10 text-center">
                                  <input
                                    type="checkbox"
                                    checked={filteredEmployees.length > 0 && filteredEmployees.every(emp => selectedEmployeeIds.includes(emp.employee_id))}
                                    onChange={handleToggleAllEmployees}
                                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700 cursor-pointer"
                                  />
                                </th>
                                <th className="p-3">Name</th>
                                <th className="p-3">Employee ID</th>
                                <th className="p-3">Department</th>
                                <th className="p-3">Skill Match</th>
                                <th className="p-3">Score</th>
                                <th className="p-3 text-center">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-indigo-50/50 dark:divide-slate-800/50">
                              {filteredEmployees.map(emp => (
                                  <tr key={emp.employee_id} className={`hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition-colors duration-150 ${
                                    selectedEmployeeIds.includes(emp.employee_id) ? "bg-indigo-50/20 dark:bg-indigo-950/20" : ""
                                  }`}>
                                    <td className="p-3 text-center">
                                      <input
                                        type="checkbox"
                                        checked={selectedEmployeeIds.includes(emp.employee_id)}
                                        onChange={() => handleToggleEmployeeSelect(emp.employee_id)}
                                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700 cursor-pointer"
                                      />
                                    </td>
                                    <td className="p-3 font-semibold">
                                      <div>{emp.full_name}</div>
                                      <div className="text-[10px] text-slate-400 font-medium">{emp.designation}</div>
                                    </td>
                                    <td className="p-3 font-bold text-slate-500">{emp.employee_id}</td>
                                    <td className="p-3 text-slate-600 dark:text-slate-300 font-semibold">{emp.department}</td>
                                    <td className="p-3">
                                      <div className="flex flex-wrap gap-1 max-w-[180px]">
                                        {emp.matchingSkills && emp.matchingSkills.length > 0 ? (
                                          emp.matchingSkills.slice(0, 3).map((s: string) => (
                                            <Badge key={s} className="bg-indigo-50 border-0 text-indigo-700 text-[9px] px-1.5 py-0">
                                              {s}
                                            </Badge>
                                          ))
                                        ) : (
                                          <span className="text-slate-400 text-[10px]">No skills match</span>
                                        )}
                                        {emp.matchingSkills && emp.matchingSkills.length > 3 && (
                                          <span className="text-[9px] text-slate-400 font-bold">+{emp.matchingSkills.length - 3} more</span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="p-3">
                                      <span className={`font-black text-sm ${
                                        emp.score >= 70 ? 'text-emerald-600 dark:text-emerald-400' : (emp.score >= 40 ? 'text-amber-500' : 'text-rose-500')
                                      }`}>
                                        {emp.score}%
                                      </span>
                                    </td>
                                    <td className="p-3">
                                      <div className="flex items-center justify-center gap-1.5">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => setActiveEmployee(emp)}
                                          className="h-7 text-[10px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100"
                                        >
                                          View
                                        </Button>
                                        <Button
                                          variant={emp.shortlisted ? "default" : "outline"}
                                          size="sm"
                                          onClick={() => handleShortlistEmployee(emp.employee_id)}
                                          className={`h-7 text-[10px] font-bold ${
                                            emp.shortlisted
                                              ? 'bg-violet-600 hover:bg-violet-700 text-white'
                                              : 'border-violet-200 text-violet-700 hover:bg-violet-50'
                                          }`}
                                        >
                                          {emp.shortlisted ? "Deselect" : "Shortlist"}
                                        </Button>
                                        <Button
                                          variant="destructive"
                                          size="sm"
                                          disabled={actionLoading === `emp-${emp.employee_id}`}
                                          onClick={() => {
                                            setDeleteTargetId(`emp-${emp.employee_id}`);
                                            setDeletePasswordInput("");
                                            setDeleteModalError(null);
                                          }}
                                          className="h-7 px-2 rounded-xl text-white hover:bg-red-700"
                                          title="Delete Employee"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )
                ) : activeTab === "employee-portal" ? (
                  <div className="space-y-4">
                    {/* Summary Metrics */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
                      <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-indigo-50 dark:border-slate-800 rounded-2xl shadow-sm text-center">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Total Registered Accounts</span>
                        <span className="text-xl md:text-2xl font-black text-indigo-600 dark:text-violet-400">
                          {portalAccounts.length}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-indigo-50 dark:border-slate-800 rounded-2xl shadow-sm text-center">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Total Tests Taken</span>
                        <span className="text-xl md:text-2xl font-black text-emerald-600 dark:text-emerald-400">
                          {allTestResults.length}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-indigo-50 dark:border-slate-800 rounded-2xl shadow-sm text-center">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Avg Tests / Account</span>
                        <span className="text-xl md:text-2xl font-black text-amber-500">
                          {portalAccounts.length > 0
                            ? (allTestResults.length / portalAccounts.length).toFixed(1)
                            : 0}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-indigo-50 dark:border-slate-800 rounded-2xl shadow-sm text-center">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Global Avg Score</span>
                        <span className="text-xl md:text-2xl font-black text-indigo-600 dark:text-violet-400">
                          {allTestResults.filter(t => t.status === "completed").length > 0
                            ? Math.round(
                                allTestResults
                                  .filter(t => t.status === "completed")
                                  .reduce((acc, curr) => acc + (curr.score || 0), 0) /
                                  allTestResults.filter(t => t.status === "completed").length
                              )
                            : 0}%
                        </span>
                      </div>
                    </div>

                    {/* Search and refresh controls */}
                    <div className="flex flex-col sm:flex-row gap-3 justify-between items-center shrink-0">
                      <div className="w-full sm:w-72 relative">
                        <input
                          type="text"
                          placeholder="Search accounts or details..."
                          value={testResultsSearch}
                          onChange={(e) => setTestResultsSearch(e.target.value)}
                          className="w-full rounded-xl border border-indigo-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 p-2.5 pl-3 text-xs font-semibold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-200"
                        />
                      </div>
                      <div className="flex gap-2 w-full sm:w-auto">
                        <Button
                          onClick={handleExportPortalData}
                          variant="outline"
                          size="sm"
                          className="flex-1 sm:flex-none rounded-xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 gap-1.5 font-bold text-xs"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Export to Excel
                        </Button>
                        <Button
                          onClick={loadEmployees}
                          variant="outline"
                          size="sm"
                          className="flex-1 sm:flex-none rounded-xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 gap-1.5 font-bold text-xs"
                        >
                          <RefreshCcw className="w-3.5 h-3.5" />
                          Refresh Portal Data
                        </Button>
                      </div>
                    </div>

                    {/* Accounts Table */}
                    <div className="border border-indigo-50 dark:border-slate-800 rounded-2xl overflow-hidden">
                      <div className="overflow-auto max-h-[600px]">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-100/90 dark:bg-slate-950/90 backdrop-blur-md border-b border-indigo-50 dark:border-slate-800 text-slate-500 font-extrabold uppercase tracking-wider text-[10px] sticky top-0 z-10">
                              <th className="p-3 w-10"></th>
                              <th className="p-3">Employee Name</th>
                              <th className="p-3">Employee ID</th>
                              <th className="p-3">Department</th>
                              <th className="p-3">Designation</th>
                              <th className="p-3">Registered Status</th>
                              <th className="p-3">Tests Taken</th>
                              <th className="p-3">Avg Score</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-indigo-50/50 dark:divide-slate-800/50">
                            {portalAccounts
                              .filter(account => {
                                if (!testResultsSearch) return true;
                                const term = testResultsSearch.toLowerCase();
                                return (
                                  account.name?.toLowerCase().includes(term) ||
                                  account.empId?.toLowerCase().includes(term) ||
                                  account.department?.toLowerCase().includes(term) ||
                                  account.designation?.toLowerCase().includes(term)
                                );
                              })
                              .map(account => {
                                const isExpanded = !!expandedEmployees[account.empId];
                                return (
                                  <React.Fragment key={account.empId}>
                                    <tr 
                                      className="hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition-colors duration-150 cursor-pointer"
                                      onClick={() => setExpandedEmployees(prev => ({
                                        ...prev,
                                        [account.empId]: !prev[account.empId]
                                      }))}
                                    >
                                      <td className="p-3 text-center">
                                        <button className="text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors duration-150">
                                          {isExpanded ? (
                                            <ChevronUp className="w-4 h-4" />
                                          ) : (
                                            <ChevronDown className="w-4 h-4" />
                                          )}
                                        </button>
                                      </td>
                                      <td className="p-3">
                                        <div className="font-semibold text-slate-800 dark:text-slate-150">{account.name}</div>
                                        <div className="text-[10px] text-slate-400 font-medium max-w-xs truncate" title={account.skills}>
                                          Skills: {account.skills}
                                        </div>
                                      </td>
                                      <td className="p-3 font-bold text-slate-500">
                                        {account.empId}
                                        {/\s/.test(account.empId) && !/\d/.test(account.empId) && (
                                          <span title="This ID looks like a name — likely swapped with Employee Name at the data source" className="ml-1.5 text-amber-500">⚠</span>
                                        )}
                                      </td>
                                      <td className="p-3 font-semibold text-slate-600 dark:text-slate-400">{account.department}</td>
                                      <td className="p-3 font-medium text-slate-500">{account.designation}</td>
                                      <td className="p-3">
                                        <Badge className={`border-0 text-[10px] px-2 py-0.5 font-bold ${
                                          account.registeredStatus.toLowerCase() === "active" || account.registeredStatus.toLowerCase() === "registered"
                                            ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/35 dark:text-indigo-300"
                                            : "bg-slate-100 text-slate-700 dark:bg-slate-850 dark:text-slate-300"
                                        }`}>
                                          {account.registeredStatus}
                                        </Badge>
                                      </td>
                                      <td className="p-3">
                                        <Badge className="border-0 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-[10px] px-2 py-0.5">
                                          {account.testsCount} {account.testsCount === 1 ? "Test" : "Tests"}
                                        </Badge>
                                      </td>
                                      <td className="p-3">
                                        <span className={`font-black text-sm ${
                                          account.avgScore !== null
                                            ? (account.avgScore >= 70 ? "text-emerald-600 dark:text-emerald-400" : (account.avgScore >= 40 ? "text-amber-500" : "text-rose-500"))
                                            : "text-slate-400"
                                        }`}>
                                          {account.avgScore !== null ? `${account.avgScore}%` : "—"}
                                        </span>
                                      </td>
                                    </tr>
                                    {isExpanded && (
                                      <tr className="bg-slate-50/40 dark:bg-slate-900/10">
                                        <td colSpan={8} className="p-4 border-t border-b border-indigo-50/50 dark:border-slate-800/50">
                                          <div className="pl-6 space-y-2">
                                            <h4 className="font-extrabold text-[11px] uppercase tracking-wider text-slate-500">
                                              Test Details for {account.name} ({account.empId})
                                            </h4>
                                            <div className="border border-indigo-50 dark:border-slate-850 rounded-xl overflow-hidden bg-white dark:bg-slate-950 shadow-inner">
                                              <table className="w-full text-left border-collapse text-xs">
                                                <thead>
                                                  <tr className="bg-slate-50 dark:bg-slate-900 border-b border-indigo-50 dark:border-slate-850 text-slate-500 font-bold uppercase tracking-wider text-[9px]">
                                                    <th className="p-2.5">Topic / Subject</th>
                                                    <th className="p-2.5">Difficulty</th>
                                                    <th className="p-2.5">Questions</th>
                                                    <th className="p-2.5">Score</th>
                                                    <th className="p-2.5">Status</th>
                                                    <th className="p-2.5">Date / Time</th>
                                                  </tr>
                                                </thead>
                                                <tbody className="divide-y divide-indigo-50/50 dark:divide-slate-850/50">
                                                  {account.tests.map(test => (
                                                    <React.Fragment key={test.id}>
                                                    <tr className="hover:bg-slate-50/30 dark:hover:bg-slate-900/20">
                                                      <td className="p-2.5">
                                                        <div className="font-semibold text-slate-800 dark:text-slate-200">{test.topicTitle}</div>
                                                        <div className="text-[9px] text-slate-400 font-medium">{test.subjectTitle}</div>
                                                        {test.status === "completed" && (
                                                          <button
                                                            onClick={() => toggleTestReview(test.id)}
                                                            className="text-[9px] font-bold text-indigo-600 dark:text-violet-400 hover:underline mt-0.5"
                                                          >
                                                            {expandedTestReviews[test.id] ? "Hide Details" : "View Details"}
                                                          </button>
                                                        )}
                                                      </td>
                                                      <td className="p-2.5 text-slate-600 dark:text-slate-400 font-medium">
                                                        {titleCase(test.difficulty)}
                                                      </td>
                                                      <td className="p-2.5 text-slate-500 font-medium">{test.totalQuestions} Qs</td>
                                                      <td className="p-2.5">
                                                        <span className={`font-black ${
                                                          test.score >= 70 ? "text-emerald-600" : (test.score >= 40 ? "text-amber-500" : "text-rose-500")
                                                        }`}>
                                                          {test.status === "completed" ? `${test.score}%` : "—"}
                                                        </span>
                                                      </td>
                                                      <td className="p-2.5">
                                                        <Badge className={`border-0 text-[9px] px-1.5 py-0.25 font-bold ${
                                                          test.status === "completed" 
                                                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-300"
                                                            : test.status === "in_progress"
                                                              ? "bg-amber-100 text-amber-805 dark:bg-amber-955/35 dark:text-amber-300"
                                                              : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-350"
                                                        }`}>
                                                          {test.status === "completed" ? "Completed" : (test.status === "in_progress" ? "In Progress" : "Pending")}
                                                        </Badge>
                                                      </td>
                                                      <td className="p-2.5 text-slate-550 font-medium">
                                                        {test.completedAt 
                                                          ? new Date(test.completedAt).toLocaleString()
                                                          : (test.startedAt
                                                            ? `Started ${new Date(test.startedAt).toLocaleString()}`
                                                            : "—")}
                                                      </td>
                                                    </tr>
                                                    {expandedTestReviews[test.id] && (
                                                      <tr>
                                                        <td colSpan={6} className="p-3 bg-indigo-50/40 dark:bg-slate-900/40">
                                                          {loadingTestReview[test.id] ? (
                                                            <p className="text-[11px] text-slate-400 italic">Loading answers…</p>
                                                          ) : (testReviewCache[test.id]?.length ?? 0) === 0 ? (
                                                            <p className="text-[11px] text-slate-400 italic">No recorded answers for this attempt.</p>
                                                          ) : (
                                                            <div className="space-y-2.5">
                                                              {testReviewCache[test.id].map((q: any, i: number) => (
                                                                <div key={i} className="rounded-lg border border-indigo-100 dark:border-slate-800 bg-white dark:bg-slate-950 p-3">
                                                                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1.5">
                                                                    {i + 1}. {q.questionText}
                                                                  </p>
                                                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                                                                    {q.options.map((opt: string, oi: number) => {
                                                                      const isCorrectOpt = oi === q.correctOptionIndex;
                                                                      const isSelectedOpt = oi === q.selectedOptionIndex;
                                                                      return (
                                                                        <div
                                                                          key={oi}
                                                                          className={`text-[11px] rounded px-2 py-1 border ${
                                                                            isCorrectOpt
                                                                              ? "bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-300 font-semibold"
                                                                              : isSelectedOpt
                                                                                ? "bg-rose-50 border-rose-300 text-rose-800 dark:bg-rose-950/30 dark:border-rose-800 dark:text-rose-300"
                                                                                : "border-slate-150 text-slate-500 dark:border-slate-800 dark:text-slate-400"
                                                                          }`}
                                                                        >
                                                                          {opt}
                                                                          {isCorrectOpt && " ✓"}
                                                                          {isSelectedOpt && !isCorrectOpt && " (selected)"}
                                                                        </div>
                                                                      );
                                                                    })}
                                                                  </div>
                                                                  {q.selectedOptionIndex === null && (
                                                                    <p className="text-[10px] text-amber-600 mt-1">Not answered.</p>
                                                                  )}
                                                                  {q.explanation && (
                                                                    <p className="text-[10px] text-slate-400 mt-1.5 italic">{q.explanation}</p>
                                                                  )}
                                                                </div>
                                                              ))}
                                                            </div>
                                                          )}
                                                        </td>
                                                      </tr>
                                                    )}
                                                    </React.Fragment>
                                                  ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            {portalAccounts.length === 0 && (
                              <tr>
                                <td colSpan={8} className="text-center py-12 text-slate-400 italic">
                                  No accounts found.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : activeTab === "outbox" ? (
                  isEmailsLoading ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-24 gap-3">
                      <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                      <p className="text-slate-500 font-bold text-sm">Loading outbox logs…</p>
                    </div>
                  ) : emails.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-24 text-center space-y-2">
                      <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-500">
                        <Mail className="w-6 h-6" />
                      </div>
                      <h3 className="font-bold text-slate-800 text-sm">No Emails Sent</h3>
                      <p className="text-xs text-slate-500 max-w-sm leading-relaxed">
                        No invitation emails have been simulated or dispatched to candidates yet. Mark a candidate suitable and click "Send Invite Mail" to simulate an invitation.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Search Bar for Outbox */}
                      <div className="relative shrink-0">
                        <input
                          type="text"
                          placeholder="Search outbox logs..."
                          value={outboxSearch}
                          onChange={(e) => setOutboxSearch(e.target.value)}
                          className="w-full rounded-xl border border-indigo-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 p-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-200"
                        />
                      </div>

                      <div className="flex items-center justify-between pb-2 border-b border-indigo-50 dark:border-slate-800 shrink-0">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={emailsToRender.length > 0 && emailsToRender.every(e => selectedEmailIds.includes(e.id))}
                            onChange={() => {
                              const ids = emailsToRender.map(e => e.id);
                              const allSel = ids.every(id => selectedEmailIds.includes(id));
                              if (allSel) {
                                setSelectedEmailIds(prev => prev.filter(x => !ids.includes(x)));
                              } else {
                                setSelectedEmailIds(prev => Array.from(new Set([...prev, ...ids])));
                              }
                            }}
                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700 cursor-pointer"
                          />
                          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                            {selectedEmailIds.length > 0
                              ? `${selectedEmailIds.length} selected`
                              : `Showing ${emailsToRender.length} Simulated Invitation Email${emailsToRender.length !== 1 ? "s" : ""}`
                            }
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {selectedEmailIds.length > 0 && (
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={actionLoading === "bulk-emails"}
                              onClick={handleBulkDeleteEmails}
                              className="h-8 text-xs font-bold rounded-xl flex items-center gap-1.5 px-3 bg-red-650 hover:bg-red-750 text-white"
                            >
                              {actionLoading === "bulk-emails" ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Deleting...
                                </>
                              ) : (
                                <>
                                  <Trash2 className="w-3.5 h-3.5" /> Delete Selected
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-3 max-h-[550px] overflow-y-auto pr-1">
                        {emailsToRender.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
                            <HelpCircle className="w-8 h-8 text-slate-400" />
                            <h4 className="font-bold text-slate-700 text-xs">No matching outbox emails found</h4>
                          </div>
                        ) : (
                          emailsToRender.map((email) => {
                            return (
                            <Card
                              key={email.id}
                              className={`p-4 border-indigo-50 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-indigo-300 dark:hover:border-slate-700 hover:shadow-soft transition-all duration-300 flex items-start gap-3 ${
                                selectedEmailIds.includes(email.id) ? "border-indigo-400 dark:border-indigo-800 bg-indigo-50/10 dark:bg-indigo-950/10" : ""
                              }`}
                            >
                            <input
                              type="checkbox"
                              checked={selectedEmailIds.includes(email.id)}
                              onChange={() => handleToggleEmailSelect(email.id)}
                              className="mt-1 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700 cursor-pointer"
                            />
                            <div className="flex-1 flex flex-col gap-3">
                              <div className="flex items-start justify-between gap-4">
                                <div className="space-y-1">
                                  <h4 className="font-black text-slate-900 dark:text-slate-100 text-sm flex items-center gap-1.5">
                                    {email.fullName}
                                    <Badge className="bg-indigo-50 dark:bg-slate-800 text-indigo-700 dark:text-violet-400 border-0 font-bold text-[9px] px-2 py-0.5">
                                      Simulated Dispatch
                                    </Badge>
                                  </h4>
                                  <div className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
                                    To: <span className="text-indigo-600 dark:text-indigo-400 font-bold">{email.to}</span>
                                  </div>
                                  <div className="text-[11px] text-slate-700 dark:text-slate-300 font-medium italic">
                                    Subject: {email.subject}
                                  </div>
                                </div>
                                <div className="text-right flex flex-col items-end gap-1.5">
                                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold">
                                    {new Date(email.dispatchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  <span className="text-[9px] text-slate-400 dark:text-slate-500 font-medium">
                                    {new Date(email.dispatchedAt).toLocaleDateString()}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedEmail(email);
                                    setShowEmailModal(true);
                                  }}
                                  className="h-8 text-[11px] font-bold border-indigo-100 dark:border-slate-800 text-indigo-600 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 rounded-xl flex items-center gap-1"
                                >
                                  <Eye className="w-3.5 h-3.5" /> View HTML Invite
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={actionLoading === `email-${email.id}`}
                                  onClick={() => {
                                    setDeleteTargetId(`email-${email.id}`);
                                    setDeletePasswordInput("");
                                    setDeleteModalError(null);
                                  }}
                                  className="h-8 text-[11px] font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl flex items-center gap-1 px-3"
                                  title="Delete Email Log"
                                >
                                  <Trash2 className="w-3.5 h-3.5" /> Delete Log
                                </Button>
                              </div>
                            </div>
                          </Card>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ) ) : (
                    <div className="space-y-4">
                      {/* Candidate Search Bar */}
                      {(suitableCandidates.length > 0 || unsuitableCandidates.length > 0 || candidateSearch) && (
                        <div className="relative shrink-0">
                          <input
                            type="text"
                            placeholder={`Search ${activeTab === 'suitable' ? 'suitable' : 'unsuitable'} candidates...`}
                            value={candidateSearch}
                            onChange={(e) => setCandidateSearch(e.target.value)}
                            className="w-full rounded-xl border border-indigo-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 p-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-200"
                          />
                        </div>
                      )}

                      {candidatesToRender.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center py-24 text-center space-y-2 bg-white dark:bg-slate-900/60 border border-indigo-50 dark:border-slate-800 rounded-2xl">
                          <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-500">
                            <HelpCircle className="w-6 h-6" />
                          </div>
                          <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm">No Candidates Found</h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed">
                            {candidateSearch 
                              ? "No candidates match your search filter."
                              : (activeTab === "suitable"
                                  ? "No CVs match the job criteria yet. Review the Job Description or check unsuitable candidates."
                                  : "No candidates classified as non-suitable yet.")
                            }
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-indigo-50 dark:border-slate-800 shrink-0">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={candidatesToRender.length > 0 && candidatesToRender.every(c => selectedResumeIds.includes(c.id))}
                          onChange={handleToggleAllResumes}
                          className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700 cursor-pointer"
                        />
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                          {selectedResumeIds.length > 0
                            ? `${selectedResumeIds.length} of ${candidatesToRender.length} selected`
                            : `Select All Candidates`
                          }
                        </span>
                      </div>
                      {selectedResumeIds.length > 0 && (
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={actionLoading === "bulk-resumes"}
                          onClick={handleBulkDeleteResumes}
                          className="h-8 text-xs font-bold rounded-xl flex items-center gap-1.5 px-3 bg-red-650 hover:bg-red-750 text-white"
                        >
                          {actionLoading === "bulk-resumes" ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Deleting...
                            </>
                          ) : (
                            <>
                              <Trash2 className="w-3.5 h-3.5" /> Delete Selected
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                    <div className="space-y-4 max-h-[550px] overflow-y-auto pr-1">
                      {candidatesToRender.map((row) => {
                      const isInterviewComplete = row.isConcluded || (row.interview_attempts && row.interview_attempts.length > 0);
                      const hasVideoRecording = !!row.report?.videoUrl;

                      return (
                        <Card 
                          key={row.id} 
                          className={`p-5 border-indigo-50 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-indigo-300 dark:hover:border-slate-700 hover:shadow-soft transition-all duration-300 flex items-start gap-4 ${
                            selectedResumeIds.includes(row.id) ? "border-indigo-400 dark:border-indigo-800 bg-indigo-50/10 dark:bg-indigo-950/10" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedResumeIds.includes(row.id)}
                            onChange={() => handleToggleResumeSelect(row.id)}
                            className="mt-1.5 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700 cursor-pointer"
                          />
                          <div className="flex-1 flex flex-col space-y-4">
                            {/* Top Row: Info & Scores */}
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <h3 className="font-black text-slate-900 dark:text-slate-100 text-sm flex flex-wrap items-center gap-1.5">
                                   {row.parsed?.personal?.fullName || row.filename || "Candidate"}
                                   {row.report?.proctoring?.autoSubmitted && (
                                     <Badge className="bg-red-50 dark:bg-rose-950/20 text-red-650 dark:text-red-400 border border-red-100 dark:border-red-900/50 font-black text-[9px] px-2 py-0">
                                       🚨 AUTO-SUBMITTED
                                     </Badge>
                                   )}
                                   {!row.report?.proctoring?.autoSubmitted && (row.report?.proctoring?.warningCount ?? 0) > 0 && (
                                     <Badge className="bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 border border-amber-100 dark:border-amber-900/50 font-black text-[9px] px-2 py-0">
                                       ⚠️ WARNING: {row.report.proctoring.warningCount}/3
                                     </Badge>
                                   )}
                                   {hasVideoRecording && (
                                     <Badge className="bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/50 font-black text-[9px] px-2 py-0 flex items-center gap-1 hover:bg-rose-100/50">
                                       <Video className="w-3 h-3 text-rose-500" /> RECORDING
                                     </Badge>
                                   )}
                                   {row.reset && (
                                     <Badge className="bg-amber-100 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 border-0 font-bold text-[9px] px-2 py-0 ml-2">
                                       Test Reset
                                     </Badge>
                                   )}
                                   {emails.some(e => e.to === (row.parsed?.personal?.email || "")) && (
                                     <Badge className="bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border-0 font-bold text-[9px] px-2 py-0.5 ml-2">
                                       Mail Sent
                                     </Badge>
                                   )}
                                 </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold break-all mt-0.5">
                                  {row.parsed?.personal?.email || "No email provided"}
                                </p>
                                {/* If this candidate was reset, show a subtle note */}
                                {row.reset && (
                                  <p className="text-xs text-amber-600 dark:text-amber-300 font-semibold mt-1">
                                    Test session has been reset.
                                  </p>
                                )}
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mt-1 flex items-center flex-wrap gap-1">
                                  <span>File: {row.filename} | Submitted: {new Date(row.createdAt).toLocaleDateString()}</span>
                                  {(() => {
                                    const assoc = jds.find(j => j.id === resolveJdId(row.report?.jdId));
                                    if (assoc && assoc.fileName && assoc.fileName.includes(" | ")) {
                                      const brNo = assoc.fileName.split(" | ")[0];
                                      return (
                                        <span className="ml-1 bg-indigo-50 dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded font-black text-[9px] uppercase tracking-wider inline-block">
                                          Req: {brNo}
                                        </span>
                                      );
                                    }
                                    return null;
                                  })()}
                                </p>

                                {/* Dynamic skills match list */}
                                {(() => {
                                  if (selectedJdId && selectedJdId !== "all" && jdSavedText) {
                                    const matchInfo = calculateCandidateMatch(row, jdSavedText);
                                    if (matchInfo.matchingSkills.length > 0) {
                                      return (
                                        <div className="flex flex-wrap gap-1 mt-2">
                                          {matchInfo.matchingSkills.slice(0, 5).map(s => (
                                            <Badge key={s} className="bg-indigo-50 border-0 text-indigo-700 text-[9px] px-1.5 py-0 font-bold">
                                              {s}
                                            </Badge>
                                          ))}
                                          {matchInfo.matchingSkills.length > 5 && (
                                            <span className="text-[9px] text-slate-400 font-bold">+{matchInfo.matchingSkills.length - 5} more</span>
                                          )}
                                        </div>
                                      );
                                    }
                                  }
                                  return null;
                                })()}
                              </div>

                              {/* Match score Badge */}
                              <div className="text-right">
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-black block mb-1">
                                  JD Match
                                </span>
                                {(() => {
                                  const score = getScore(row);
                                  return (
                                    <Badge className={`border-0 font-extrabold text-xs px-3 py-1 ${
                                      score >= 40
                                        ? "bg-emerald-100 dark:bg-emerald-950/35 text-emerald-800 dark:text-emerald-300"
                                        : "bg-amber-100 dark:bg-amber-955/35 text-amber-855 dark:text-amber-300"
                                    }`}>
                                      {score}%
                                    </Badge>
                                  );
                                })()}
                              </div>
                            </div>

                            {/* Middle Row: Rationale Quote */}
                            <div className="bg-slate-50/50 dark:bg-slate-950/50 border border-indigo-50/50 dark:border-slate-800/80 rounded-2xl p-4 text-xs text-slate-600 dark:text-slate-300 font-medium leading-relaxed">
                              <strong className="text-slate-800 dark:text-slate-200">Rationale:</strong> {
                                selectedJdId && selectedJdId !== "all" && jdSavedText
                                  ? `Matches profile requirements. Found ${calculateCandidateMatch(row, jdSavedText).matchingSkills.length} overlapping technical skills.`
                                  : (row.report?.jdMatchRationale || "Matches profile requirements.")
                              }
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                              
                              {/* Interview completion badge */}
                              <div className="flex flex-wrap gap-2 items-center">
                                {isInterviewComplete ? (
                                  <Badge className="bg-emerald-500 text-white font-bold shadow-sm shadow-emerald-500/25">
                                    Interview Completed ({row.interview_attempts.length})
                                  </Badge>
                                ) : (
                                  <Badge className="bg-red-500 text-white border-0 font-bold shadow-sm shadow-red-500/25">
                                    Interview Pending
                                  </Badge>
                                )}
                                {row.report?.proctoring?.autoSubmitted && (
                                  <Badge className="bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/40 font-bold text-xs shadow-sm">
                                    🚨 Auto-Submitted (Integrity Lock)
                                  </Badge>
                                )}
                                {!row.report?.proctoring?.autoSubmitted && (row.report?.proctoring?.warningCount ?? 0) > 0 && (
                                  <Badge className="bg-amber-100 dark:bg-amber-955/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/40 font-bold text-xs shadow-sm">
                                    ⚠️ {row.report.proctoring.warningCount} Warnings
                                  </Badge>
                                )}
                              </div>

                              {/* Action Buttons */}
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleShowDetails(row)}
                                  className="h-8 text-[11px] font-bold border-indigo-100 text-indigo-600 hover:bg-indigo-50 rounded-xl"
                                >
                                  <Eye className="w-3 h-3 mr-1" /> Details
                                </Button>

                                {getSuitability(row) === "suitable" && (
                                  <Button
                                    size="sm"
                                    disabled={actionLoading === row.id || isInterviewComplete}
                                    onClick={() => handleSendInvite(row)}
                                    className="h-8 text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center gap-1 shadow-sm transition-all"
                                  >
                                    {actionLoading === row.id ? (
                                      <>
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Dispatching...
                                      </>
                                    ) : (
                                      <>
                                        <Mail className="w-3.5 h-3.5" /> Send Invite Mail
                                      </>
                                    )}
                                  </Button>
                                )}

                                {isInterviewComplete && (
                                  <Link href={`/admin/resumes/${row.id}`}>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 text-[11px] font-bold border-indigo-100 text-indigo-600 hover:bg-indigo-50 rounded-xl"
                                    >
                                      <ClipboardList className="w-3 h-3 mr-1" /> Review Answers
                                    </Button>
                                  </Link>
                                )}

                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={actionLoading === row.id}
                                  onClick={() => handleOverrideSuitability(row.id, getSuitability(row))}
                                  className="h-8 text-[11px] font-bold border-indigo-100 text-indigo-600 hover:bg-indigo-50 rounded-xl"
                                >
                                  {getSuitability(row) === "suitable" ? "Mark Unsuitable" : "Mark Suitable"}
                                </Button>

                                {isInterviewComplete && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={actionLoading === row.id}
                                    onClick={() => handleResetSessionClick(row)}
                                    className="h-8 text-[11px] font-bold border-amber-200 text-amber-700 hover:bg-amber-50 rounded-xl"
                                  >
                                    <RefreshCcw className="w-3 h-3 mr-1" /> Reset Test
                                  </Button>
                                )}

                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleDownloadCV(row.id, row.filename)}
                                  className="h-8 px-2 border-indigo-100 text-indigo-600 hover:bg-indigo-50 rounded-xl"
                                  title="Download CV"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </Button>

                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={actionLoading === row.id}
                                  onClick={() => handleDeleteRecordClick(row.id)}
                                  className="h-8 px-2 rounded-xl text-white hover:bg-red-700"
                                  title="Delete Candidate Record"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>

                            </div>
                          </div>
                        </Card>
                      );
                    })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>



        </div>

        {/* Reset Actions Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 items-start">
          {/* RESET CANDIDATE SESSION CARD */}
          <Card className="p-6 border-indigo-100 dark:border-slate-800 shadow-md bg-white dark:bg-slate-900 rounded-3xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-amber-500 to-orange-500" />
            
            <div className="mb-4">
              <Badge className="bg-amber-100 text-amber-700 border-0 font-extrabold uppercase tracking-wider text-[9px] px-2.5 py-0.5">
                Reset Candidate Session
              </Badge>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                  Candidate Email Address
                </label>
                <p className="text-[10px] text-slate-500 font-semibold leading-normal">
                  Enter the candidate's email to reset their interview progress and allow them to take the evaluation again.
                </p>
                <input
                  type="email"
                  placeholder="e.g. candidate@domain.com"
                  value={resetEmailInput}
                  onChange={(e) => setResetEmailInput(e.target.value)}
                  className="w-full rounded-xl border border-indigo-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 px-3 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>

              <Button
                onClick={handleResetEmailSessionClick}
                disabled={isResettingEmail || !resetEmailInput.trim()}
                className="w-full h-10 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white rounded-xl font-bold shadow-md shadow-orange-500/20 flex items-center justify-center gap-2 text-xs"
              >
                {isResettingEmail ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Resetting Session…
                  </>
                ) : (
                  "Reset Test Session"
                )}
              </Button>
            </div>
          </Card>

          {/* SESSION RESET ACTIVITY LOG CARD */}
          <Card className="p-6 border-indigo-100 dark:border-slate-800 shadow-md bg-white dark:bg-slate-900 rounded-3xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-orange-500 to-red-500" />
            
            <div className="flex justify-between items-center mb-4">
              <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-0 font-extrabold uppercase tracking-wider text-[9px] px-2.5 py-0.5">
                Reset Activity Log
              </Badge>
              {resetLogs.length > 0 && (
                <Button
                  variant="ghost"
                  onClick={() => setShowClearLogsModal(true)}
                  className="h-7 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-955/20 rounded-lg px-2 font-bold"
                >
                  Clear History
                </Button>
              )}
            </div>

            {isLogsLoading ? (
              <div className="flex justify-center items-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
              </div>
            ) : resetLogs.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                <p className="text-xs text-slate-500 font-semibold">No reset activity logged yet.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                {resetLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 rounded-xl space-y-1.5 hover:border-slate-200 dark:hover:border-slate-700 transition-all duration-200"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100 break-all select-all">
                        {log.candidateEmail}
                      </span>
                      <Badge
                        className={`border-0 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 flex-shrink-0 ${
                          log.source === "Reset Form"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                            : "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
                        }`}
                      >
                        {log.source}
                      </Badge>
                    </div>
                    
                    <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 font-semibold">
                      <span>
                        By: <span className="text-indigo-600 dark:text-indigo-400">{log.resetBy}</span>
                      </span>
                      <span className="text-slate-400 dark:text-slate-550">
                        {new Date(log.createdAt).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* PORTAL TAB CONFIGURATION CARD */}
          <Card className="p-6 border-indigo-100 dark:border-slate-800 shadow-md bg-white dark:bg-slate-900 rounded-3xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-violet-500 to-indigo-500" />
            
            <div className="mb-4">
              <Badge className="bg-violet-100 text-violet-750 dark:bg-indigo-950/60 dark:text-indigo-300 border-0 font-extrabold uppercase tracking-wider text-[9px] px-2.5 py-0.5">
                Employee Portal Tabs Configuration
              </Badge>
            </div>

            <div className="space-y-4">
              <p className="text-[10px] text-slate-500 font-semibold leading-normal">
                Enable or disable dynamic feature tabs ("Effectiveness" and "Manager Console") in the Employee Learning Portal header.
              </p>

              <div className="pt-2">
                <div className="flex items-center justify-between p-3 border border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30 rounded-2xl">
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100">Portal Tabs Visibility</div>
                    <div className="text-[9px] text-slate-400 font-medium">Toggle Effectiveness & Manager Console</div>
                  </div>
                  <Button
                    onClick={() => handleTogglePortalSetting("portalFeaturesEnabled")}
                    disabled={isUpdatingSettings}
                    size="sm"
                    className={`h-7 px-3 text-[10px] font-black rounded-xl border ${
                      portalSettings.portalFeaturesEnabled
                        ? "bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-500"
                        : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-500 border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    {portalSettings.portalFeaturesEnabled ? "ENABLED" : "DISABLED"}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* System Logs Section */}
        <Card className="p-6 border-indigo-150 dark:border-slate-800 shadow-md bg-white dark:bg-slate-900 rounded-3xl relative overflow-hidden mt-8">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500" />
          
          <div className="space-y-4">
            {/* Header/Actions row */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2 border-b border-indigo-50 dark:border-slate-800 shrink-0">
              <div>
                <h3 className="text-sm font-black text-slate-855 dark:text-slate-100 leading-none">System Logs & Ingestion Pipeline Viewer</h3>
                <p className="text-[10px] text-slate-400 font-semibold mt-1">Real-time automated logging and folder synchronization audits</p>
              </div>
              
              <div className="flex gap-2">
                <Button
                  onClick={handleDownloadSystemLogs}
                  variant="outline"
                  size="sm"
                  className="rounded-xl border-indigo-100 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 gap-1.5 font-bold text-[10px] h-8"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Logs
                </Button>
                <Button
                  onClick={handleClearSystemLogs}
                  variant="outline"
                  size="sm"
                  className="rounded-xl border-rose-100 dark:border-slate-800 text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-850 gap-1.5 font-bold text-[10px] h-8"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear Logs
                </Button>
              </div>
            </div>

            {/* Filters Row */}
            <div className="flex flex-col sm:flex-row gap-3 items-center shrink-0">
              <div className="w-full sm:flex-1 relative">
                <input
                  type="text"
                  placeholder="Search log activity & details..."
                  value={logsSearch}
                  onChange={(e) => setLogsSearch(e.target.value)}
                  className="w-full rounded-xl border border-indigo-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 p-2 text-xs font-semibold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>
              
              <div className="flex gap-3 w-full sm:w-auto">
                <select
                  value={logsModuleFilter}
                  onChange={(e) => setLogsModuleFilter(e.target.value)}
                  className="flex-1 sm:flex-none rounded-xl border border-indigo-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="all">📂 All Modules</option>
                  <option value="candidate-processing">📄 Candidates</option>
                  <option value="requirements">💼 Requirements</option>
                  <option value="employee">👥 Employee Pool</option>
                  <option value="interview">📝 Interviews Sync</option>
                  <option value="email">✉️ Emails outbox</option>
                  <option value="error">⚠️ System Errors</option>
                </select>

                <select
                  value={logsStatusFilter}
                  onChange={(e) => setLogsStatusFilter(e.target.value)}
                  className="flex-1 sm:flex-none rounded-xl border border-indigo-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="all">🔄 All Statuses</option>
                  <option value="success">✅ Success</option>
                  <option value="failed">❌ Failed</option>
                  <option value="warning">⚠️ Warning</option>
                </select>
              </div>
            </div>

            {/* Log Terminal Screen */}
            <div className="rounded-2xl border border-slate-900 bg-slate-950 text-slate-300 p-4 font-mono text-[10px] leading-relaxed shadow-inner flex flex-col">
              {isSystemLogsLoading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Loader2 className="w-7 h-7 animate-spin text-indigo-400" />
                  <span className="text-slate-500 font-bold">Querying log stream...</span>
                </div>
              ) : systemLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500 font-semibold">
                  <span>No pipeline log entries matching current criteria.</span>
                </div>
              ) : (
                <div className="overflow-y-auto max-h-[350px] space-y-2 pr-1 scrollbar-thin scrollbar-thumb-slate-800">
                  {systemLogs.map((log, idx) => {
                    const isError = log.status.toLowerCase() === 'failed' || log.status.toLowerCase() === 'error';
                    const isWarning = log.status.toLowerCase() === 'warning';

                    return (
                      <div key={idx} className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-900/60 pb-1.5 last:border-0 last:pb-0 gap-1.5 sm:gap-4 hover:bg-slate-900/20 px-1 py-0.5 rounded transition-all">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-slate-650 font-bold shrink-0">
                            [{new Date(log.timestamp).toLocaleString()}]
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider shrink-0 ${
                            isError ? "bg-red-955/65 text-red-400 border border-red-900/50" :
                            isWarning ? "bg-amber-955/65 text-amber-400 border border-amber-900/50" :
                            "bg-slate-900 text-slate-400 border border-slate-800/80"
                          }`}>
                            {log.module}
                          </span>
                          <span className="text-slate-200 font-black shrink-0">
                            {log.action}
                          </span>
                          <span className={`shrink-0 ${
                            isError ? "text-rose-500 font-extrabold" :
                            isWarning ? "text-amber-500 font-extrabold" :
                            "text-emerald-500"
                          }`}>
                            {isError ? "[FAILED]" : isWarning ? "[WARNING]" : "[SUCCESS]"}
                          </span>
                          <span className="text-slate-450 whitespace-pre-wrap break-all">
                            {log.details}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </Card>
      </main>

      {showDetails && selectedResume && (
        <AdminResumeDetails
          data={selectedResume}
          onClose={() => {
            setShowDetails(false);
            setSelectedResume(null);
          }}
        />
      )}

      {showEmailModal && selectedEmail && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <Card className="w-full max-w-2xl bg-slate-50 border border-indigo-150 shadow-2xl rounded-3xl overflow-hidden animate-scale-up">
            {/* Header window control style */}
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-white" />
                <span className="font-bold text-sm tracking-wide truncate max-w-md">
                  {selectedEmail.subject}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowEmailModal(false);
                  setSelectedEmail(null);
                }}
                className="h-8 w-8 p-0 text-white/80 hover:text-white hover:bg-white/10 rounded-xl"
              >
                ✕
              </Button>
            </div>

            {/* Email Meta Details */}
            <div className="bg-white dark:bg-slate-900 border-b border-indigo-50 dark:border-slate-800 px-6 py-4 space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1">
                <div>
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] w-12 inline-block">From:</span>
                  <span className="text-slate-800 dark:text-slate-200 font-semibold">BizX HR Team</span>
                  <span className="text-slate-400 font-medium ml-1">&lt;noreply@bizx.io&gt;</span>
                </div>
                <div className="text-slate-400 font-semibold text-[11px]">
                  {new Date(selectedEmail.dispatchedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </div>
              </div>
              <div>
                <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] w-12 inline-block">To:</span>
                <span className="text-slate-800 dark:text-slate-200 font-bold">{selectedEmail.fullName}</span>
                <span className="text-indigo-600 dark:text-indigo-400 font-semibold ml-1.5">&lt;{selectedEmail.to}&gt;</span>
              </div>
              <div>
                <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] w-12 inline-block">Subject:</span>
                <span className="text-slate-800 dark:text-slate-200 font-semibold">{selectedEmail.subject}</span>
              </div>
            </div>

            {/* Email Body Content */}
            <div className="p-6 bg-slate-100 dark:bg-slate-950 flex flex-col">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-inner max-h-[50vh] overflow-y-auto">
                <div 
                  className="p-6 overflow-y-auto text-slate-800 dark:text-slate-100"
                  dangerouslySetInnerHTML={{ __html: selectedEmail.htmlBody }}
                />
              </div>
            </div>

            {/* Modal Actions Footer */}
            <div className="bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 px-6 py-4 flex justify-end">
              <Button
                onClick={() => {
                  setShowEmailModal(false);
                  setSelectedEmail(null);
                }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md shadow-indigo-500/20"
              >
                Close Preview
              </Button>
            </div>
          </Card>
        </div>
      )}

      {deleteTargetId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in text-slate-900 dark:text-slate-100">
          <Card className="w-full max-w-md bg-white dark:bg-slate-900 border border-indigo-150 dark:border-slate-800 shadow-2xl rounded-3xl overflow-hidden animate-scale-up">
            <div className="bg-gradient-to-r from-red-600 to-rose-600 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-white" />
                <span className="font-bold text-sm tracking-wide">
                  {deleteTargetId === "bulk" ? "Delete Selected Records" : 
                   deleteTargetId === "bulk-emails" ? "Delete Selected Email Logs" :
                   deleteTargetId === "bulk-employees-pool" ? "Delete Selected Employees" :
                   deleteTargetId === "clear-outbox" ? "Clear Email Outbox" :
                   deleteTargetId.startsWith("email-") ? "Delete Email Log" : 
                   deleteTargetId.startsWith("emp-") ? "Delete Employee Record" : "Delete Candidate Record"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDeleteTargetId(null)}
                className="text-white/80 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold leading-relaxed">
                {deleteTargetId === "bulk"
                  ? `This action is permanent and will delete the ${selectedResumeIds.length} selected candidate resume analyses, test answers, and active sessions.`
                  : deleteTargetId === "bulk-emails"
                  ? `This action is permanent and will delete the ${selectedEmailIds.length} selected simulated invitation email outbox logs.`
                  : deleteTargetId === "bulk-employees-pool"
                  ? `This action is permanent and will delete the ${selectedEmployeeIds.length} selected corporate pool employee records.`
                  : deleteTargetId === "clear-outbox"
                  ? "This action is permanent and will clear all simulated invitation email logs from the outbox."
                  : deleteTargetId.startsWith("email-")
                  ? "This action is permanent and will delete this simulated invitation email log."
                  : deleteTargetId.startsWith("emp-")
                  ? "This action is permanent and will delete the employee record from the corporate pool database."
                  : "This action is permanent and will delete the candidate's resume analysis, test answers, and active session."}
                {" "}Please enter the supervisor password to authorize this action:
              </p>

              <div className="space-y-1">
                <input
                  type="password"
                  value={deletePasswordInput}
                  onChange={(e) => setDeletePasswordInput(e.target.value)}
                  placeholder="Enter supervisor password"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 p-3 text-xs font-bold text-slate-850 dark:text-slate-100 outline-none focus:ring-2 focus:ring-rose-400/50"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleConfirmDelete();
                    }
                  }}
                />
                {deleteModalError && (
                  <p className="text-[10px] text-red-500 font-bold mt-1.5 flex items-center gap-1">
                    ⚠️ {deleteModalError}
                  </p>
                )}
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950/20 border-t border-slate-100 dark:border-slate-800 px-6 py-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setDeleteTargetId(null)}
                className="rounded-xl font-bold text-xs"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmDelete}
                className="bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold shadow-md shadow-red-500/20 text-xs"
              >
                Confirm Delete
              </Button>
            </div>
          </Card>
        </div>
      )}

      {showClearLogsModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in text-slate-900 dark:text-slate-100">
          <Card className="w-full max-w-md bg-white dark:bg-slate-900 border border-indigo-150 dark:border-slate-800 shadow-2xl rounded-3xl overflow-hidden animate-scale-up">
            <div className="bg-gradient-to-r from-red-500 to-rose-600 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-white" />
                <span className="font-bold text-sm tracking-wide">Clear Reset Activity Log</span>
              </div>
              <button
                type="button"
                onClick={() => setShowClearLogsModal(false)}
                className="text-white/80 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-605 dark:text-slate-300 leading-relaxed font-semibold">
                Are you sure you want to clear the reset log activity history? This action is permanent and cannot be undone.
              </p>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950/20 border-t border-slate-100 dark:border-slate-800 px-6 py-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setShowClearLogsModal(false)}
                className="rounded-xl font-bold text-xs"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmClearLogs}
                className="bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold shadow-md shadow-red-500/20 text-xs"
              >
                Clear History
              </Button>
            </div>
          </Card>
        </div>
      )}

      {resetTargetResume && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in text-slate-900 dark:text-slate-100">
          <Card className="w-full max-w-md bg-white dark:bg-slate-900 border border-indigo-150 dark:border-slate-800 shadow-2xl rounded-3xl overflow-hidden animate-scale-up">
            <div className="bg-gradient-to-r from-amber-500 to-orange-600 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RefreshCcw className="w-5 h-5 text-white" />
                <span className="font-bold text-sm tracking-wide">Reset Candidate Session</span>
              </div>
              <button
                type="button"
                onClick={() => setResetTargetResume(null)}
                className="text-white/80 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-605 dark:text-slate-300 leading-relaxed font-semibold">
                Are you sure you want to reset the assessment session for candidate <span className="text-indigo-600 dark:text-violet-400 font-bold">{resetTargetResume.parsed?.personal?.email || resetTargetResume.filename || "selected candidate"}</span>? 
                This will delete all their recorded interview attempts and permit them to log in to re-attempt the test.
              </p>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950/20 border-t border-slate-100 dark:border-slate-800 px-6 py-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setResetTargetResume(null)}
                className="rounded-xl font-bold text-xs"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmReset}
                className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold shadow-md shadow-amber-500/20 text-xs"
              >
                Confirm Reset
              </Button>
            </div>
          </Card>
        </div>
      )}

      {resetEmailTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in text-slate-900 dark:text-slate-100">
          <Card className="w-full max-w-md bg-white dark:bg-slate-900 border border-indigo-150 dark:border-slate-800 shadow-2xl rounded-3xl overflow-hidden animate-scale-up">
            <div className="bg-gradient-to-r from-amber-500 to-orange-600 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RefreshCcw className="w-5 h-5 text-white" />
                <span className="font-bold text-sm tracking-wide">Reset Candidate Session</span>
              </div>
              <button
                type="button"
                onClick={() => setResetEmailTarget(null)}
                className="text-white/80 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-605 dark:text-slate-300 leading-relaxed font-semibold">
                Are you sure you want to reset the assessment session for candidate <span className="text-indigo-650 dark:text-violet-400 font-bold">{resetEmailTarget}</span>? 
                This will delete all their recorded interview attempts and permit them to log in to re-attempt the test.
              </p>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950/20 border-t border-slate-100 dark:border-slate-800 px-6 py-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setResetEmailTarget(null)}
                className="rounded-xl font-bold text-xs"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmEmailReset}
                className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold shadow-md shadow-amber-500/20 text-xs"
              >
                Confirm Reset
              </Button>
            </div>
          </Card>
        </div>
      )}

      {activeEmployee && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in text-slate-900 dark:text-slate-100">
          <Card className="w-full max-w-lg bg-white dark:bg-slate-900 border border-indigo-150 shadow-2xl rounded-3xl overflow-hidden animate-scale-up">
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-6 py-4 flex items-center justify-between">
              <span className="font-bold text-sm tracking-wide">Employee Details</span>
              <button
                type="button"
                onClick={() => setActiveEmployee(null)}
                className="text-white/80 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 border-b border-indigo-50 dark:border-slate-800 pb-4">
                <div className="h-12 w-12 rounded-full bg-indigo-100 dark:bg-slate-800 flex items-center justify-center text-indigo-700 dark:text-violet-400 font-black text-lg">
                  {activeEmployee.full_name?.charAt(0) || "E"}
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-850 dark:text-slate-100">{activeEmployee.full_name}</h3>
                  <p className="text-xs text-slate-400 font-semibold">{activeEmployee.designation || "No Designation"}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block mb-0.5">Employee ID</span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">{activeEmployee.employee_id}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block mb-0.5">Department</span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">{activeEmployee.department || "N/A"}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block mb-0.5">Email</span>
                  <span className="font-bold text-slate-700 dark:text-slate-200 break-all">{activeEmployee.email || "N/A"}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block mb-0.5">Grade</span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">{activeEmployee.grade || "N/A"}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block mb-0.5">Status</span>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-black tracking-wider uppercase border-0 ${
                    activeEmployee.status?.toLowerCase() === 'active' || activeEmployee.status?.toLowerCase() === 'available' || activeEmployee.status?.toLowerCase() === 'deployed'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}>
                    {activeEmployee.status || "N/A"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block mb-0.5">Skill Match Score</span>
                  <span className={`font-black text-sm ${
                    activeEmployee.score >= 70 ? 'text-emerald-600 dark:text-emerald-400' : (activeEmployee.score >= 40 ? 'text-amber-500' : 'text-rose-500')
                  }`}>
                    {activeEmployee.score || 0}%
                  </span>
                </div>
              </div>

              <div className="space-y-1.5 pt-2">
                <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block">All Skills</span>
                <div className="p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800 rounded-xl max-h-[80px] overflow-y-auto">
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">{activeEmployee.skills || "None listed"}</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block">Matching Skills against JD</span>
                <div className="flex flex-wrap gap-1">
                  {activeEmployee.matchingSkills && activeEmployee.matchingSkills.length > 0 ? (
                    activeEmployee.matchingSkills.map((s: string) => (
                      <Badge key={s} className="bg-indigo-50 border-0 text-indigo-700 text-[10px] px-2 py-0.5">
                        {s}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-slate-400 text-xs font-semibold">No skills matched against the selected Job Description.</span>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setActiveEmployee(null)}
                  className="rounded-xl font-bold text-xs"
                >
                  Close
                </Button>
                <Button
                  type="button"
                  onClick={async () => {
                    await handleShortlistEmployee(activeEmployee.employee_id);
                    setActiveEmployee((prev: any) => prev ? { ...prev, shortlisted: !prev.shortlisted } : null);
                  }}
                  className={`rounded-xl px-5 font-bold text-xs ${
                    activeEmployee.shortlisted
                      ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-500/20'
                      : 'bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-indigo-500/25'
                  }`}
                >
                  {activeEmployee.shortlisted ? "Deselect" : "Shortlist"}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {undoStack.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[90] transition-all duration-300 transform scale-100">
          <div className="bg-slate-950/90 dark:bg-slate-900/90 backdrop-blur-md text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-indigo-500/20">
            <span className="text-xs font-semibold text-slate-300">Action logged.</span>
            <button
              onClick={handleUndo}
              className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1 transition-all duration-150 shadow-md shadow-indigo-500/20"
            >
              <RefreshCcw className="w-3.5 h-3.5 animate-spin-reverse" /> Undo Last Action ({undoStack.length})
            </button>
          </div>
        </div>
      )}

      {showUploadModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in text-slate-900 dark:text-slate-100 animate-fade-in">
          <Card className="w-full max-w-lg bg-white dark:bg-slate-900 border border-indigo-150 shadow-2xl rounded-3xl overflow-hidden animate-scale-up">
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-6 py-4 flex items-center justify-between">
              <span className="font-bold text-sm tracking-wide">Upload Job Description</span>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="text-white/80 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleModalUploadSubmit} className="p-6 space-y-4">
              <div className="flex border-b border-indigo-50 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalTab("file")}
                  className={`flex-1 pb-2 font-bold text-xs ${
                    modalTab === "file"
                      ? "border-b-2 border-indigo-600 text-indigo-700 dark:text-violet-400"
                      : "text-slate-400 hover:text-slate-500"
                  }`}
                >
                  Upload File
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab("paste")}
                  className={`flex-1 pb-2 font-bold text-xs ${
                    modalTab === "paste"
                      ? "border-b-2 border-indigo-600 text-indigo-700 dark:text-violet-400"
                      : "text-slate-400 hover:text-slate-500"
                  }`}
                >
                  Paste JD Text
                </button>
              </div>

              {modalTab === "file" ? (
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">JD File</label>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.txt"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setModalFile(e.target.files[0]);
                      }
                    }}
                    className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 dark:file:bg-slate-800 dark:file:text-slate-200"
                    required
                  />
                  <p className="text-[10px] text-slate-400 dark:text-slate-500">Accepts PDF, Word, or TXT (Max 10MB)</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">JD Text Content</label>
                  <textarea
                    rows={6}
                    value={modalJdText}
                    onChange={(e) => setModalJdText(e.target.value)}
                    placeholder="Paste job details (title, skills, experience...)"
                    className="w-full text-xs text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 border border-indigo-100 dark:border-slate-700 rounded-xl p-3 outline-none resize-none font-medium"
                    required
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  RM Mail tagged with the JD
                </label>
                <input
                  type="email"
                  value={modalRmEmail}
                  onChange={(e) => setModalRmEmail(e.target.value)}
                  placeholder="e.g. rm@infinite.com"
                  className="w-full rounded-xl border border-indigo-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-xs text-slate-900 dark:text-slate-100 focus:border-indigo-500 outline-none"
                  required
                />
              </div>

              {modalError && (
                <div className="p-3 text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-xl font-semibold">
                  {modalError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowUploadModal(false)}
                  className="rounded-xl font-bold text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={modalIsUploading}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-5 font-bold text-xs flex items-center gap-1.5"
                >
                  {modalIsUploading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...
                    </>
                  ) : (
                    "Save & Tag JD"
                  )}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {inviteTargetResume && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in text-slate-900 dark:text-slate-100">
          <Card className="w-full max-w-xl bg-white dark:bg-slate-900 border border-indigo-150 shadow-2xl rounded-3xl overflow-hidden animate-scale-up">
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-6 py-4 flex items-center justify-between">
              <span className="font-bold text-sm tracking-wide flex items-center gap-2">
                <Settings className="w-4 h-4" /> Assessment Settings: {inviteTargetResume?.parsed?.personal?.fullName || "Candidate"}
              </span>
              <button
                type="button"
                onClick={() => setInviteTargetResume(null)}
                className="text-white/80 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Interview Focus Type */}
              <div className="space-y-2">
                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest">
                  Assessment Focus
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setInviteType("technical")}
                    className={`py-3 px-4 rounded-2xl border text-center font-bold text-xs transition-all flex flex-col items-center gap-1.5 ${
                      inviteType === "technical"
                        ? "border-indigo-600 bg-indigo-50/50 text-indigo-700 dark:bg-indigo-950/20 dark:text-violet-400"
                        : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span className="font-extrabold">Technical Assessment</span>
                    <span className="text-[10px] opacity-75 font-normal">Includes coding & IDE challenges</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setInviteType("non-technical")}
                    className={`py-3 px-4 rounded-2xl border text-center font-bold text-xs transition-all flex flex-col items-center gap-1.5 ${
                      inviteType === "non-technical"
                        ? "border-indigo-600 bg-indigo-50/50 text-indigo-700 dark:bg-indigo-950/20 dark:text-violet-400"
                        : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span className="font-extrabold">Non-Technical Focus</span>
                    <span className="text-[10px] opacity-75 font-normal">Behavioral & soft skills (No IDE)</span>
                  </button>
                </div>
              </div>

              {/* Dynamic Section Question Counts */}
              <div className="bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-850 rounded-2xl p-4 space-y-4">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">
                  Define Questions per Section
                </span>

                {inviteType === "technical" ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-350">
                        Overlapping (JD+CV)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={30}
                        value={countOverlapping}
                        onChange={(e) => setCountOverlapping(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-full rounded-xl border border-indigo-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-905 dark:text-slate-100 focus:border-indigo-500 outline-none font-bold"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-350">
                        JD Gaps Skill
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={30}
                        value={countGap}
                        onChange={(e) => setCountGap(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-full rounded-xl border border-indigo-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-905 dark:text-slate-100 focus:border-indigo-500 outline-none font-bold"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-350">
                        CV Projects Skill
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={30}
                        value={countProjects}
                        onChange={(e) => setCountProjects(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-full rounded-xl border border-indigo-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-905 dark:text-slate-100 focus:border-indigo-500 outline-none font-bold"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-350">
                        Coding Challenges (IDE)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        value={countCoding}
                        onChange={(e) => setCountCoding(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-full rounded-xl border border-indigo-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-905 dark:text-slate-100 focus:border-indigo-500 outline-none font-bold"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    <div className="flex items-center justify-between gap-4">
                      <label className="text-[11px] font-bold text-slate-700 dark:text-slate-350">
                        Behavioral Questions
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={30}
                        value={countBehavioral}
                        onChange={(e) => setCountBehavioral(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-[120px] rounded-xl border border-indigo-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-905 dark:text-slate-100 focus:border-indigo-500 outline-none font-bold"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <label className="text-[11px] font-bold text-slate-700 dark:text-slate-350">
                        Leadership & Collaboration
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={30}
                        value={countLeadership}
                        onChange={(e) => setCountLeadership(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-[120px] rounded-xl border border-indigo-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-905 dark:text-slate-100 focus:border-indigo-500 outline-none font-bold"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <label className="text-[11px] font-bold text-slate-700 dark:text-slate-350">
                        Problem Solving & Soft Skills
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={30}
                        value={countSoftSkills}
                        onChange={(e) => setCountSoftSkills(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-[120px] rounded-xl border border-indigo-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-905 dark:text-slate-100 focus:border-indigo-500 outline-none font-bold"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setInviteTargetResume(null)}
                  className="rounded-2xl font-bold text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleConfirmSendInvite}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl px-6 font-bold text-xs flex items-center gap-1.5 shadow-sm shadow-indigo-500/20"
                >
                  <Mail className="w-3.5 h-3.5" /> Dispatch Assessment Email
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {showDuplicateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in text-slate-900 dark:text-slate-100">
          <Card className="w-full max-w-lg bg-white dark:bg-slate-900 border border-indigo-150 shadow-2xl rounded-3xl overflow-hidden animate-scale-up">
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-6 py-4 flex items-center justify-between">
              <span className="font-bold text-sm tracking-wide">Duplicate Candidates Detected</span>
              <button
                type="button"
                onClick={handleCancelDuplicateModal}
                className="text-white/80 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 leading-relaxed">
                  The following candidate CVs have already been processed and screened. Choose whether you want to re-screen and replace them or keep the existing screening version:
                </p>
              </div>

              <div className="max-h-[200px] overflow-y-auto border border-slate-100 dark:border-slate-800 rounded-2xl p-2 bg-slate-50/50 dark:bg-slate-800/30 space-y-2 pr-1">
                {duplicateFiles.map((dup, idx) => (
                  <div key={dup.file.name} className="flex items-center justify-between p-3 bg-white dark:bg-slate-900 border border-indigo-50/50 dark:border-slate-800/50 rounded-xl hover:border-indigo-100 transition-colors">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate max-w-[280px]" title={dup.file.name}>
                      {dup.file.name}
                    </span>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={dup.replace}
                        onChange={(e) => {
                          setDuplicateFiles(prev => {
                            const copy = [...prev];
                            copy[idx] = { ...copy[idx], replace: e.target.checked };
                            return copy;
                          });
                        }}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700"
                      />
                      <span className="text-[11px] font-bold text-indigo-600 dark:text-violet-400">Replace</span>
                    </label>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleCancelDuplicateModal}
                  className="rounded-xl font-bold text-xs"
                >
                  Cancel Upload
                </Button>
                <Button
                  type="button"
                  onClick={handleConfirmDuplicateModal}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-5 font-bold text-xs"
                >
                  Confirm & Screen
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {showJdToBrModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in text-slate-900 dark:text-slate-100">
          <Card className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-indigo-150 dark:border-slate-800 shadow-2xl rounded-3xl overflow-hidden animate-scale-up">
            
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-white" />
                <span className="font-bold text-sm tracking-wide">Convert JD to BR</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowJdToBrModal(false);
                  setJdToBrFiles([]);
                  setExcelTemplate(null);
                  setJdCustomIds({});
                  resetJdToBrStatus();
                }}
                className="text-white/80 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            {/* Error Alert Display */}
            {errorMessage && (
              <div className="mx-6 mt-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 p-4 rounded-xl flex items-start gap-3 text-xs leading-relaxed">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="font-bold">Execution Error:</span> {errorMessage}
                </div>
                <button onClick={() => setErrorMessage(null)} className="text-rose-500 hover:text-rose-400">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <div className="p-6 md:p-8 space-y-6 max-h-[70vh] overflow-y-auto">
              
              {/* SECTION 1: UPLOAD JOB DESCRIPTIONS */}
              <section className="space-y-3">
                <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <span className="h-4 w-1 bg-indigo-500 rounded-full" />
                  Upload Job Descriptions
                </h2>
                
                {/* Dropzone */}
                <div 
                  onDragOver={handleJdToBrDrag}
                  onDrop={handleJdToBrDrop}
                  onClick={() => document.getElementById('jd-to-br-selector')?.click()}
                  className="border-2 border-dashed border-indigo-200 dark:border-slate-800 hover:border-indigo-500/60 dark:hover:border-violet-500/60 bg-slate-50/50 dark:bg-slate-950/40 hover:bg-indigo-50/10 dark:hover:bg-slate-900/10 rounded-2xl p-6 text-center cursor-pointer transition duration-300 relative group flex flex-col items-center justify-center gap-2"
                >
                  <input 
                    type="file" 
                    id="jd-to-br-selector" 
                    multiple 
                    accept=".docx,.pdf" 
                    className="hidden" 
                    onChange={handleJdToBrSelect}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <Upload className="h-8 w-8 text-indigo-500 group-hover:text-indigo-400 transition" />
                  <div>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Drag & Drop JDs or click to select</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Accepts Word (.docx) and PDF (.pdf) files</span>
                  </div>
                </div>

                {/* JD files listing */}
                {jdToBrFiles.length > 0 && (
                  <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                    {jdToBrFiles.map((file, idx) => (
                      <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-900/60 p-3 rounded-xl">
                        <div className="flex items-center gap-2 truncate text-slate-700 dark:text-slate-300 font-medium flex-1">
                          <FileText className="h-4 w-4 text-indigo-500 shrink-0" />
                          <span className="truncate max-w-[220px]">{file.name}</span>
                          <span className="text-[10px] text-slate-500 font-mono">({(file.size / 1024).toFixed(0)} KB)</span>
                        </div>
                        
                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                          <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 focus-within:border-indigo-500 bg-white dark:bg-slate-900/40 flex items-center w-[140px]">
                            <input
                              type="text"
                              placeholder="Auto Req ID"
                              value={jdCustomIds[file.name] || ''}
                              onChange={(e) => handleJdIdChange(file.name, e.target.value)}
                              className="w-full bg-transparent px-3 py-1.5 text-[11px] font-mono font-bold text-slate-700 dark:text-slate-200 focus:outline-none placeholder-slate-400 dark:placeholder-slate-600"
                            />
                          </div>
                          
                          <button 
                            onClick={() => removeJdToBrFile(idx)} 
                            className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-slate-400 hover:text-rose-500 rounded-lg cursor-pointer transition font-bold"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* SECTION 2: UPLOAD EXCEL TEMPLATE */}
              <section className="space-y-3">
                <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <span className="h-4 w-1 bg-indigo-500 rounded-full" />
                  Upload Excel Template
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2">
                    <input 
                      type="file" 
                      id="jd-to-br-excel-selector" 
                      accept=".xlsx" 
                      className="hidden" 
                      onChange={handleJdToBrExcelSelect}
                    />
                    <label 
                      htmlFor="jd-to-br-excel-selector"
                      className="flex items-center gap-3 border border-indigo-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 hover:bg-indigo-50/20 dark:hover:bg-slate-900/10 px-4 py-4 rounded-2xl cursor-pointer text-xs font-medium text-slate-700 dark:text-slate-300 hover:border-emerald-500/40 dark:hover:border-emerald-500/40 transition group"
                    >
                      <div className="h-9 w-9 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 group-hover:border-emerald-500/20 group-hover:bg-emerald-600/10 rounded-xl flex items-center justify-center transition">
                        <FileText className={`h-4.5 w-4.5 ${excelTemplate ? 'text-emerald-500' : 'text-slate-400'}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="block font-bold truncate">
                          {excelTemplate ? 'Replace Excel Template' : 'Choose Excel Template File'}
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 block truncate">
                          {excelTemplate ? excelTemplate.name : 'Select demand sheet template (.xlsx)'}
                        </span>
                      </div>
                    </label>
                  </div>

                  {/* Template Status Indicator */}
                  <div className="bg-slate-50 dark:bg-slate-950/80 border border-slate-100 dark:border-slate-900 rounded-2xl p-4 flex flex-col justify-center text-xs space-y-1">
                    <span className="text-slate-500 dark:text-slate-400 font-semibold block uppercase text-[9px] tracking-wider">Template Status</span>
                    <span className={`font-bold text-xs ${excelTemplate ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}`}>
                      {excelTemplate ? 'Ready to Append' : 'Missing File'}
                    </span>
                  </div>
                </div>
              </section>

              {/* SECTION 3: GENERATE & DOWNLOAD */}
              <section className="pt-4 border-t border-slate-100 dark:border-slate-850 space-y-4">
                
                {!downloadUrl ? (
                  <Button 
                    onClick={handleGenerateClick}
                    disabled={isProcessing || jdToBrFiles.length === 0 || !excelTemplate}
                    className="w-full h-12 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:from-slate-200 disabled:to-slate-200 disabled:dark:from-slate-800 disabled:dark:to-slate-800 text-white disabled:text-slate-400 disabled:dark:text-slate-500 font-bold rounded-2xl text-xs transition shadow-md shadow-indigo-500/10 flex items-center justify-center gap-2"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating spreadsheet...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Generate Updated Excel
                      </>
                    )}
                  </Button>
                ) : (
                  <div className="space-y-4 animate-fade-in">
                    {/* Success notification */}
                    <div className="bg-emerald-50 dark:bg-emerald-950/10 border border-emerald-100 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400 p-4.5 rounded-2xl flex items-start gap-3 text-xs leading-relaxed">
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500 mt-0.5" />
                      <div>
                        <span className="font-bold block text-slate-800 dark:text-slate-200">Generation Complete!</span>
                        <span>Extracted JD data rows have been mapped and successfully appended into the Excel template. styles, formatting, hidden sheets and borders have been fully preserved.</span>
                      </div>
                    </div>

                    {/* Download & Reset actions */}
                    <div className="flex flex-col sm:flex-row gap-3">
                      <a 
                        href={downloadUrl}
                        download={outputFilename}
                        className="flex-1 h-12 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-2xl text-xs transition shadow-lg shadow-emerald-500/15 flex items-center justify-center gap-2 active:scale-95 text-center"
                      >
                        <Download className="h-4 w-4" />
                        Download Updated Excel
                      </a>

                      <Button 
                        onClick={resetJdToBrStatus}
                        variant="ghost"
                        className="h-12 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-semibold px-6 rounded-2xl text-xs active:scale-95"
                      >
                        Start Over
                      </Button>
                    </div>
                  </div>
                )}

                {/* Loading Progress Text indicator */}
                {isProcessing && progressText && (
                  <div className="flex items-center justify-center gap-2 text-xs text-indigo-600 dark:text-violet-400 animate-pulse font-medium">
                    <span>{progressText}</span>
                  </div>
                )}
              </section>

            </div>
          </Card>
        </div>
      )}

      {/* Interactive Step-by-Step Auto Req ID Wizard Modal */}
      {isWizardOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md transition-all duration-300 text-slate-900 dark:text-slate-100">
          <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl space-y-6 animate-scale-up">
            
            {/* Close button */}
            <button 
              onClick={() => setIsWizardOpen(false)}
              className="absolute top-4 right-4 p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition cursor-pointer font-bold"
            >
              ✕
            </button>

            {/* Header & Step progress */}
            <div className="space-y-2 relative">
              <span className="text-[10px] font-bold text-indigo-500 dark:text-violet-400 uppercase tracking-widest block font-black">
                Auto Req ID Wizard
              </span>
              <h3 className="text-base font-black text-slate-800 dark:text-slate-100 flex items-center gap-2 tracking-tight">
                <span>Set ID for JD {wizardIndex + 1} of {jdToBrFiles.length}</span>
              </h3>
              
              {/* Progress visual bar */}
              <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-950 rounded-full overflow-hidden flex gap-0.5 mt-2">
                {jdToBrFiles.map((_, idx) => (
                  <div 
                    key={idx}
                    className={`h-full flex-1 transition-all duration-300 ${
                      idx === wizardIndex 
                        ? 'bg-indigo-600' 
                        : idx < wizardIndex 
                          ? 'bg-emerald-50' 
                          : 'bg-slate-200 dark:bg-slate-800'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* JD File details */}
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-150 dark:border-slate-900/60 rounded-2xl p-4 flex items-center gap-3">
              <div className="h-10 w-10 bg-indigo-50 dark:bg-violet-500/10 border border-indigo-100 dark:border-violet-500/20 rounded-xl flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-indigo-600 dark:text-violet-400" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold block uppercase tracking-wider">Current File</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block truncate">
                  {jdToBrFiles[wizardIndex]?.name}
                </span>
                <span className="text-[9px] text-slate-500 font-mono">
                  {jdToBrFiles[wizardIndex] ? (jdToBrFiles[wizardIndex].size / 1024).toFixed(0) : 0} KB
                </span>
              </div>
            </div>

            {/* Input box */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block">
                Enter Auto Req ID:
              </label>
              
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 focus-within:border-indigo-500 bg-white dark:bg-slate-950 flex items-center pr-4 shadow-sm">
                <input
                  key={wizardIndex}
                  type="text"
                  placeholder="e.g. 45091"
                  value={wizardTempIds[jdToBrFiles[wizardIndex]?.name] || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setWizardTempIds(prev => ({
                      ...prev,
                      [jdToBrFiles[wizardIndex].name]: val
                    }));
                  }}
                  autoFocus
                  className="w-full bg-transparent px-4 py-3 text-sm font-mono font-bold text-slate-800 dark:text-slate-100 focus:outline-none placeholder-slate-300 dark:placeholder-slate-700 tracking-wider"
                />
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-normal">
                Provide an Auto Req ID. Leave empty/skip to auto-generate sequentially from the Excel sheet's last value.
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              {wizardIndex > 0 && (
                <Button
                  type="button"
                  onClick={() => setWizardIndex(prev => prev - 1)}
                  variant="ghost"
                  className="flex-1 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-semibold py-3 rounded-xl text-xs"
                >
                  Back
                </Button>
              )}
              
              <Button
                type="button"
                onClick={() => {
                  setWizardTempIds(prev => {
                    const copy = { ...prev };
                    delete copy[jdToBrFiles[wizardIndex].name];
                    return copy;
                  });
                  handleWizardNext();
                }}
                variant="ghost"
                className="flex-1 text-slate-500 dark:text-slate-400 font-semibold py-3 rounded-xl text-xs"
              >
                Skip / Auto-gen
              </Button>

              <Button
                type="button"
                onClick={handleWizardNext}
                className="flex-1 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold py-3 rounded-xl text-xs shadow-md shadow-indigo-500/10"
              >
                {wizardIndex === jdToBrFiles.length - 1 ? 'Finish & Generate' : 'Next File'}
              </Button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
