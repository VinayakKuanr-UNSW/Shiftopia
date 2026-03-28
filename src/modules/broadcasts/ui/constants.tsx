import React from 'react';
import {
  Megaphone,
  Building2,
  Theater,
  Settings,
  AlertTriangle,
  Bell,
  MessageSquare,
  Shield,
  Crown,
  FileText,
  Image,
  FileSpreadsheet,
  File,
} from 'lucide-react';
import type {
  BroadcastPriority,
  BroadcastParticipantRole,
} from '../model/broadcast.types';

// ── Manager/large-icon variant (h-6 w-6) — used in manager GroupCard and GroupsList ──
export const GROUP_ICONS: Record<string, React.ReactNode> = {
  megaphone: <Megaphone className="h-6 w-6" />,
  settings: <Settings className="h-6 w-6" />,
  building: <Building2 className="h-6 w-6" />,
  theater: <Theater className="h-6 w-6" />,
};

// ── Employee/medium-icon variant (h-5 w-5) — used in employee broadcasts screen ──
export const GROUP_ICONS_SM: Record<string, React.ReactNode> = {
  megaphone: <Megaphone className="h-5 w-5" />,
  settings: <Settings className="h-5 w-5" />,
  building: <Building2 className="h-5 w-5" />,
  theater: <Theater className="h-5 w-5" />,
};

// ── Employee group card gradient colors (light + dark) ──
export const GROUP_COLORS: Record<string, string> = {
  blue: 'from-blue-50 via-blue-50/60 to-slate-50 border-blue-200 hover:border-blue-300 dark:from-blue-600/20 dark:via-transparent dark:to-blue-900/40 dark:border-blue-500/20 dark:hover:border-blue-500/40',
  green: 'from-emerald-50 via-emerald-50/60 to-slate-50 border-emerald-200 hover:border-emerald-300 dark:from-emerald-600/20 dark:via-transparent dark:to-emerald-900/40 dark:border-emerald-500/20 dark:hover:border-emerald-500/40',
  purple: 'from-purple-50 via-purple-50/60 to-slate-50 border-purple-200 hover:border-purple-300 dark:from-purple-600/20 dark:via-transparent dark:to-purple-900/40 dark:border-purple-500/20 dark:hover:border-purple-500/40',
  red: 'from-red-50 via-red-50/60 to-slate-50 border-red-200 hover:border-red-300 dark:from-red-600/20 dark:via-transparent dark:to-red-900/40 dark:border-red-500/20 dark:hover:border-red-500/40',
};

// ── Employee group icon background gradients ──
export const GROUP_ICON_BG: Record<string, string> = {
  blue: 'from-blue-100 to-blue-200/60 border-blue-200 dark:from-blue-500/20 dark:to-blue-600/10 dark:border-white/10',
  green: 'from-emerald-100 to-emerald-200/60 border-emerald-200 dark:from-emerald-500/20 dark:to-emerald-600/10 dark:border-white/10',
  purple: 'from-purple-100 to-purple-200/60 border-purple-200 dark:from-purple-500/20 dark:to-purple-600/10 dark:border-white/10',
  red: 'from-red-100 to-red-200/60 border-red-200 dark:from-red-500/20 dark:to-red-600/10 dark:border-white/10',
};

// ── Broadcast priority configuration ──
export const PRIORITY_CONFIG: Record<
  BroadcastPriority,
  { label: string; color: string; bg: string; icon: React.ReactNode }
> = {
  urgent: {
    label: 'Urgent',
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.2)]',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  },
  high: {
    label: 'High',
    color: 'text-orange-400',
    bg: 'bg-orange-500/10 border-orange-500/20',
    icon: <Bell className="h-3.5 w-3.5" />,
  },
  normal: {
    label: 'Normal',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/20',
    icon: <MessageSquare className="h-3.5 w-3.5" />,
  },
  low: {
    label: 'Low',
    color: 'text-slate-400',
    bg: 'bg-slate-500/10 border-slate-500/20',
    icon: <MessageSquare className="h-3.5 w-3.5" />,
  },
};

// ── Participant role icons ──
export const ROLE_ICONS: Record<BroadcastParticipantRole, React.ReactNode> = {
  admin: <Shield className="h-3 w-3 text-red-400" />,
  broadcaster: <Crown className="h-3 w-3 text-amber-400" />,
  lead: <Crown className="h-3 w-3 text-blue-400" />,
  member: null,
};

// ── File type icons for attachments ──
export const FILE_ICONS: Record<string, React.ReactNode> = {
  pdf: <FileText className="h-4 w-4 text-red-400" />,
  image: <Image className="h-4 w-4 text-green-400" />,
  document: <FileText className="h-4 w-4 text-blue-400" />,
  spreadsheet: <FileSpreadsheet className="h-4 w-4 text-emerald-400" />,
  other: <File className="h-4 w-4 text-gray-400" />,
};
