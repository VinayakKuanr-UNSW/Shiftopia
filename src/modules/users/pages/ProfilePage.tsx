import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/platform/auth/useAuth';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
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
  ChevronRight,
} from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { useToast } from '@/modules/core/hooks/use-toast';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageLayout } from '@/modules/core/ui/layout/PageLayout';
import { ToolbarRow, ToolbarIconButton, toolbar } from '@/modules/core/ui/components/Toolbar';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { page, surface } from '@/modules/core/ui/layout/pageTokens';
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
    <PageLayout
      variants={pageVariants}
      initial="hidden"
      animate="show"
      className="text-foreground"
    >
      {/* ── Unified Header ────────────────────────────────────────────── */}
      <GoldStandardHeader
        title="My Profile"
        Icon={UserCircle}
        functionBar={
          // Identity is information, not a control; Edit and Refresh are zone-3 actions.
          <ToolbarRow
            actions={<>
              <span className="inline-flex min-w-0 items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                <Mail className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="truncate">{user?.email}</span>
              </span>
              <button
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                aria-pressed={isEditing}
                className={cn(toolbar.secondaryAction, isEditing && toolbar.secondaryActionOn)}
              >
                {isEditing ? 'Cancel' : 'Edit Profile'}
              </button>
              <ToolbarIconButton
                icon={<RefreshCw />}
                tooltip="Refresh profile"
                onClick={() => toast({ title: 'Refreshed', description: 'Profile data updated.' })}
                variant="blue"
              />
            </>}
          />
        }
      />

      <div className="flex-1 min-h-0 overflow-hidden">
        <div className={cn(
            "h-full overflow-y-auto scrollbar-none",
            page.bodyInset,
            surface.bodyCard
        )}>
          {/* Identity — one compact row. The body card already pads; the hero
              used to add px-8 py-10 of its own on top. */}
          <motion.div variants={itemVariants} className="flex items-center gap-4 border-b border-border/60 pb-6">
            <div className="relative shrink-0">
              <div className="h-20 w-20 rounded-full bg-gradient-to-br from-primary via-purple-500 to-indigo-600 p-[3px]">
                <Avatar className="h-full w-full border-[3px] border-card">
                  <AvatarImage src={user?.avatar} className="object-cover" />
                  <AvatarFallback className="bg-muted text-[20px] font-bold text-primary">
                    {user?.name?.charAt(0) || 'U'}
                  </AvatarFallback>
                </Avatar>
              </div>
              <button className="absolute -bottom-0.5 -right-0.5 rounded-full border border-card bg-primary p-1.5 text-primary-foreground shadow-sm hover:bg-primary/90" aria-label="Change photo">
                <Camera size={14} aria-hidden="true" />
              </button>
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[24px] font-bold tracking-tight text-foreground">{user?.firstName} {user?.lastName}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{user?.email || 'No email'}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                  Active
                </span>
              </div>
            </div>
          </motion.div>

          <div className="space-y-6 pt-6">
            {isEditing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[13px] text-muted-foreground mb-1.5 block">
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
                    <label className="text-[13px] text-muted-foreground mb-1.5 block">
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
            ) : null}

            {/* ACTIVITY — live numbers from get_employee_quarterly_performance via usePerformanceMetrics */}
            <ProfilePerformanceSection userId={user?.id} />

          </div>
        </div>
      </div>
    </PageLayout>
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
    <motion.div variants={itemVariants} className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-[15px] font-bold tracking-tight text-foreground">Performance overview</h3>
          <p className="text-[11px] text-muted-foreground">Live snapshot for Q{quarter} {year}</p>
        </div>
        <Link
          to="/performance"
          className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
        >
          Detailed scorecard <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {!isLoading && !data ? (
        <div className="rounded-2xl border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
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
