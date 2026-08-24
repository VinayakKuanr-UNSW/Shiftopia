import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/platform/auth/useAuth';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/modules/core/ui/primitives/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import {
  Camera,
  Mail,
  Building,
  UserCircle,
  Shield,
  Calendar,
  Shuffle,
  X,
  Hourglass,
  CheckCircle2,
  TrendingUp,
  ChevronRight,
} from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { motion, type Variants } from 'framer-motion';
import {
  usePerformanceMetrics,
  getCurrentQuarter,
  type EmployeeMetricsSnapshot,
} from '@/modules/users/hooks/usePerformanceMetrics';
import { statusFor, formatMetric, METRIC_REGISTRY } from '@/modules/insights/model/metric-registry';
import { KpiTile } from '@/modules/core/ui/components/KpiTile';

// ── Motion variants ────────────────────────────────────────────────────────────
const pageVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { ease: [0.16, 1, 0.3, 1], duration: 0.4 } },
};
const cardInteractive = {
  whileHover: { y: -2, transition: { duration: 0.15 } },
  whileTap: { scale: 0.98, transition: { duration: 0.1 } },
};

const ProfilePage: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { isDark } = useTheme();


  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: user?.email || '',
  });

  const handleSave = () => {
    toast({
      title: 'Profile Updated',
      description: 'Your profile has been updated successfully.',
    });
    setIsEditing(false);
  };

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="show"
      className="h-full flex flex-col w-full text-foreground overflow-hidden space-y-4"
    >
      {/* ── Unified Header ────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 -mx-4 px-4 md:-mx-8 md:px-8 pt-4 pb-4 lg:pb-6">
        <div className={cn(
            "rounded-[32px] p-4 lg:p-6 transition-all border relative overflow-hidden",
            isDark
                ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20 backdrop-blur-xl"
                : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-white/5 to-transparent" />
          {/* Row 1 & 2: Identity & Title */}
          <PersonalPageHeader
            title="My Profile"
            Icon={UserCircle}
            className="mb-4 lg:mb-6"
          />

          {/* Row 3: Function Bar */}
          <div className={cn(
            "flex flex-row items-center gap-2 w-full transition-all p-1.5 rounded-2xl border overflow-hidden",
            isDark 
                ? "bg-[#111827]/60 backdrop-blur-md border-white/5 shadow-inner shadow-black/20" 
                : "bg-slate-100/50 border-slate-200/50"
          )}>
            <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto scrollbar-none py-0.5">
              {/* Quick Info Chip */}
              <div className={cn(
                "h-10 lg:h-11 px-4 rounded-xl flex items-center gap-2 flex-shrink-0",
                isDark ? "bg-[#111827]/60" : "bg-white shadow-sm border border-slate-200/50"
              )}>
                <Mail className="h-4 w-4 text-primary" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  {user?.email}
                </span>
              </div>

              <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />

              {/* Edit Profile Button */}
              <Button
                onClick={() => setIsEditing(!isEditing)}
                className={cn(
                  "flex-shrink-0 gap-2 h-10 lg:h-11 px-6 rounded-xl font-bold uppercase text-[11px] tracking-wider transition-all shadow-sm",
                  isDark 
                    ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20" 
                    : "bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100"
                )}
              >
                {isEditing ? 'Cancel' : 'Edit Profile'}
              </Button>

              <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />

              {/* Refresh Button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => toast({ title: 'Refreshed', description: 'Profile data updated.' })}
                className={cn(
                    "h-10 w-10 lg:h-11 lg:w-11 rounded-xl flex-shrink-0 transition-all",
                    isDark 
                        ? "bg-[#111827]/60 text-muted-foreground hover:text-white" 
                        : "bg-slate-200/50 text-slate-500 hover:text-slate-900 hover:bg-slate-200"
                )}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <div className={cn(
            "h-full rounded-[32px] border transition-all overflow-y-auto p-4 lg:p-8 scrollbar-none",
            isDark 
                ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
          {/* Profile Header Card (Internal content) */}
          <motion.div
            variants={itemVariants}
            className="relative overflow-hidden border-b border-border/10"
          >
            <div className="relative z-10 px-8 py-10 flex flex-col md:flex-row items-center md:items-start gap-8">
              {/* Avatar Section */}
              <div className="relative">
                <div className="w-32 h-32 rounded-full p-1 bg-gradient-to-br from-primary via-purple-500 to-indigo-600">
                  <Avatar className="w-full h-full border-4 border-card">
                    <AvatarImage src={user?.avatar} className="object-cover" />
                    <AvatarFallback className="bg-muted text-3xl font-bold text-primary">
                      {user?.name?.charAt(0) || 'U'}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <button className="absolute bottom-1 right-1 p-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-lg border border-card">
                  <Camera size={16} />
                </button>
              </div>

              {/* User Info Section */}
              <div className="flex-1 text-center md:text-left space-y-2 pt-2">
                <div className="flex flex-col md:flex-row items-center md:items-start justify-between gap-4">
                  <div>
                    <h1 className="text-4xl font-black tracking-tight text-foreground">{user?.firstName} {user?.lastName}</h1>
                    <div className="flex items-center justify-center md:justify-start gap-2 mt-2">
                      <span className="text-muted-foreground font-medium italic">
                        {user?.email}
                      </span>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </motion.div>

          <CardContent className="px-4 py-6 md:px-8 md:py-8">
            {isEditing ? (
              <div className="space-y-4 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-muted-foreground mb-1.5 block">
                      Name
                    </label>
                    <Input
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1.5 block">
                      Email
                    </label>
                    <Input
                      value={formData.email}
                      onChange={(e) =>
                        setFormData({ ...formData, email: e.target.value })
                      }
                      disabled
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleSave}
                    className="bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20"
                  >
                    Save Changes
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {/* CONTACT INFO COLUMN */}
                <motion.div
                  variants={itemVariants}
                >
                  <div className="space-y-6">
                    <div>
                      <div className="font-mono uppercase tracking-[0.2em] text-[11px] text-muted-foreground mb-2">
                        Personal Information
                      </div>
                      <div className="space-y-2 text-foreground">
                        <div className="flex items-center">
                          <Mail className="w-4 h-4 mr-2 text-muted-foreground" />
                          <span>{user?.email || 'No Email'}</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="font-mono uppercase tracking-[0.2em] text-[11px] text-muted-foreground mb-2">
                        Account Details
                      </div>
                      <div className="space-y-2 text-foreground">
                        <div className="flex items-center">
                          <div className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />
                          <span>Currently Active</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>

              </div>
            )}

            {/* ACTIVITY — live numbers from get_employee_quarterly_performance via usePerformanceMetrics */}
            <ProfilePerformanceSection userId={user?.id} />

            <motion.div variants={itemVariants} className="mt-8">
              <Link
                to="/performance"
                className="group flex items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="flex items-center gap-4">
                  <div className="rounded-xl bg-primary/10 p-3 text-primary">
                    <TrendingUp className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="text-lg font-black tracking-tight text-foreground">My Performance</h4>
                    <p className="text-sm text-muted-foreground">
                      Attendance, bids, swaps and cancellations for the quarter.
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </motion.div>
          </CardContent>
        </div>
      </div>
    </motion.div>
  );
};

/**
 * A four-tile snapshot of the signed-in person's own quarter, linking to the
 * full scorecard on /performance.
 *
 * Grades through `statusFor` rather than inline comparisons. The first draft of
 * this section hard-coded its own bands and got punctuality wrong — 90/75 here
 * against the registry's 95/85 — which would have made this the sixth rival
 * threshold table in the codebase, three commits after the other five were
 * consolidated. It also imported statusFor and formatMetric without using them.
 *
 * Reading the registry means this snapshot, the Performance page and the
 * manager's KPI dashboard cannot disagree about whether a number is healthy.
 */
const PROFILE_TILES = [
    {
        metricId: 'shifts_worked',
        label: 'Shifts worked',
        value: (m: EmployeeMetricsSnapshot) => m.shifts_worked,
        denominator: (m: EmployeeMetricsSnapshot) => `${m.shifts_assigned} assigned`,
    },
    {
        metricId: 'punctuality_rate',
        label: 'Attendance',
        value: (m: EmployeeMetricsSnapshot) => m.punctuality_rate,
        denominator: () => 'On time in and out',
    },
    {
        metricId: 'reliability_score',
        label: 'Reliability',
        value: (m: EmployeeMetricsSnapshot) => m.reliability_score,
        denominator: () => 'Composite score',
    },
    {
        metricId: 'acceptance_rate',
        label: 'Offer accept',
        value: (m: EmployeeMetricsSnapshot) => m.acceptance_rate,
        denominator: (m: EmployeeMetricsSnapshot) => `${m.shifts_accepted} of ${m.total_offers} offers`,
    },
] as const;

const ProfilePerformanceSection: React.FC<{ userId?: string }> = ({ userId }) => {
  const { year, quarter } = getCurrentQuarter();
  const { data, isLoading } = usePerformanceMetrics(userId || '', `Q${quarter}_${year}`);

  return (
    <motion.div variants={itemVariants} className="mt-8 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold tracking-tight text-foreground">Performance overview</h3>
          <p className="text-xs text-muted-foreground">Live snapshot for Q{quarter} {year}</p>
        </div>
        <Link
          to="/performance"
          className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          Detailed scorecard <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {!isLoading && !data ? (
        <div className="rounded-2xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No shifts worked or recorded in Q{quarter} {year} yet.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PROFILE_TILES.map((tile) => {
            const raw = data ? tile.value(data) : undefined;
            return (
              <KpiTile
                key={tile.metricId}
                label={tile.label}
                value={isLoading || raw === undefined ? null : formatMetric(tile.metricId, raw)}
                status={statusFor(tile.metricId, raw ?? Number.NaN)}
                denominator={data ? tile.denominator(data) : undefined}
                tooltip={METRIC_REGISTRY[tile.metricId]?.description}
                loading={isLoading}
              />
            );
          })}
        </div>
      )}
    </motion.div>
  );
};

export default ProfilePage;
