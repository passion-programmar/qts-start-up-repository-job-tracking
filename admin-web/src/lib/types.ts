export type UserRole = 'super' | 'admin' | 'manager' | 'account' | 'caller';
export type PanelMode = 'admin' | 'manager' | 'account' | 'caller';

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
  accountId?: number | null;
}

export interface Account {
  id: number;
  name: string;
  notes?: string | null;
  is_active: boolean;
  manager_id?: number | null;
  manager_name?: string | null;
  custom_gpt_url?: string | null;
  account_count?: number;
  candidate_count?: number;
  created_at?: string;
}

export interface UserAccount {
  id: number;
  username: string;
  role: UserRole;
  account_id?: number | null;
  account_name?: string | null;
  is_active?: boolean;
  created_at?: string;
}

export interface InterviewProcess {
  id: number;
  candidate_id?: number | null;
  candidate_name: string;
  caller_user_id?: number | null;
  caller_username?: string | null;
  account_id?: number | null;
  account_name?: string | null;
  scheduled_date?: string | null;
  attend_date?: string | null;
  interview_time?: string | null;
  timezone: string;
  position?: string | null;
  company?: string | null;
  job_url?: string | null;
  resume?: string | null;
  meeting_url?: string | null;
  salary?: string | null;
  stage?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Candidate {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  notes?: string | null;
  color?: string | null;
  stack?: string | null;
  is_active: boolean;
  account_id?: number | null;
  account_name?: string | null;
  created_at?: string;
}

export interface JobSite {
  id: number;
  name: string;
  platform_key: string;
  url_host?: string | null;
  notes?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  admission_count?: number;
  job_count?: number;
  default_candidate_id?: number | null;
  default_candidate_name?: string | null;
}

export interface AccountJobSiteAdmission {
  id: number;
  name: string;
  platform_key: string;
  url_host?: string | null;
  default_candidate_id?: number | null;
  default_candidate_name?: string | null;
  admitted_at?: string;
  admission_active?: boolean;
}

export interface JobSiteAdmission {
  id: number;
  account_id: number;
  account_name: string;
  default_candidate_id?: number | null;
  default_candidate_name?: string | null;
  admitted_at?: string;
  is_active: boolean;
  admitted_by_username?: string | null;
}

export interface Job {
  id: number;
  title: string;
  company: string;
  url: string;
  description?: string;
  source?: string | null;
  account_id?: number | null;
  created_at?: string;
  updated_at?: string;
  applied_count?: number;
  candidateStatuses?: CandidateJobStatus[];
}

export interface CandidateJobStatus {
  candidate_id: number;
  name: string;
  status: 'none' | 'applied';
  applied_at?: string | null;
}

export interface JobStats {
  totalJobs: number;
  totalCandidates: number;
  activeCandidates: number;
  applications: number;
  bidSummary: { today: number; week: number; month: number };
  dailyBids: Array<{ label: string; count: number }>;
  weeklyBids: Array<{ label: string; count: number }>;
  monthlyBids: Array<{ label: string; count: number }>;
  recentApplications: Array<{
    job_id: number;
    job_title: string;
    company: string;
    candidate_name: string;
    applied_at: string | null;
  }>;
  jobsOverview: Array<{
    id: number;
    title: string;
    company: string;
    url: string;
    created_at: string;
    appliedCandidates: Array<{ name: string; applied_at: string }>;
  }>;
}
