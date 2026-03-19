import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Search, Filter, MessageSquare, Phone, Mail, Send, 
  TrendingUp, AlertCircle, CheckCircle2, Clock, MoreVertical,
  User, Briefcase, DollarSign, Calendar, MapPin, ChevronRight,
  LayoutDashboard, Users, FileText, Settings, LogOut,
  BarChart3, PieChart, ArrowUpRight, ArrowDownRight,
  Zap, BrainCircuit, MessageCircle, Info, Mic, Sparkles,
  CheckSquare, Check, Upload, X, LayoutList, Columns, Table, ArrowUpDown, Edit,
  History, MessageSquarePlus, Trash2
} from 'lucide-react';
import { 
  collection, query, where, onSnapshot, addDoc, updateDoc, 
  deleteDoc, doc, orderBy, limit, Timestamp, getDoc, getDocs, setDoc,
  increment
} from 'firebase/firestore';
import { 
  signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User as FirebaseUser 
} from 'firebase/auth';
import { getToken, onMessage } from 'firebase/messaging';
import { db, auth, messaging } from './firebase';
import { GoogleGenAI } from "@google/genai";
import { 
  format, 
  formatDistanceToNow, 
  isPast, 
  isToday, 
  addDays,
  differenceInDays,
  isSameMonth,
  isBefore,
  startOfToday
} from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utility Functions ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function normalizeDate(val: any): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  // Handle Firestore Timestamp
  if (typeof val === 'object' && val.toDate && typeof val.toDate === 'function') {
    return val.toDate();
  }
  if (typeof val === 'object' && 'seconds' in val) {
    return new Date(val.seconds * 1000);
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date() : d;
}

// --- Types ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

type LeadStage = 'New' | 'Contacted' | 'Qualified' | 'Meeting done' | 'Proposal shared' | 'Interested' | 'Delayed' | 'Won' | 'Lost';
type LeadSource = 'Instagram' | 'Website' | 'Referral' | 'Cold Call' | 'LinkedIn' | 'Other';
type LeadTemperature = 'cold' | 'warm' | 'hot' | 'Delayed' | 'Not interested';
type BudgetBucket = 'Low' | 'Medium' | 'High' | 'Enterprise';
type ActivityType = 'call' | 'meeting' | 'note' | 'email';
type FeedbackLevel = 'Positive' | 'Neutral' | 'Negative' | 'Follow-up Needed';

interface StageHistoryEntry {
  stage: LeadStage;
  enteredAt: string;
  exitedAt?: string;
}

type UserRole = 'admin' | 'sales' | 'creative';

interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: UserRole;
  photoURL?: string;
  fcmToken?: string;
}

interface AppNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
  createdAt: string;
}

interface Lead {
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
  notes?: string;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  // Legacy fields for compatibility during transition
  visualConceptUrl?: string;
  brandInsights?: string;
  scoreJustification?: string;
  recordings?: {
    url: string;
    transcript: string;
    summary: string;
    createdAt: string;
  }[];
  scores?: {
    seriousness: number;
    budgetReadiness: number;
    urgency: number;
    fit: number;
  };
}

interface Activity {
  id: string;
  leadId: string;
  type: ActivityType;
  feedbackLevel?: FeedbackLevel;
  content: string;
  createdBy: string;
  createdAt: string;
}

// --- Constants ---
const LEAD_STAGES: LeadStage[] = [
  'New', 'Contacted', 'Qualified', 'Meeting done', 'Proposal shared', 'Interested', 'Delayed', 'Won', 'Lost'
];

const LEAD_SOURCES: LeadSource[] = [
  'Instagram', 'Website', 'Referral', 'Cold Call', 'LinkedIn', 'Other'
];

const TEMPERATURE_COLORS = {
  'cold': 'bg-blue-100 text-blue-700 border-blue-200',
  'warm': 'bg-orange-100 text-orange-700 border-orange-200',
  'hot': 'bg-red-100 text-red-700 border-red-200',
  'Delayed': 'bg-zinc-100 text-zinc-700 border-zinc-200',
  'Not interested': 'bg-zinc-100 text-zinc-700 border-zinc-200'
};

// --- AI Service ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const JUJU_SPECIALIZATIONS = [
  "Real Shoot (High-end production)",
  "Drama Shorts (Story-telling)",
  "AI-Integrated Video Production",
  "Special Effects (VFX/CGI)",
  "UGC (User Generated Content) Style",
  "Social Media Video Packages",
  "Corporate & Brand Films"
];

const transcribeAudioAI = async (audioUrl: string) => {
  try {
    // Fetch audio as base64
    const audioResponse = await fetch(audioUrl);
    const audioBlob = await audioResponse.blob();
    const base64Audio = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(audioBlob);
    });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          inlineData: {
            mimeType: "audio/mpeg",
            data: base64Audio
          }
        },
        {
          text: "Transcribe this call recording between a salesperson and a client. Extract key requirements, objections, and next steps. Return as JSON with fields: transcript, summary, requirements, objections, nextSteps."
        }
      ],
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text || '{}');
  } catch (error) {
    console.error("AI Transcription Error:", error);
    return null;
  }
};

const getDynamicLeadScores = async (lead: Lead) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are Juju Films Lead Closure AI. Analyze this lead and dynamically adjust their scores.
      Lead Data: ${JSON.stringify(lead)}
      
      Consider:
      - Seriousness: Speed of response, clarity of brief, decision maker involvement.
      - Budget Readiness: Openness about budget, brand maturity, project scale.
      - Urgency: Timeline constraints, campaign dates, follow-up frequency.
      - Fit: Alignment with Juju India's specializations (${JUJU_SPECIALIZATIONS.join(', ')}).
      
      Return a JSON object with:
      - scores: { seriousness (0-10), budgetReadiness (0-10), urgency (0-10), fit (0-10) }
      - probability (0-100)
      - justification (A brief, sharp explanation for the score changes)
      `,
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text || '{}');
  } catch (error) {
    console.error("AI Scoring Error:", error);
    return null;
  }
};

const getFollowUpSuggestion = async (lead: Lead) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are Juju Films Lead Closure AI. Suggest a personalized follow-up for this lead.
      Lead: ${JSON.stringify(lead)}
      Juju India Specializations: ${JUJU_SPECIALIZATIONS.join(', ')}
      Website Context: https://www.jujuindia.com/
      
      Return a JSON object with:
      - channel (WhatsApp, Email, or Call)
      - reason (Why this channel and timing)
      - draft (The actual message text, tailored to the channel and lead context)
      - strategy (How to handle potential objections)
      `,
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text || '{}');
  } catch (error) {
    console.error("AI Follow-up Error:", error);
    return null;
  }
};

const getBrandInsights = async (companyName: string, industry: string) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze the brand perception and video strategy for "${companyName}" in the "${industry}" industry.
      Suggest the best video offering from Juju India's portfolio: ${JUJU_SPECIALIZATIONS.join(', ')}.
      
      Return a JSON object with:
      - perception (Brief summary of brand perception)
      - strategy (Recommended video strategy)
      - recommendedOffering (One of the specializations)
      - hook (A creative hook for a pitch)
      `,
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text || '{}');
  } catch (error) {
    console.error("AI Insights Error:", error);
    return null;
  }
};

const generateVisualConcept = async (prompt: string) => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: `A high-end cinematic mood board or visual concept for a brand video: ${prompt}. Style: Professional, Juju India aesthetic.` }],
      },
      config: { imageConfig: { aspectRatio: "16:9" } },
    });
    
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("AI Image Error:", error);
    return null;
  }
};

const qualifyLeadAI = async (rawInquiry: string) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are Juju Films Lead Closure AI. Analyze this raw inquiry and extract structured lead data.
      Raw Inquiry: "${rawInquiry}"
      
      Return a JSON object with:
      - leadName (string)
      - company (string)
      - requirementType (string)
      - temperature (cold, warm, hot)
      - seriousness (0-10)
      - budgetReadiness (0-10)
      - urgency (0-10)
      - fit (0-10)
      - probability (0-100)
      - nextAction (string)
      - missingInfo (array of strings)
      - draftWhatsApp (string)
      `,
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text || '{}');
  } catch (error) {
    console.error("AI Qualification Error:", error);
    return null;
  }
};

// --- Components ---

const Button = ({ className, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) => {
  const variants = {
    primary: 'bg-black text-white hover:bg-zinc-800',
    secondary: 'bg-white text-black border border-zinc-200 hover:bg-zinc-50',
    ghost: 'bg-transparent text-zinc-600 hover:bg-zinc-100',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
  };
  return (
    <button 
      className={cn('px-4 py-2 rounded-lg font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed', variants[variant], className)}
      {...props}
    />
  );
};

const Card = ({ children, className, ...props }: { children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm', className)} {...props}>
    {children}
  </div>
);

const Badge = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border', className)}>
    {children}
  </span>
);

const Input = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input 
    className={cn('w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all', className)}
    {...props}
  />
);

const Select = ({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select 
    className={cn('w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all', className)}
    {...props}
  >
    {children}
  </select>
);

const Textarea = ({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea 
    className={cn('w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all min-h-[100px]', className)}
    {...props}
  />
);

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isAddingLead, setIsAddingLead] = useState(false);
  const [isEditingLead, setIsEditingLead] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'board' | 'table'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'value' | 'activity'>('newest');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  const [filterStage, setFilterStage] = useState<string>('All');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'leads' | 'analytics' | 'team'>('dashboard');

  // Sync searchTerm with searchQuery for leads tab
  useEffect(() => {
    if (activeTab === 'leads') {
      setSearchQuery(searchTerm);
    }
  }, [searchTerm, activeTab]);
  const [rawInquiry, setRawInquiry] = useState('');
  const [isQualifying, setIsQualifying] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<any>(null);
  const [isGeneratingSuggestion, setIsGeneratingSuggestion] = useState(false);
  const [isGeneratingVisual, setIsGeneratingVisual] = useState(false);
  const [isCalculatingScores, setIsCalculatingScores] = useState(false);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [emails, setEmails] = useState<any[]>([]);
  const [isFetchingEmails, setIsFetchingEmails] = useState(false);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);

  // FCM Token Management
  useEffect(() => {
    if (!user || !messaging) return;
    
    const requestPermission = async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          const token = await getToken(messaging, { 
            vapidKey: 'BC6H0pZgdJHXOjKauqBJgDfWhacOoZldXm08BKeOSFsEM5uDUt2sI5n1snqUh0ZOfipPIzSqmgLgRWt-hl0eL-A' // Placeholder, usually injected
          });
          if (token) {
            try {
              await updateDoc(doc(db, 'users', user.uid), { fcmToken: token });
            } catch (error) {
              handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
            }
          }
        }
      } catch (error) {
        console.error('FCM Token Error:', error);
      }
    };

    requestPermission();

    const unsubscribe = onMessage(messaging, (payload) => {
      console.log('Message received. ', payload);
      // Handle foreground message
      if (payload.notification) {
        addInAppNotification(payload.notification.title || 'Alert', payload.notification.body || '');
      }
    });

    return () => unsubscribe();
  }, [user]);

  // Notifications Listener
  useEffect(() => {
    if (!selectedLead) {
      setActivities([]);
      return;
    }
    const q = query(collection(db, 'leads', selectedLead.id, 'activities'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setActivities(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Activity)));
    });
    return () => unsubscribe();
  }, [selectedLead]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(20)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setNotifications(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AppNotification)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'notifications');
    });
    return () => unsubscribe();
  }, [user]);

  const addInAppNotification = async (title: string, message: string, type: AppNotification['type'] = 'info') => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'notifications'), {
        userId: user.uid,
        title,
        message,
        type,
        read: false,
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'notifications');
    }
  };

  // Auth & Profile Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const profileRef = doc(db, 'users', u.uid);
        try {
          const profileDoc = await getDoc(profileRef);
          
          if (profileDoc.exists()) {
            setProfile(profileDoc.data() as UserProfile);
          } else {
            // Create default profile
            const newProfile: UserProfile = {
              uid: u.uid,
              displayName: u.displayName || 'New User',
              email: u.email || '',
              role: u.email === 'sangeet@socialcloudventures.com' ? 'admin' : 'sales',
              photoURL: u.photoURL || ''
            };
            await setDoc(profileRef, newProfile);
            setProfile(newProfile);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${u.uid}`);
        }
      } else {
        setProfile(null);
        setLeads([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Users Listener (for admin)
  useEffect(() => {
    if (profile?.role !== 'admin') return;
    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      setUsers(snapshot.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });
    return () => unsubscribe();
  }, [profile]);

  // Leads Listener
  useEffect(() => {
    if (!user || !profile) return;
    const leadsRef = collection(db, 'leads');
    let q;
    if (profile.role === 'admin' || profile.role === 'creative') {
      q = query(leadsRef, orderBy('updatedAt', 'desc'));
    } else {
      q = query(leadsRef, where('ownerId', '==', user.uid), orderBy('updatedAt', 'desc'));
    }
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const leadsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Lead));
      setLeads(leadsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'leads');
    });
    return () => unsubscribe();
  }, [user, profile]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login Error:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleAddLead = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const formData = new FormData(e.currentTarget);
    const now = new Date().toISOString();
    
    const email = formData.get('email') as string;
    const phone = formData.get('phone') as string;

    // Duplicate check
    const duplicate = leads.find(l => l.email === email || l.phone === phone);
    if (duplicate) {
      alert(`A lead with this email or phone already exists: ${duplicate.leadName}`);
      return;
    }
    
    const newLead: Omit<Lead, 'id'> = {
      leadName: formData.get('leadName') as string,
      company: formData.get('company') as string,
      phone: phone,
      email: email,
      source: formData.get('source') as LeadSource,
      ownerId: user.uid,
      stage: 'New',
      stageChangedAt: now,
      stageHistory: [{ stage: 'New', enteredAt: now }],
      nextAction: formData.get('nextAction') as string || 'Initial contact',
      nextActionDate: formData.get('nextActionDate') as string || addDays(new Date(), 1).toISOString(),
      probability: 10,
      temperature: 'warm',
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await addDoc(collection(db, 'leads'), newLead);
      setIsAddingLead(false);
      addInAppNotification('Lead Created', `New lead ${newLead.leadName} has been added.`, 'success');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'leads');
    }
  };

  const handleUpdateLead = async (id: string, updates: Partial<Lead>) => {
    const lead = leads.find(l => l.id === id);
    if (!lead) return;

    const now = new Date().toISOString();
    const finalUpdates: any = { ...updates, updatedAt: now };

    // Data Discipline Rules
    if (updates.stage && updates.stage !== lead.stage) {
      // Cannot move to 'Proposal shared' or beyond without dealValue
      const advancedStages: LeadStage[] = ['Proposal shared', 'Interested', 'Won'];
      if (advancedStages.includes(updates.stage) && !lead.dealValue && !updates.dealValue) {
        alert('Deal value is mandatory before moving to Proposal shared or beyond.');
        return;
      }

      // Lost reason mandatory
      if (updates.stage === 'Lost' && !updates.lostReason) {
        alert('Lost reason is mandatory when moving to Lost stage.');
        return;
      }

      // Update stage history
      const history = [...(lead.stageHistory || [])];
      if (history.length > 0) {
        history[history.length - 1].exitedAt = now;
      }
      history.push({ stage: updates.stage, enteredAt: now });
      
      finalUpdates.stageHistory = history;
      finalUpdates.stageChangedAt = now;
    }

    // Every lead must have next action
    if (updates.nextAction === '') {
      alert('Next action is mandatory.');
      return;
    }

    try {
      await updateDoc(doc(db, 'leads', id), finalUpdates);
      if (updates.stage) {
        addInAppNotification('Stage Updated', `Lead ${lead.leadName} moved to ${updates.stage}.`, 'info');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `leads/${id}`);
    }
  };

  const handleMassUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !user) return;
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (Array.isArray(json)) {
          const now = new Date().toISOString();
          for (const item of json) {
            const newLead: Omit<Lead, 'id'> = {
              leadName: item.leadName || 'Unknown',
              company: item.company || '',
              phone: item.phone || '',
              email: item.email || '',
              source: (item.source as LeadSource) || 'Other',
              ownerId: user.uid,
              stage: 'New',
              stageChangedAt: now,
              stageHistory: [{ stage: 'New', enteredAt: now }],
              nextAction: 'Initial contact',
              nextActionDate: addDays(new Date(), 1).toISOString(),
              probability: 10,
              temperature: 'warm',
              lastActivityAt: now,
              createdAt: now,
              updatedAt: now,
            };
            await addDoc(collection(db, 'leads'), newLead);
          }
          addInAppNotification('Mass Upload Complete', `Successfully uploaded ${json.length} leads.`, 'success');
        }
      } catch (error) {
        console.error('Mass upload error:', error);
        alert('Failed to parse JSON file. Please ensure it is a valid array of lead objects.');
      }
    };
    reader.readAsText(file);
  };

  const handleLogActivity = async (leadId: string, type: ActivityType, content: string, feedbackLevel?: FeedbackLevel) => {
    if (!user) return;
    const now = new Date().toISOString();
    const activity: Omit<Activity, 'id'> = {
      leadId,
      type,
      feedbackLevel,
      content,
      createdBy: user.uid,
      createdAt: now
    };

    try {
      await addDoc(collection(db, 'leads', leadId, 'activities'), activity);
      await updateDoc(doc(db, 'leads', leadId), {
        lastActivityAt: now,
        updatedAt: now
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `leads/${leadId}/activities`);
    }
  };

  // Check for upcoming follow-ups
  useEffect(() => {
    if (!user || leads.length === 0) return;
    
    const checkFollowUps = async () => {
      const twoDaysFromNow = addDays(new Date(), 2);
      const upcoming = leads.filter(l => {
        if (!l.nextActionDate) return false;
        const followUpDate = normalizeDate(l.nextActionDate);
        return followUpDate <= twoDaysFromNow && followUpDate >= new Date();
      });

      for (const lead of upcoming) {
        const notificationId = `followup_${lead.id}_${format(new Date(), 'yyyyMMdd')}`;
        const notifDoc = await getDoc(doc(db, 'notifications', notificationId));
        
        if (!notifDoc.exists()) {
          await setDoc(doc(db, 'notifications', notificationId), {
            userId: user.uid,
            title: 'Upcoming Action',
            message: `Next action for ${lead.leadName}: ${lead.nextAction}. Due: ${format(normalizeDate(lead.nextActionDate), 'MMM dd, hh:mm a')}.`,
            type: 'warning',
            read: false,
            createdAt: new Date().toISOString()
          });
        }
      }
    };

    checkFollowUps();
  }, [user, leads]);

  const fetchEmails = async (query: string) => {
    // Gmail integration disabled
    return;
  };

  const handleUploadAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !selectedLead) return;
    setIsUploadingAudio(true);
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('audio', file);

    try {
      const response = await fetch('/api/upload-recording', {
        method: 'POST',
        body: formData
      });
      const { url } = await response.json();
      
      // Transcribe with AI
      const aiResult = await transcribeAudioAI(url);
      
      const newRecording = {
        url,
        transcript: aiResult?.transcript || 'Transcription failed',
        summary: aiResult?.summary || 'No summary available',
        createdAt: new Date().toISOString()
      };

      const updatedRecordings = [...(selectedLead.recordings || []), newRecording];
      await handleUpdateLead(selectedLead.id, { recordings: updatedRecordings });
      setSelectedLead({ ...selectedLead, recordings: updatedRecordings });
      addInAppNotification('Recording Processed', `Call recording for ${selectedLead.leadName} has been transcribed.`, 'success');
    } catch (error) {
      console.error('Upload error:', error);
    }
    setIsUploadingAudio(false);
  };

  const handleAIQualify = async () => {
    if (!rawInquiry.trim()) return;
    setIsQualifying(true);
    const result = await qualifyLeadAI(rawInquiry);
    if (result && user) {
      const now = new Date().toISOString();
      const newLead = {
        leadName: result.leadName || 'New Inquiry',
        company: result.company || '',
        requirementType: result.requirementType || '',
        stage: 'New' as LeadStage,
        temperature: (result.temperature?.toLowerCase() || 'warm') as LeadTemperature,
        ownerId: user.uid,
        createdAt: now,
        updatedAt: now,
        probability: result.probability || 0,
        scores: {
          seriousness: result.seriousness || 5,
          budgetReadiness: result.budgetReadiness || 5,
          urgency: result.urgency || 5,
          fit: result.fit || 5
        },
        notes: `AI Qualification: ${result.nextAction}\n\nMissing Info: ${result.missingInfo?.join(', ')}`,
      };
      await addDoc(collection(db, 'leads'), newLead);
      setRawInquiry('');
    }
    setIsQualifying(false);
  };

  const handleGenerateSuggestion = async () => {
    if (!selectedLead) return;
    setIsGeneratingSuggestion(true);
    const suggestion = await getFollowUpSuggestion(selectedLead);
    setAiSuggestion(suggestion);
    setIsGeneratingSuggestion(false);
  };

  const handleGenerateInsights = async () => {
    if (!selectedLead || !selectedLead.company) return;
    setIsGeneratingSuggestion(true);
    const insights = await getBrandInsights(selectedLead.company, selectedLead.industry || 'General');
    if (insights) {
      await handleUpdateLead(selectedLead.id, { 
        brandInsights: `Perception: ${insights.perception}\nStrategy: ${insights.strategy}\nRecommended: ${insights.recommendedOffering}\nHook: ${insights.hook}` 
      });
      setSelectedLead(prev => prev ? { ...prev, brandInsights: `Perception: ${insights.perception}\nStrategy: ${insights.strategy}\nRecommended: ${insights.recommendedOffering}\nHook: ${insights.hook}` } : null);
    }
    setIsGeneratingSuggestion(false);
  };

  const handleGenerateVisual = async () => {
    if (!selectedLead) return;
    setIsGeneratingVisual(true);
    const prompt = `${selectedLead.projectType || selectedLead.requirementType} for ${selectedLead.company || 'a brand'}. Objective: ${selectedLead.projectObjective || 'High quality cinematic video'}`;
    const url = await generateVisualConcept(prompt);
    if (url) {
      await handleUpdateLead(selectedLead.id, { visualConceptUrl: url });
      setSelectedLead(prev => prev ? { ...prev, visualConceptUrl: url } : null);
    }
    setIsGeneratingVisual(false);
  };

  const handleRecalculateScores = async () => {
    if (!selectedLead) return;
    setIsCalculatingScores(true);
    const result = await getDynamicLeadScores(selectedLead);
    if (result) {
      const updates = {
        scores: result.scores,
        probability: result.probability,
        scoreJustification: result.justification
      };
      await handleUpdateLead(selectedLead.id, updates);
      setSelectedLead(prev => prev ? { ...prev, ...updates } : null);
      addInAppNotification('Lead Scored', `AI has updated scores for ${selectedLead.leadName}.`, 'success');
    }
    setIsCalculatingScores(false);
  };

  const filteredLeads = useMemo(() => {
    let result = leads.filter(l => {
      const matchesSearch = l.leadName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           l.company?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           l.email?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStage = filterStage === 'All' || l.stage === filterStage;
      return matchesSearch && matchesStage;
    });

    result.sort((a, b) => {
      if (sortBy === 'newest') return normalizeDate(b.createdAt).getTime() - normalizeDate(a.createdAt).getTime();
      if (sortBy === 'value') return (b.dealValue || 0) - (a.dealValue || 0);
      if (sortBy === 'activity') return normalizeDate(b.lastActivityAt).getTime() - normalizeDate(a.lastActivityAt).getTime();
      return 0;
    });

    return result;
  }, [leads, searchQuery, filterStage, sortBy]);

  const stats = useMemo(() => {
    const hot = leads.filter(l => l.temperature === 'Hot' || l.temperature === 'Very Hot').length;
    const proposals = leads.filter(l => l.stage === 'Proposal Sent').length;
    const followups = leads.filter(l => l.nextActionDate && isPast(normalizeDate(l.nextActionDate))).length;
    const closures = leads.filter(l => l.stage === 'Closed Won').length;
    return { hot, proposals, followups, closures };
  }, [leads]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-zinc-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-black"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-zinc-50 p-6">
        <div className="max-w-md w-full text-center space-y-8">
          <div className="space-y-2">
            <div className="w-20 h-20 bg-black rounded-3xl mx-auto flex items-center justify-center mb-6 shadow-xl rotate-3">
              <Zap className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-zinc-900">Juju Films</h1>
            <p className="text-zinc-500 font-medium italic">Lead Closure AI</p>
          </div>
          <Card className="p-8 space-y-6">
            <p className="text-zinc-600">
              Welcome to the sales intelligence hub. Log in to manage your pipeline, qualify leads with AI, and accelerate closures.
            </p>
            <Button onClick={handleLogin} className="w-full py-4 text-lg">
              <User className="w-5 h-5" />
              Sign in with Google
            </Button>
          </Card>
          <p className="text-xs text-zinc-400 uppercase tracking-widest font-semibold">
            Built for conversion discipline
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-zinc-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-zinc-200 flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center shadow-lg">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-zinc-900 leading-none">Juju Films</h2>
            <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-tighter">Closure AI</p>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-4">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={cn('w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all', activeTab === 'dashboard' ? 'bg-black text-white shadow-md' : 'text-zinc-600 hover:bg-zinc-100')}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span className="font-medium">Dashboard</span>
          </button>
          <button 
            onClick={() => setActiveTab('leads')}
            className={cn('w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all', activeTab === 'leads' ? 'bg-black text-white shadow-md' : 'text-zinc-600 hover:bg-zinc-100')}
          >
            <Users className="w-5 h-5" />
            <span className="font-medium">Pipeline</span>
          </button>
          <button 
            onClick={() => setActiveTab('tasks')}
            className={cn('w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all', activeTab === 'tasks' ? 'bg-black text-white shadow-md' : 'text-zinc-600 hover:bg-zinc-100')}
          >
            <CheckSquare className="w-5 h-5" />
            <span className="font-medium">Tasks</span>
          </button>
          {profile?.role === 'admin' && (
            <button 
              onClick={() => setActiveTab('team')}
              className={cn('w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all', activeTab === 'team' ? 'bg-black text-white shadow-md' : 'text-zinc-600 hover:bg-zinc-100')}
            >
              <Settings className="w-5 h-5" />
              <span className="font-medium">Team Management</span>
            </button>
          )}
        </nav>

        <div className="p-4 border-t border-zinc-100">
          <div className="flex items-center gap-3 px-4 py-3">
            <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-zinc-200" alt="User" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-zinc-900 truncate">{user.displayName}</p>
              <p className="text-[10px] text-zinc-400 truncate">{user.email}</p>
            </div>
            <button onClick={handleLogout} className="text-zinc-400 hover:text-red-500">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-zinc-200 px-8 flex items-center justify-between relative">
          <h2 className="text-xl font-bold text-zinc-900 capitalize">{activeTab}</h2>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <Input 
                placeholder="Search leads..." 
                className="pl-10 w-64 h-9 text-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <div className="relative">
              <button 
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-2 bg-zinc-100 rounded-lg text-zinc-600 hover:bg-zinc-200 relative"
              >
                <MessageSquare className="w-5 h-5" />
                {notifications.filter(n => !n.read).length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {notifications.filter(n => !n.read).length}
                  </span>
                )}
              </button>
              
              {showNotifications && (
                <Card className="absolute right-0 mt-2 w-80 z-50 shadow-2xl animate-in fade-in slide-in-from-top-2">
                  <div className="p-4 border-b border-zinc-100 flex justify-between items-center">
                    <h4 className="font-bold text-sm">Notifications</h4>
                    <button 
                      onClick={async () => {
                        for (const n of notifications.filter(n => !n.read)) {
                          await updateDoc(doc(db, 'notifications', n.id), { read: true });
                        }
                      }}
                      className="text-[10px] font-bold text-blue-600 uppercase"
                    >
                      Mark all as read
                    </button>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.length > 0 ? notifications.map(n => (
                      <div 
                        key={n.id} 
                        className={cn('p-4 border-b border-zinc-50 hover:bg-zinc-50 transition-all cursor-pointer', !n.read && 'bg-blue-50/30')}
                        onClick={async () => {
                          if (!n.read) await updateDoc(doc(db, 'notifications', n.id), { read: true });
                        }}
                      >
                        <div className="flex gap-3">
                          <div className={cn('p-2 rounded-lg', n.type === 'success' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600')}>
                            {n.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <Info className="w-4 h-4" />}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-zinc-900">{n.title}</p>
                            <p className="text-xs text-zinc-500 mt-1">{n.message}</p>
                            <p className="text-[10px] text-zinc-400 mt-2">{formatDistanceToNow(normalizeDate(n.createdAt))} ago</p>
                          </div>
                        </div>
                      </div>
                    )) : (
                      <div className="p-8 text-center text-zinc-400 text-xs">No notifications yet</div>
                    )}
                  </div>
                </Card>
              )}
            </div>

            <Button onClick={() => setIsAddingLead(true)} className="h-9 px-4 text-sm">
              <Plus className="w-4 h-4" />
              Add Lead
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          {activeTab === 'dashboard' && (
            <div className="space-y-8">
              {/* Stats Grid */}
              <div className="grid grid-cols-4 gap-6">
                <Card className="p-6 bg-zinc-50 border-zinc-200">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Total Pipeline Value</p>
                  <h3 className="text-3xl font-bold text-zinc-900">
                    ₹{(leads.reduce((acc, l) => acc + (l.dealValue || 0), 0) / 100000).toFixed(1)}L
                  </h3>
                  <p className="text-[10px] text-zinc-500 mt-2">Across {leads.length} leads</p>
                </Card>
                <Card className="p-6 bg-zinc-50 border-zinc-200">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Weighted Pipeline</p>
                  <h3 className="text-3xl font-bold text-zinc-900">
                    ₹{(leads.reduce((acc, l) => acc + ((l.dealValue || 0) * (l.probability / 100)), 0) / 100000).toFixed(1)}L
                  </h3>
                  <p className="text-[10px] text-zinc-500 mt-2">Expected Revenue</p>
                </Card>
                <Card className="p-6 bg-zinc-50 border-zinc-200">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Stuck Deals</p>
                  <h3 className="text-3xl font-bold text-red-600">
                    {leads.filter(l => differenceInDays(new Date(), normalizeDate(l.stageChangedAt)) > 7 && !['Won', 'Lost'].includes(l.stage)).length}
                  </h3>
                  <p className="text-[10px] text-zinc-500 mt-2">No stage change in 7+ days</p>
                </Card>
                <Card className="p-6 bg-zinc-50 border-zinc-200">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Monthly Won</p>
                  <h3 className="text-3xl font-bold text-emerald-600">
                    ₹{(leads.filter(l => l.stage === 'Won' && isSameMonth(normalizeDate(l.updatedAt), new Date())).reduce((acc, l) => acc + (l.dealValue || 0), 0) / 100000).toFixed(1)}L
                  </h3>
                  <p className="text-[10px] text-zinc-500 mt-2">Current month actuals</p>
                </Card>
              </div>

              <div className="grid grid-cols-2 gap-8">
                <Card className="p-6">
                  <h3 className="font-bold text-sm mb-6 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Pipeline by Stage
                  </h3>
                  <div className="space-y-4">
                    {LEAD_STAGES.map(stage => {
                      const count = leads.filter(l => l.stage === stage).length;
                      const percentage = leads.length > 0 ? (count / leads.length) * 100 : 0;
                      return (
                        <div key={stage} className="space-y-1">
                          <div className="flex justify-between text-[10px] font-bold uppercase">
                            <span>{stage}</span>
                            <span>{count}</span>
                          </div>
                          <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-black transition-all duration-500" 
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                <Card className="p-6">
                  <h3 className="font-bold text-sm mb-6 flex items-center gap-2">
                    <PieChart className="w-4 h-4" />
                    Leads by Source
                  </h3>
                  <div className="space-y-4">
                    {LEAD_SOURCES.map(source => {
                      const count = leads.filter(l => l.source === source).length;
                      const wonCount = leads.filter(l => l.source === source && l.stage === 'Won').length;
                      const conversion = count > 0 ? (wonCount / count) * 100 : 0;
                      const percentage = leads.length > 0 ? (count / leads.length) * 100 : 0;
                      return (
                        <div key={source} className="space-y-1">
                          <div className="flex justify-between text-[10px] font-bold uppercase">
                            <span>{source} ({conversion.toFixed(0)}% conv)</span>
                            <span>{count}</span>
                          </div>
                          <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-zinc-400 transition-all duration-500" 
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>

              {/* Stuck Deals List */}
              <Card className="p-6">
                <h3 className="font-bold text-sm mb-4 flex items-center gap-2 text-red-600">
                  <AlertCircle className="w-4 h-4" />
                  Stuck Deals (Attention Needed)
                </h3>
                <div className="space-y-2">
                  {leads
                    .filter(l => differenceInDays(new Date(), normalizeDate(l.stageChangedAt)) > 7 && !['Won', 'Lost'].includes(l.stage))
                    .map(lead => (
                      <div key={lead.id} className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-100">
                        <div>
                          <p className="text-sm font-bold text-red-900">{lead.leadName}</p>
                          <p className="text-[10px] text-red-600 uppercase font-bold">{lead.stage} • Stuck for {differenceInDays(new Date(), normalizeDate(lead.stageChangedAt))} days</p>
                        </div>
                        <Button 
                          variant="secondary" 
                          className="h-8 text-[10px] bg-white border-red-200 text-red-700"
                          onClick={() => { setSelectedLead(lead); setActiveTab('leads'); }}
                        >
                          Take Action
                        </Button>
                      </div>
                    ))}
                  {leads.filter(l => differenceInDays(new Date(), normalizeDate(l.stageChangedAt)) > 7 && !['Won', 'Lost'].includes(l.stage)).length === 0 && (
                    <p className="text-center py-8 text-zinc-400 text-xs">No stuck deals. Great job!</p>
                  )}
                </div>
              </Card>
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="space-y-8">
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-4">
                  <h3 className="font-bold text-zinc-900 flex items-center gap-2">
                    <CheckSquare className="w-4 h-4" />
                    Today's Tasks
                  </h3>
                  <div className="space-y-3">
                    {leads
                      .filter(l => l.nextActionDate && isToday(normalizeDate(l.nextActionDate)))
                      .map(lead => (
                        <Card key={lead.id} className="p-4 border-l-4 border-l-black">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-[10px] font-bold text-zinc-400 uppercase mb-1">{lead.leadName} • {lead.company}</p>
                              <h4 className="font-bold text-zinc-900">{lead.nextAction}</h4>
                              <p className="text-[10px] text-zinc-500 mt-2">Due: {format(normalizeDate(lead.nextActionDate), 'hh:mm a')}</p>
                            </div>
                            <Button 
                              variant="secondary" 
                              className="h-8 w-8 p-0 rounded-full"
                              onClick={() => handleUpdateLead(lead.id, { nextAction: 'Completed', nextActionDate: addDays(new Date(), 1).toISOString() })}
                            >
                              <Check className="w-4 h-4" />
                            </Button>
                          </div>
                        </Card>
                      ))}
                    {leads.filter(l => l.nextActionDate && isToday(normalizeDate(l.nextActionDate))).length === 0 && (
                      <div className="text-center py-12 bg-zinc-50 rounded-xl border border-dashed border-zinc-200">
                        <p className="text-sm text-zinc-400">No tasks for today. Relax!</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-bold text-red-600 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Overdue Tasks
                  </h3>
                  <div className="space-y-3">
                    {leads
                      .filter(l => l.nextActionDate && isBefore(normalizeDate(l.nextActionDate), startOfToday()))
                      .map(lead => (
                        <Card key={lead.id} className="p-4 border-l-4 border-l-red-500 bg-red-50/30">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-[10px] font-bold text-red-400 uppercase mb-1">{lead.leadName} • {lead.company}</p>
                              <h4 className="font-bold text-zinc-900">{lead.nextAction}</h4>
                              <p className="text-[10px] text-red-600 mt-2 font-bold uppercase">Overdue by {differenceInDays(new Date(), normalizeDate(lead.nextActionDate))} days</p>
                            </div>
                            <Button 
                              variant="secondary" 
                              className="h-8 text-[10px] bg-white border-red-200 text-red-700"
                              onClick={() => { setSelectedLead(lead); setActiveTab('leads'); }}
                            >
                              Reschedule
                            </Button>
                          </div>
                        </Card>
                      ))}
                    {leads.filter(l => l.nextActionDate && isBefore(normalizeDate(l.nextActionDate), startOfToday())).length === 0 && (
                      <div className="text-center py-12 bg-emerald-50 rounded-xl border border-dashed border-emerald-200">
                        <p className="text-sm text-emerald-600">No overdue tasks. You're on fire!</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'leads' && (
            <div className="flex flex-col h-full gap-6">
              {/* Controls Header */}
              <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-zinc-100 shadow-sm">
                <div className="flex items-center gap-4 flex-1">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <Input 
                      placeholder="Search leads, companies, emails..." 
                      className="pl-10 h-10"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <Select 
                    className="w-40 h-10 text-xs font-bold"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                  >
                    <option value="newest">Newest First</option>
                    <option value="value">Highest Value</option>
                    <option value="activity">Recent Activity</option>
                  </Select>
                </div>
                <div className="flex items-center gap-2 bg-zinc-100 p-1 rounded-xl">
                  <button 
                    onClick={() => setViewMode('list')}
                    className={cn('p-2 rounded-lg transition-all', viewMode === 'list' ? 'bg-white shadow-sm text-black' : 'text-zinc-500 hover:text-zinc-700')}
                    title="List View"
                  >
                    <LayoutList className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setViewMode('table')}
                    className={cn('p-2 rounded-lg transition-all', viewMode === 'table' ? 'bg-white shadow-sm text-black' : 'text-zinc-500 hover:text-zinc-700')}
                    title="Table View"
                  >
                    <Table className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setViewMode('board')}
                    className={cn('p-2 rounded-lg transition-all', viewMode === 'board' ? 'bg-white shadow-sm text-black' : 'text-zinc-500 hover:text-zinc-700')}
                    title="Board View"
                  >
                    <Columns className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {viewMode === 'list' ? (
                <div className="flex gap-8 flex-1 overflow-hidden">
                  {/* Pipeline List */}
                  <div className="w-1/3 flex flex-col gap-4">
                    <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                      <button 
                        onClick={() => setFilterStage('All')}
                        className={cn('px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all', filterStage === 'All' ? 'bg-black text-white' : 'bg-white border border-zinc-200 text-zinc-500')}
                      >
                        All
                      </button>
                      {LEAD_STAGES.map(stage => (
                        <button 
                          key={stage}
                          onClick={() => setFilterStage(stage)}
                          className={cn('px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all', filterStage === stage ? 'bg-black text-white' : 'bg-white border border-zinc-200 text-zinc-500')}
                        >
                          {stage}
                        </button>
                      ))}
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                      {filteredLeads.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-zinc-400 p-8 text-center space-y-4">
                          <div className="p-4 bg-zinc-100 rounded-full">
                            <Search className="w-8 h-8" />
                          </div>
                          <div>
                            <p className="font-medium">No leads found</p>
                            <p className="text-xs">Try adjusting your filters or search query</p>
                          </div>
                          <div className="flex flex-col gap-2">
                            {filterStage !== 'All' && (
                              <Button variant="secondary" size="sm" onClick={() => setFilterStage('All')}>
                                Clear Stage Filter
                              </Button>
                            )}
                            {searchQuery !== '' && (
                              <Button variant="secondary" size="sm" onClick={() => { setSearchQuery(''); setSearchTerm(''); }}>
                                Clear Search
                              </Button>
                            )}
                          </div>
                        </div>
                      ) : (
                        filteredLeads.map(lead => (
                          <Card 
                            key={lead.id} 
                            className={cn('p-4 cursor-pointer transition-all border-l-4 group', selectedLead?.id === lead.id ? 'border-l-black ring-2 ring-black/5' : 'border-l-transparent hover:border-zinc-300')}
                            onClick={() => setSelectedLead(lead)}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <h4 className="font-bold text-zinc-900 group-hover:text-black transition-colors">{lead.leadName}</h4>
                              <Badge className={TEMPERATURE_COLORS[lead.temperature]}>{lead.temperature}</Badge>
                            </div>
                            <p className="text-xs text-zinc-500 mb-3">{lead.company || 'Individual'}</p>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{lead.stage}</span>
                                {lead.dealValue && (
                                  <span className="text-[10px] font-bold text-emerald-600">₹{lead.dealValue}L</span>
                                )}
                              </div>
                              <span className="text-[10px] text-zinc-400">{formatDistanceToNow(normalizeDate(lead.updatedAt))} ago</span>
                            </div>
                          </Card>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Lead Detail */}
                  <div className="flex-1 overflow-hidden">
                    {selectedLead ? (
                      <Card className="h-full flex flex-col overflow-hidden">
                        <div className="p-6 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-lg rotate-2">
                              {selectedLead.leadName[0]}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="text-xl font-bold text-zinc-900">{selectedLead.leadName}</h3>
                                <button 
                                  onClick={() => setIsEditingLead(true)}
                                  className="p-1 text-zinc-400 hover:text-black transition-colors"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                              </div>
                              <p className="text-sm text-zinc-500">{selectedLead.company || 'No Company'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Select 
                              className="w-40 h-9 text-xs font-bold"
                              value={selectedLead.stage}
                              onChange={(e) => handleUpdateLead(selectedLead.id, { stage: e.target.value as LeadStage })}
                            >
                              {LEAD_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                            </Select>
                            <Select 
                              className={cn('w-28 h-9 text-xs font-bold', TEMPERATURE_COLORS[selectedLead.temperature])}
                              value={selectedLead.temperature}
                              onChange={(e) => handleUpdateLead(selectedLead.id, { temperature: e.target.value as LeadTemperature })}
                            >
                              <option value="Cold">Cold</option>
                              <option value="Warm">Warm</option>
                              <option value="Hot">Hot</option>
                              <option value="Very Hot">Very Hot</option>
                            </Select>
                          </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 space-y-8">
                          {/* Action Bar */}
                          <div className="grid grid-cols-4 gap-4">
                            <a 
                              href={`https://wa.me/${selectedLead.phone?.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${selectedLead.leadName}, this is ${user.displayName} from Juju Films...`)}`}
                              target="_blank" rel="noreferrer"
                            >
                              <Button variant="secondary" className="w-full py-3 bg-emerald-50 border-emerald-100 text-emerald-700 hover:bg-emerald-100">
                                <MessageCircle className="w-4 h-4" />
                                WhatsApp
                              </Button>
                            </a>
                            <a href={`tel:${selectedLead.phone}`}>
                              <Button variant="secondary" className="w-full py-3 bg-blue-50 border-blue-100 text-blue-700 hover:bg-blue-100">
                                <Phone className="w-4 h-4" />
                                Call
                              </Button>
                            </a>
                            <a href={`mailto:${selectedLead.email}?subject=Regarding your video production inquiry&body=Hi ${selectedLead.leadName},`}>
                              <Button variant="secondary" className="w-full py-3 bg-zinc-50 border-zinc-200 text-zinc-700 hover:bg-zinc-100">
                                <Mail className="w-4 h-4" />
                                Email
                              </Button>
                            </a>
                            <Button variant="primary" className="w-full py-3" onClick={() => handleUpdateLead(selectedLead.id, { stage: 'Proposal shared' })}>
                              <Send className="w-4 h-4" />
                              Send Proposal
                            </Button>
                          </div>

                          {/* Level-wise Connect Feedback */}
                          <Card className="p-6 border-zinc-200 bg-zinc-50/30">
                            <div className="flex justify-between items-center mb-6">
                              <h4 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
                                <History className="w-4 h-4" />
                                Interaction Timeline
                              </h4>
                              <Button 
                                variant="secondary" 
                                className="h-8 text-[10px]"
                                onClick={() => {
                                  const content = prompt('Log interaction details:');
                                  const level = prompt('Feedback Level (Positive/Neutral/Negative/Follow-up Needed):') as FeedbackLevel;
                                  if (content && level) handleLogActivity(selectedLead.id, 'call', content, level);
                                }}
                              >
                                <MessageSquarePlus className="w-3 h-3" />
                                Log Connect
                              </Button>
                            </div>
                            <div className="space-y-4">
                              {activities.map((activity) => (
                                <div key={activity.id} className="flex gap-4 relative">
                                  <div className="w-8 h-8 rounded-full bg-white border border-zinc-200 flex items-center justify-center flex-shrink-0 z-10">
                                    {activity.type === 'call' && <Phone className="w-3 h-3 text-blue-500" />}
                                    {activity.type === 'meeting' && <Users className="w-3 h-3 text-purple-500" />}
                                    {activity.type === 'email' && <Mail className="w-3 h-3 text-zinc-500" />}
                                    {activity.type === 'note' && <FileText className="w-3 h-3 text-amber-500" />}
                                  </div>
                                  <div className="flex-1 pb-4 border-b border-zinc-100 last:border-0">
                                    <div className="flex justify-between items-start mb-1">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-zinc-900 capitalize">{activity.type}</span>
                                        {activity.feedbackLevel && (
                                          <Badge className={cn(
                                            'text-[8px] px-1.5 py-0',
                                            activity.feedbackLevel === 'Positive' && 'bg-emerald-100 text-emerald-700',
                                            activity.feedbackLevel === 'Neutral' && 'bg-zinc-100 text-zinc-700',
                                            activity.feedbackLevel === 'Negative' && 'bg-red-100 text-red-700',
                                            activity.feedbackLevel === 'Follow-up Needed' && 'bg-amber-100 text-amber-700'
                                          )}>
                                            {activity.feedbackLevel}
                                          </Badge>
                                        )}
                                      </div>
                                      <span className="text-[10px] text-zinc-400">{formatDistanceToNow(normalizeDate(activity.createdAt))} ago</span>
                                    </div>
                                    <p className="text-xs text-zinc-600 leading-relaxed">{activity.content}</p>
                                  </div>
                                </div>
                              ))}
                              {activities.length === 0 && (
                                <div className="text-center py-8">
                                  <p className="text-xs text-zinc-400 italic">No interactions logged yet.</p>
                                </div>
                              )}
                            </div>
                          </Card>

                      {/* Qualification & Forecasting */}
                      <div className="grid grid-cols-2 gap-8">
                        <div className="space-y-6">
                          <h4 className="text-sm font-bold text-zinc-900 border-b pb-2">Qualification</h4>
                          <div className="space-y-4">
                            <div>
                              <label className="text-[10px] font-bold text-zinc-400 uppercase">Requirement Summary</label>
                              <Textarea 
                                className="mt-1 text-sm"
                                value={selectedLead.requirementSummary || ''}
                                onChange={(e) => handleUpdateLead(selectedLead.id, { requirementSummary: e.target.value })}
                                placeholder="What does the client need?"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="text-[10px] font-bold text-zinc-400 uppercase">Budget Bucket</label>
                                <Select 
                                  className="mt-1 text-sm"
                                  value={selectedLead.budgetBucket || ''}
                                  onChange={(e) => handleUpdateLead(selectedLead.id, { budgetBucket: e.target.value as BudgetBucket })}
                                >
                                  <option value="">Select Bucket</option>
                                  <option value="Low">Low</option>
                                  <option value="Medium">Medium</option>
                                  <option value="High">High</option>
                                  <option value="Enterprise">Enterprise</option>
                                </Select>
                              </div>
                              <div>
                                <label className="text-[10px] font-bold text-zinc-400 uppercase">Decision Maker?</label>
                                <Select 
                                  className="mt-1 text-sm"
                                  value={selectedLead.isDecisionMakerIdentified ? 'yes' : 'no'}
                                  onChange={(e) => handleUpdateLead(selectedLead.id, { isDecisionMakerIdentified: e.target.value === 'yes' })}
                                >
                                  <option value="no">No</option>
                                  <option value="yes">Yes</option>
                                </Select>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-6">
                          <h4 className="text-sm font-bold text-zinc-900 border-b pb-2">Forecasting</h4>
                          <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="text-[10px] font-bold text-zinc-400 uppercase">Deal Value (₹)</label>
                                <Input 
                                  type="number"
                                  className="mt-1 text-sm"
                                  value={selectedLead.dealValue || ''}
                                  onChange={(e) => handleUpdateLead(selectedLead.id, { dealValue: Number(e.target.value) })}
                                  placeholder="e.g. 500000"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-bold text-zinc-400 uppercase">Probability (%)</label>
                                <Input 
                                  type="number"
                                  className="mt-1 text-sm"
                                  value={selectedLead.probability || ''}
                                  onChange={(e) => handleUpdateLead(selectedLead.id, { probability: Number(e.target.value) })}
                                  min="0" max="100"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-zinc-400 uppercase">Expected Close Date</label>
                              <Input 
                                type="date"
                                className="mt-1 text-sm"
                                value={selectedLead.expectedCloseDate ? format(normalizeDate(selectedLead.expectedCloseDate), 'yyyy-MM-dd') : ''}
                                onChange={(e) => {
                                  const d = new Date(e.target.value);
                                  if (!isNaN(d.getTime())) {
                                    handleUpdateLead(selectedLead.id, { expectedCloseDate: d.toISOString() });
                                  }
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Next Action */}
                      <Card className="p-6 bg-zinc-900 text-white">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-4">Next Action Plan</h4>
                        <div className="grid grid-cols-2 gap-6">
                          <div>
                            <label className="text-[10px] font-bold text-zinc-500 uppercase">Mandatory Next Action</label>
                            <Input 
                              className="mt-1 bg-white/5 border-white/10 text-white"
                              value={selectedLead.nextAction || ''}
                              onChange={(e) => handleUpdateLead(selectedLead.id, { nextAction: e.target.value })}
                            />
                          </div>
                            <div>
                              <label className="text-[10px] font-bold text-zinc-500 uppercase">Due Date</label>
                              <Input 
                                type="datetime-local"
                                className="mt-1 bg-white/5 border-white/10 text-white"
                                value={selectedLead.nextActionDate ? format(normalizeDate(selectedLead.nextActionDate), "yyyy-MM-dd'T'HH:mm") : ''}
                                onChange={(e) => {
                                  const d = new Date(e.target.value);
                                  if (!isNaN(d.getTime())) {
                                    handleUpdateLead(selectedLead.id, { nextActionDate: d.toISOString() });
                                  }
                                }}
                              />
                            </div>
                        </div>
                      </Card>

                      {/* AI Follow-up Suggestion */}
                      <Card className="p-6 bg-purple-50 border-purple-100">
                        <div className="flex justify-between items-center mb-4">
                          <h4 className="text-sm font-bold text-purple-900 flex items-center gap-2">
                            <BrainCircuit className="w-4 h-4" />
                            AI Follow-up Strategy
                          </h4>
                          <Button 
                            variant="secondary" 
                            className="h-8 text-[10px] bg-white border-purple-200 text-purple-700"
                            onClick={handleGenerateSuggestion}
                            disabled={isGeneratingSuggestion}
                          >
                            {isGeneratingSuggestion ? 'Generating...' : 'Get Suggestion'}
                          </Button>
                        </div>
                        {aiSuggestion ? (
                          <div className="space-y-4">
                            <div className="flex gap-4">
                              <div className="flex-1 p-3 bg-white rounded-lg border border-purple-100">
                                <p className="text-[10px] font-bold text-purple-400 uppercase mb-1">Recommended Channel</p>
                                <p className="text-sm font-bold text-purple-900">{aiSuggestion.channel}</p>
                              </div>
                              <div className="flex-1 p-3 bg-white rounded-lg border border-purple-100">
                                <p className="text-[10px] font-bold text-purple-400 uppercase mb-1">Strategy</p>
                                <p className="text-xs text-purple-800">{aiSuggestion.reason}</p>
                              </div>
                            </div>
                            <div className="p-4 bg-white rounded-xl border border-purple-100 relative group">
                              <p className="text-[10px] font-bold text-purple-400 uppercase mb-2">Draft Message</p>
                              <p className="text-sm text-zinc-700 italic">"{aiSuggestion.draft}"</p>
                              <button 
                                onClick={() => navigator.clipboard.writeText(aiSuggestion.draft)}
                                className="absolute top-4 right-4 p-2 bg-purple-50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <FileText className="w-3 h-3 text-purple-600" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-purple-600 italic">Click to generate a personalized follow-up based on lead context.</p>
                        )}
                      </Card>

                      <div className="grid grid-cols-2 gap-8">
                        {/* Info Section */}
                        <div className="space-y-6">
                          <div>
                            <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                              <Info className="w-3 h-3" />
                              Lead Details
                            </h4>
                            <div className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label className="text-[10px] font-bold text-zinc-400 uppercase">Source</label>
                                  <p className="text-sm font-medium text-zinc-900">{selectedLead.source || 'Unknown'}</p>
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-zinc-400 uppercase">Decision Maker</label>
                                  <p className="text-sm font-medium text-zinc-900">{selectedLead.isDecisionMakerIdentified ? 'Yes' : 'No'}</p>
                                </div>
                              </div>
                              <div>
                                <label className="text-[10px] font-bold text-zinc-400 uppercase">Requirement Summary</label>
                                <p className="text-sm font-medium text-zinc-900">{selectedLead.requirementSummary || 'Not specified'}</p>
                              </div>
                              <div>
                                <label className="text-[10px] font-bold text-zinc-400 uppercase">Budget Bucket</label>
                                <p className="text-sm font-medium text-zinc-900">{selectedLead.budgetBucket || 'TBD'}</p>
                              </div>
                            </div>
                          </div>

                          {/* Brand Insights */}
                          <Card className="p-5 bg-zinc-50 border-zinc-200">
                            <div className="flex justify-between items-center mb-4">
                              <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                                <Zap className="w-3 h-3" />
                                Brand Perception & Strategy
                              </h4>
                              <Button 
                                variant="ghost" 
                                className="h-6 px-2 text-[10px]"
                                onClick={handleGenerateInsights}
                                disabled={isGeneratingSuggestion || !selectedLead.company}
                              >
                                Refresh
                              </Button>
                            </div>
                            {selectedLead.brandInsights ? (
                              <div className="space-y-3">
                                <p className="text-xs text-zinc-700 whitespace-pre-wrap">{selectedLead.brandInsights}</p>
                              </div>
                            ) : (
                              <p className="text-xs text-zinc-400 italic">Generate AI insights to understand the brand better.</p>
                            )}
                          </Card>

                          <div>
                            <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-3">Notes & Context</h4>
                            <Textarea 
                              className="text-sm"
                              value={selectedLead.notes || ''}
                              onChange={(e) => handleUpdateLead(selectedLead.id, { notes: e.target.value })}
                              placeholder="Add call notes, objections, or context here..."
                            />
                          </div>
                        </div>

                          {/* Intelligence Section */}
                        <div className="space-y-6">
                          {/* Call Recordings */}
                          <Card className="p-5 bg-white border-zinc-200">
                            <div className="flex justify-between items-center mb-4">
                              <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                                <Mic className="w-3 h-3" />
                                Call Recordings & Transcripts
                              </h4>
                              <div className="relative">
                                <input 
                                  type="file" 
                                  accept="audio/*" 
                                  className="absolute inset-0 opacity-0 cursor-pointer" 
                                  onChange={handleUploadAudio}
                                  disabled={isUploadingAudio}
                                />
                                <Button variant="secondary" className="h-6 px-2 text-[10px]" disabled={isUploadingAudio}>
                                  {isUploadingAudio ? 'Processing...' : 'Upload Call'}
                                </Button>
                              </div>
                            </div>
                            <div className="space-y-4 max-h-80 overflow-y-auto">
                              {selectedLead.recordings?.map((rec, idx) => (
                                <div key={idx} className="p-4 bg-zinc-50 rounded-xl border border-zinc-100 space-y-3">
                                  <div className="flex justify-between items-center">
                                    <p className="text-[10px] font-bold text-zinc-400 uppercase">{format(normalizeDate(rec.createdAt), 'MMM dd, yyyy')}</p>
                                    <audio src={rec.url} controls className="h-8 w-32" />
                                  </div>
                                  <div className="p-3 bg-white rounded-lg border border-zinc-100">
                                    <p className="text-[10px] font-bold text-purple-400 uppercase mb-1">AI Summary</p>
                                    <p className="text-xs text-zinc-700 leading-relaxed">{rec.summary}</p>
                                  </div>
                                  <details>
                                    <summary className="text-[10px] font-bold text-zinc-400 uppercase cursor-pointer hover:text-zinc-600">View Full Transcript</summary>
                                    <p className="text-xs text-zinc-500 mt-2 whitespace-pre-wrap">{rec.transcript}</p>
                                  </details>
                                </div>
                              ))}
                              {(!selectedLead.recordings || selectedLead.recordings.length === 0) && (
                                <p className="text-xs text-zinc-400 italic">No recordings uploaded yet.</p>
                              )}
                            </div>
                          </Card>

                          {/* Visual Concept */}
                          <Card className="p-5 bg-black text-white border-none overflow-hidden relative">
                            <div className="flex justify-between items-center mb-4 relative z-10">
                              <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                                <PieChart className="w-3 h-3" />
                                Visual Concept Mood Board
                              </h4>
                              <Button 
                                variant="secondary" 
                                className="h-6 px-2 text-[10px] bg-white/10 border-white/10 text-white"
                                onClick={handleGenerateVisual}
                                disabled={isGeneratingVisual}
                              >
                                {isGeneratingVisual ? 'Generating...' : 'Generate AI Visual'}
                              </Button>
                            </div>
                            {selectedLead.visualConceptUrl ? (
                              <div className="relative z-10 rounded-lg overflow-hidden border border-white/10 aspect-video">
                                <img src={selectedLead.visualConceptUrl} alt="Visual Concept" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              </div>
                            ) : (
                              <div className="relative z-10 aspect-video bg-white/5 rounded-lg border border-dashed border-white/10 flex items-center justify-center">
                                <p className="text-[10px] text-zinc-500 font-bold uppercase">No Concept Generated</p>
                              </div>
                            )}
                          </Card>

                          <Card className="p-6 bg-zinc-900 text-white border-none">
                            <div className="flex justify-between items-center mb-4">
                              <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                                <BrainCircuit className="w-3 h-3" />
                                Closure Intelligence
                              </h4>
                              <Button 
                                variant="secondary" 
                                className="h-6 px-2 text-[10px] bg-white/10 border-white/10 text-white"
                                onClick={handleRecalculateScores}
                                disabled={isCalculatingScores}
                              >
                                {isCalculatingScores ? 'Calculating...' : 'AI Recalculate'}
                              </Button>
                            </div>
                            <div className="space-y-6">
                              <div>
                                <div className="flex justify-between items-end mb-2">
                                  <span className="text-xs font-bold">Probability of Closure</span>
                                  <span className="text-2xl font-bold text-emerald-400">{selectedLead.probability || 0}%</span>
                                </div>
                                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-emerald-400 transition-all duration-1000" 
                                    style={{ width: `${selectedLead.probability || 0}%` }}
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                {selectedLead.scores && Object.entries(selectedLead.scores).map(([key, val]) => (
                                  <div key={key} className="p-3 bg-white/5 rounded-xl border border-white/10">
                                    <p className="text-[10px] font-bold text-zinc-500 uppercase mb-1">{key}</p>
                                    <p className="text-lg font-bold">{val}/10</p>
                                  </div>
                                ))}
                              </div>

                              {selectedLead.scoreJustification && (
                                <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                                  <p className="text-[10px] font-bold text-zinc-500 uppercase mb-2">AI Justification</p>
                                  <p className="text-xs text-zinc-400 italic leading-relaxed">
                                    {selectedLead.scoreJustification}
                                  </p>
                                </div>
                              )}

                              <div className="p-4 bg-emerald-400/10 border border-emerald-400/20 rounded-xl">
                                <p className="text-[10px] font-bold text-emerald-400 uppercase mb-1">Recommended Next Action</p>
                                <p className="text-sm font-medium text-zinc-200">
                                  {selectedLead.stage === 'Proposal Sent' 
                                    ? "Nudge via WhatsApp with a client testimonial relevant to their industry."
                                    : "Schedule a discovery call to lock in the budget and timeline."}
                                </p>
                              </div>
                            </div>
                          </Card>

                          <div>
                            <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-3">Follow-up Schedule</h4>
                            <div className="flex gap-2">
                              <Input 
                                type="datetime-local" 
                                className="text-xs h-10"
                                value={selectedLead.nextActionDate ? selectedLead.nextActionDate.slice(0, 16) : ''}
                                onChange={(e) => {
                                  const d = new Date(e.target.value);
                                  if (!isNaN(d.getTime())) {
                                    handleUpdateLead(selectedLead.id, { nextActionDate: d.toISOString() });
                                  }
                                }}
                              />
                              <Button variant="secondary" className="h-10 text-xs" onClick={() => handleUpdateLead(selectedLead.id, { nextActionDate: addDays(new Date(), 2).toISOString() })}>
                                +2 Days
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                ) : (
                      <div className="h-full flex flex-col items-center justify-center text-zinc-400 space-y-4">
                        <div className="p-6 bg-zinc-100 rounded-full">
                          <Users className="w-12 h-12" />
                        </div>
                        <p className="font-medium">Select a lead to view details and intelligence</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : viewMode === 'table' ? (
                <div className="flex-1 overflow-hidden flex flex-col bg-white rounded-2xl border border-zinc-100 shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-zinc-100 bg-zinc-50/50">
                          <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Lead Name</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Company</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Stage</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Temperature</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Deal Value</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Next Action</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Last Activity</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-50">
                        {filteredLeads.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-6 py-12 text-center">
                              <div className="flex flex-col items-center justify-center text-zinc-400 space-y-2">
                                <Search className="w-8 h-8 opacity-20" />
                                <p className="text-sm font-medium">No leads matching your criteria</p>
                                <div className="flex gap-2 mt-2">
                                  {filterStage !== 'All' && (
                                    <Button variant="secondary" size="sm" onClick={() => setFilterStage('All')}>
                                      Clear Stage Filter
                                    </Button>
                                  )}
                                  {searchQuery !== '' && (
                                    <Button variant="secondary" size="sm" onClick={() => { setSearchQuery(''); setSearchTerm(''); }}>
                                      Clear Search
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          filteredLeads.map(lead => (
                            <tr 
                              key={lead.id} 
                              className="hover:bg-zinc-50/80 transition-colors cursor-pointer group"
                              onClick={() => { setSelectedLead(lead); setViewMode('list'); }}
                            >
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 bg-zinc-100 rounded-lg flex items-center justify-center text-zinc-600 font-bold text-xs">
                                    {lead.leadName[0]}
                                  </div>
                                  <span className="font-bold text-zinc-900 group-hover:text-black">{lead.leadName}</span>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-sm text-zinc-500">{lead.company || '-'}</td>
                              <td className="px-6 py-4">
                                <span className="text-[10px] font-bold px-2 py-1 bg-zinc-100 rounded text-zinc-600 uppercase tracking-wider">
                                  {lead.stage}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <Badge className={TEMPERATURE_COLORS[lead.temperature]}>{lead.temperature}</Badge>
                              </td>
                              <td className="px-6 py-4 font-bold text-emerald-600 text-sm">
                                {lead.dealValue ? `₹${lead.dealValue}L` : '-'}
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex flex-col">
                                  <span className="text-xs text-zinc-900 line-clamp-1">{lead.nextAction}</span>
                                  <span className="text-[10px] text-zinc-400">{format(normalizeDate(lead.nextActionDate), 'MMM d')}</span>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-xs text-zinc-400">
                                {formatDistanceToNow(normalizeDate(lead.updatedAt))} ago
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-x-auto pb-4">
                  <div className="flex gap-6 h-full min-w-max">
                    {LEAD_STAGES.map(stage => (
                      <div key={stage} className="w-80 flex flex-col gap-4">
                        <div className="flex items-center justify-between px-2">
                          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
                            {stage}
                            <span className="text-[10px] bg-zinc-100 px-1.5 py-0.5 rounded text-zinc-500">
                              {leads.filter(l => l.stage === stage).length}
                            </span>
                          </h3>
                        </div>
                        <div className="flex-1 overflow-y-auto space-y-3 p-1">
                          {leads
                            .filter(l => l.stage === stage)
                            .filter(l => 
                              l.leadName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                              l.company?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                              l.email?.toLowerCase().includes(searchQuery.toLowerCase())
                            )
                            .map(lead => (
                              <Card 
                                key={lead.id} 
                                className="p-4 cursor-pointer hover:shadow-md transition-all border-l-4 border-l-transparent hover:border-l-black group"
                                onClick={() => { setSelectedLead(lead); setViewMode('list'); }}
                              >
                                <div className="flex justify-between items-start mb-2">
                                  <h4 className="text-sm font-bold text-zinc-900 group-hover:text-black">{lead.leadName}</h4>
                                  <Badge className={cn('text-[8px] px-1.5 py-0', TEMPERATURE_COLORS[lead.temperature])}>{lead.temperature}</Badge>
                                </div>
                                <p className="text-[10px] text-zinc-500 mb-3">{lead.company || 'Individual'}</p>
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-emerald-600">₹{lead.dealValue || 0}L</span>
                                  <span className="text-[10px] text-zinc-400">{formatDistanceToNow(normalizeDate(lead.updatedAt))} ago</span>
                                </div>
                              </Card>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'team' && profile?.role === 'admin' && (
            <div className="space-y-8">
              <Card className="p-8">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-xl font-bold">Team Members</h3>
                  <Button variant="secondary" className="text-xs">Invite Member</Button>
                </div>
                <div className="space-y-4">
                  {users.map(u => (
                    <div key={u.uid} className="flex items-center justify-between p-4 bg-zinc-50 rounded-xl border border-zinc-200">
                      <div className="flex items-center gap-4">
                        <img src={u.photoURL} className="w-10 h-10 rounded-full border border-zinc-200" alt="" />
                        <div>
                          <p className="font-bold text-zinc-900">{u.displayName}</p>
                          <p className="text-xs text-zinc-500">{u.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <Select 
                          className="w-32 h-9 text-xs font-bold"
                          value={u.role}
                          onChange={async (e) => {
                            await updateDoc(doc(db, 'users', u.uid), { role: e.target.value });
                          }}
                        >
                          <option value="admin">Admin</option>
                          <option value="sales">Sales</option>
                          <option value="creative">Creative</option>
                        </Select>
                        <Button variant="ghost" className="text-red-500 p-2">
                          <LogOut className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </div>
      </main>

      {/* Add Lead Modal */}
      {isAddingLead && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <Card className="max-w-2xl w-full p-8 space-y-8 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-2xl font-bold text-zinc-900">Add New Lead</h3>
              <div className="flex items-center gap-2">
                <label className="cursor-pointer">
                  <input type="file" className="hidden" accept=".json" onChange={handleMassUpload} />
                  <Button variant="secondary" className="h-8 text-[10px]">
                    <Upload className="w-3 h-3" />
                    Mass Upload
                  </Button>
                </label>
                <button onClick={() => setIsAddingLead(false)} className="text-zinc-400 hover:text-black">
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>
            <form onSubmit={handleAddLead} className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Lead Name *</label>
                  <Input name="leadName" required placeholder="e.g. Rahul Sharma" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Company *</label>
                  <Input name="company" required placeholder="e.g. TechFlow" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Phone *</label>
                  <Input name="phone" required placeholder="e.g. 919876543210" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Email *</label>
                  <Input name="email" type="email" required placeholder="e.g. rahul@techflow.com" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Source *</label>
                  <Select name="source" required>
                    {LEAD_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Next Action</label>
                  <Input name="nextAction" placeholder="e.g. Call for requirement" />
                </div>
              </div>
              <div className="pt-4 flex gap-3">
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setIsAddingLead(false)}>Cancel</Button>
                <Button type="submit" className="flex-1">Create Lead</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
      {/* Edit Lead Modal */}
      {isEditingLead && selectedLead && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl bg-white shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-100 flex justify-between items-center">
              <h3 className="text-xl font-bold text-zinc-900">Edit Lead Details</h3>
              <button onClick={() => setIsEditingLead(false)} className="text-zinc-400 hover:text-black">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form 
              className="p-8 space-y-6"
              onSubmit={async (e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const updates = {
                  leadName: formData.get('leadName') as string,
                  company: formData.get('company') as string,
                  email: formData.get('email') as string,
                  phone: formData.get('phone') as string,
                  dealValue: Number(formData.get('dealValue')),
                  requirementSummary: formData.get('requirementSummary') as string,
                  nextAction: formData.get('nextAction') as string,
                };
                await handleUpdateLead(selectedLead.id, updates);
                setIsEditingLead(false);
              }}
            >
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase">Lead Name</label>
                  <Input name="leadName" defaultValue={selectedLead.leadName} required />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase">Company</label>
                  <Input name="company" defaultValue={selectedLead.company} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase">Email</label>
                  <Input name="email" type="email" defaultValue={selectedLead.email} required />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase">Phone</label>
                  <Input name="phone" defaultValue={selectedLead.phone} required />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase">Deal Value (₹ Lakhs)</label>
                  <Input name="dealValue" type="number" defaultValue={selectedLead.dealValue} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase">Next Action</label>
                  <Input name="nextAction" defaultValue={selectedLead.nextAction} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-zinc-500 uppercase">Requirement Summary</label>
                <textarea 
                  name="requirementSummary"
                  defaultValue={selectedLead.requirementSummary}
                  className="w-full h-24 p-3 rounded-xl border border-zinc-200 text-sm focus:ring-2 focus:ring-black/5 outline-none"
                />
              </div>
              <div className="flex gap-4 pt-4">
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setIsEditingLead(false)}>Cancel</Button>
                <Button type="submit" variant="primary" className="flex-1">Save Changes</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
