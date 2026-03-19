export type LeadStage = 'New' | 'Contacted' | 'Qualified' | 'Meeting done' | 'Proposal shared' | 'Interested' | 'Delayed' | 'Won' | 'Lost';
export type LeadSource = 'Instagram' | 'Website' | 'Referral' | 'Cold Call' | 'LinkedIn' | 'Other';
export type LeadTemperature = 'Cold' | 'Warm' | 'Hot' | 'Very Hot' | 'Delayed' | 'Not interested';
export type BudgetBucket = 'Low' | 'Medium' | 'High' | 'Enterprise';
export type ActivityType = 'call' | 'meeting' | 'note' | 'email';
export type FeedbackLevel = 'Positive' | 'Neutral' | 'Negative' | 'Follow-up Needed';

export interface StageHistoryEntry {
  stage: LeadStage;
  enteredAt: string;
  exitedAt?: string;
}

export interface Lead {
  id: string;
  leadName: string;
  company: string;
  phone: string;
  email: string;
  source: LeadSource;
  ownerId: string;
  stage: LeadStage;
  stageChangedAt: string;
  expectedCloseDate?: string;
  stageHistory: StageHistoryEntry[];
  nextAction: string;
  nextActionDate: string;
  requirementSummary?: string;
  budgetBucket?: BudgetBucket;
  isDecisionMakerIdentified?: boolean;
  probability: number; // 0-100
  dealValue?: number;
  temperature: LeadTemperature;
  lostReason?: string;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  leadId: string;
  type: ActivityType;
  content: string;
  feedbackLevel?: FeedbackLevel;
  createdBy: string;
  createdAt: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: 'admin' | 'sales' | 'creative';
  photoURL?: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
  createdAt: string;
}
