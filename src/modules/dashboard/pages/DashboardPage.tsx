// src/pages/DashboardPage.tsx
import React, { useMemo } from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import { motion, AnimatePresence } from 'framer-motion';
import { pageVariants, itemVariants, cardInteractive, listItemSpring } from '@/modules/core/ui/motion/presets';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  Clock,
  Users,
  Bell,
  TrendingUp,
  CheckCircle,
  AlertCircle,
  Briefcase,
  ArrowRight,
  MapPin,
  CalendarDays,
  RefreshCw,
  Plus,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/modules/core/ui/primitives/card';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { useEmployeeShifts } from '@/modules/rosters/state/useRosterShifts';
import {
  startOfWeek,
  endOfWeek,
  format,
  addDays,
  startOfDay,
  isSameDay,
  parseISO,
  isAfter,
  isBefore
} from 'date-fns';
import { Shift } from '@/modules/rosters/domain/shift.entity';

/* ============================================================
   ANIMATION VARIANTS — imported from presets
   ============================================================ */

/* ============================================================
   DASHBOARD PAGE COMPONENT
   ============================================================ */
const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const firstName = user?.firstName || 'User';

  // Date Calculations
  const today = useMemo(() => startOfDay(new Date()), []);
  const weekStart = useMemo(() => startOfWeek(today, { weekStartsOn: 1 }), [today]); // Monday start
  const weekEnd = useMemo(() => endOfWeek(today, { weekStartsOn: 1 }), [today]);
  const nextWeekEnd = useMemo(() => addDays(today, 14), [today]); // Fetch 2 weeks out for upcoming

  // Data Fetching
  const { data: weeklyShifts, isLoading: isLoadingWeekly } = useEmployeeShifts(
    user?.id || null,
    format(weekStart, 'yyyy-MM-dd'),
    format(weekEnd, 'yyyy-MM-dd')
  );

  const { data: upcomingShifts, isLoading: isLoadingUpcoming } = useEmployeeShifts(
    user?.id || null,
    format(today, 'yyyy-MM-dd'),
    format(nextWeekEnd, 'yyyy-MM-dd')
  );

  // Stats Calculation
  const stats = useMemo(() => {
    if (!weeklyShifts) return { count: 0, hours: 0, trend: 0 };

    // Filter out cancelled shifts
    const activeShifts = weeklyShifts.filter(s => !s.is_cancelled);

    const count = activeShifts.length;
    const hours = activeShifts.reduce((acc, shift) => {
      return acc + ((shift.net_length_minutes || 0) / 60);
    }, 0);

    return { count, hours: hours.toFixed(1) };
  }, [weeklyShifts]);

  // Process Upcoming Shifts (Next 7 Days, sorted)
  const displayShifts = useMemo(() => {
    if (!upcomingShifts) return [];

    return upcomingShifts
      .filter(s => !s.is_cancelled)
      .sort((a, b) => new Date(a.shift_date).getTime() - new Date(b.shift_date).getTime())
      .slice(0, 5); // Show top 5
  }, [upcomingShifts]);

  const upcomingCount = displayShifts.length;
  const isLoading = isLoadingWeekly || isLoadingUpcoming;

  // Actions
  const handleViewSchedule = () => navigate('/my-roster');
  const handleNewRequest = () => {
    // Placeholder for now
    console.log('New Request clicked');
  };

  const { isDark } = useTheme();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Unified Header ────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 pt-4 pb-4 lg:pb-6">
        <div className={cn(
          "rounded-[32px] p-4 lg:p-6 transition-all border",
          isDark 
            ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
            : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
          {/* Row 1 & 2: Identity & Scope Filter */}
          <PersonalPageHeader
            title={`Welcome back, ${firstName}`}
            Icon={TrendingUp}
            rightActions={
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="rounded-xl font-black uppercase tracking-widest text-[10px]"
                  onClick={() => window.location.reload()}
                >
                  <RefreshCw className="h-3 w-3 mr-2" />
                  Refresh
                </Button>
                <Button 
                  className="rounded-xl font-black uppercase tracking-widest text-[10px] bg-primary text-white shadow-lg shadow-primary/20"
                  onClick={handleViewSchedule}
                >
                  My Roster
                </Button>
              </div>
            }
            className="mb-4 lg:mb-6"
          />

          {/* Row 3: Quick Stats Function Bar */}
          <div className={cn(
            "flex flex-wrap items-center gap-4 lg:gap-8 p-1 rounded-2xl",
            isDark ? "bg-black/20" : "bg-white/60 border border-slate-200/50 shadow-inner"
          )}>
             <div className="flex items-center gap-4 px-4 py-2">
                <div className="flex flex-col">
                  <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Weekly Shifts</span>
                  <span className="text-sm font-black text-foreground">{isLoading ? '...' : stats.count}</span>
                </div>
                <div className="h-8 w-[1px] bg-border/20 mx-2" />
                <div className="flex flex-col">
                  <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Hours Logged</span>
                  <span className="text-sm font-black text-foreground">{isLoading ? '...' : stats.hours}</span>
                </div>
                <div className="h-8 w-[1px] bg-border/20 mx-2" />
                <div className="flex flex-col">
                  <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Upcoming</span>
                  <span className="text-sm font-black text-foreground">{upcomingCount}</span>
                </div>
             </div>

             <div className="ml-auto flex items-center gap-2 pr-2">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="rounded-lg font-black uppercase tracking-widest text-[9px] text-primary"
                  onClick={handleNewRequest}
                  disabled
                >
                  <Plus className="h-3 w-3 mr-2" />
                  New Request
                </Button>
             </div>
          </div>
        </div>
      </div>

      {/* ── Main Content Area ─────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden pt-2 lg:pt-4">
        <div className={cn(
          "h-full rounded-[32px] overflow-auto transition-all border p-6 lg:p-10 scrollbar-none",
          isDark 
            ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
            : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
          <div className="max-w-7xl mx-auto space-y-10">
            {/* Bento Grid Content */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left Side: Schedule & Activity (2/3) */}
              <div className="lg:col-span-2 space-y-8">
                <section>
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-muted-foreground/40">Upcoming Schedule</h3>
                    <Button variant="link" size="sm" className="text-primary font-black text-[10px] uppercase tracking-widest" onClick={handleViewSchedule}>
                      View Full Roster <ArrowRight className="ml-2 h-3 w-3" />
                    </Button>
                  </div>
                  
                  {isLoading ? (
                    <div className="grid gap-4">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="h-24 w-full bg-primary/5 rounded-2xl animate-pulse" />
                      ))}
                    </div>
                  ) : displayShifts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 bg-muted/10 rounded-3xl border border-dashed border-border/40">
                      <CalendarDays className="h-10 w-10 text-muted-foreground/20 mb-4" />
                      <p className="text-sm font-black uppercase tracking-widest text-muted-foreground/40">No upcoming shifts</p>
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      {displayShifts.map((shift) => (
                        <ShiftItem key={shift.id} shift={shift} />
                      ))}
                    </div>
                  )}
                </section>

                {(user?.systemRole === 'admin' || user?.systemRole === 'manager') && (
                  <section>
                    <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-muted-foreground/40 mb-6">Managerial Insights</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className={cn(
                        "p-6 rounded-2xl border transition-all hover:scale-[1.02]",
                        isDark ? "bg-primary/10 border-primary/20" : "bg-primary/5 border-primary/10"
                      )}>
                        <span className="text-3xl font-black text-primary">-</span>
                        <p className="text-[10px] font-black uppercase tracking-widest text-primary/60 mt-1">Open Shifts</p>
                      </div>
                      <div className={cn(
                        "p-6 rounded-2xl border transition-all hover:scale-[1.02]",
                        isDark ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-500/5 border-amber-500/10"
                      )}>
                        <span className="text-3xl font-black text-amber-500">-</span>
                        <p className="text-[10px] font-black uppercase tracking-widest text-amber-500/60 mt-1">Pending Bids</p>
                      </div>
                      <div className={cn(
                        "p-6 rounded-2xl border transition-all hover:scale-[1.02]",
                        isDark ? "bg-emerald-500/10 border-emerald-500/20" : "bg-emerald-500/5 border-emerald-500/10"
                      )}>
                        <span className="text-3xl font-black text-emerald-500">-</span>
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500/60 mt-1">Team Coverage</p>
                      </div>
                    </div>
                  </section>
                )}
              </div>

              {/* Right Side: Activity & Pulse (1/3) */}
              <div className="space-y-8">
                <section className={cn(
                  "h-full rounded-3xl border p-6",
                  isDark ? "bg-white/[0.02] border-white/5" : "bg-slate-50/50 border-slate-100 shadow-inner"
                )}>
                  <div className="flex items-center gap-3 mb-8">
                    <div className="p-2 rounded-xl bg-primary/10">
                      <Bell className="h-4 w-4 text-primary" />
                    </div>
                    <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground/60">Live Activity</h3>
                  </div>

                  <div className="relative border-l-2 border-border/20 ml-3 space-y-8 pl-6 py-2">
                    <ActivityItem
                      icon={<CheckCircle className="h-4 w-4 text-emerald-500" />}
                      title="System Ready"
                      time="Just now"
                      description="Roster engine optimized for current venue load."
                    />
                    <ActivityItem
                      icon={<Clock className="h-4 w-4 text-primary" />}
                      title="Auto-Pilot Active"
                      time="15m ago"
                      description="Smart bidding thresholds updated for next week."
                    />
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   HELPER COMPONENTS
   ============================================================ */

interface StatCardProps {
  icon: React.ReactNode;
  title: string;
  value: string;
  trend: string;
  trendUp?: boolean;
  delay?: number;
  loading?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ icon, title, value, trend, trendUp, delay = 0, loading }) => (
  <motion.div variants={itemVariants} {...cardInteractive} className="h-full">
    <Card className="h-full border-border bg-card/40 backdrop-blur-lg hover:bg-card/60 transition-colors group">
      <CardContent className="p-6">
        <div className="flex justify-between items-start mb-4">
          <div className="p-3 rounded-xl bg-muted/40 border border-border text-primary group-hover:scale-110 transition-transform duration-300">
            {icon}
          </div>
          {trendUp !== undefined && (
            <Badge variant={trendUp ? 'success' : 'warning'} className="bg-opacity-10">
              {trendUp ? <TrendingUp className="h-3 w-3 mr-1" /> : <AlertCircle className="h-3 w-3 mr-1" />}
              {trendUp ? '' : 'Attn'}
            </Badge>
          )}
        </div>
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-1">{title}</h3>
          <div className="text-3xl font-bold font-heading tracking-tight mb-1">
            {loading ? <span className="animate-pulse">...</span> : value}
          </div>
          <p className="text-xs text-muted-foreground/60">{trend}</p>
        </div>
      </CardContent>
    </Card>
  </motion.div>
);

interface ShiftItemProps {
  shift: Shift;
}

const ShiftItem: React.FC<ShiftItemProps> = ({ shift }) => {
  const dateObj = parseISO(shift.shift_date);
  const dayName = isSameDay(dateObj, new Date()) ? 'Today' : format(dateObj, 'EEEE');
  const dayDate = format(dateObj, 'MMM d');
  const status = shift.lifecycle_status === 'Published' ? 'confirmed' : 'pending';

  // Normalize role name
  const roleName = shift.role_id ? (shift.roles?.name || 'Assigned Role') : 'Unassigned';

  // Normalize location (Department / SubDepartment)
  const location = shift.departments?.name || shift.sub_departments?.name || 'Main Venue';

  return (
    <motion.div
      {...listItemSpring}
      {...cardInteractive}
      className="group flex items-center gap-4 p-4 rounded-xl bg-muted/20 border border-border hover:bg-muted/40 hover:border-border/80 transition-colors duration-300"
    >
      <div className="flex-shrink-0 flex flex-col items-center justify-center w-14 h-14 rounded-lg bg-muted/40 border border-border text-center">
        <span className="text-[10px] text-muted-foreground uppercase font-bold">{dayDate.split(' ')[0]}</span>
        <span className="text-lg font-bold text-foreground">{dayDate.split(' ')[1]}</span>
      </div>

      <div className="flex-grow min-w-0">
        <div className="flex items-center justify-between mb-1">
          <h4 className="font-semibold text-foreground truncate">{roleName}</h4>
          <Badge variant={status === 'confirmed' ? 'success' : 'warning'}>
            {status}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1 min-w-fit">
            <CalendarDays className="h-3.5 w-3.5" /> {dayName}
          </span>
          <span className="flex items-center gap-1 min-w-fit">
            <Clock className="h-3.5 w-3.5" /> {shift.start_time.slice(0, 5)} - {shift.end_time.slice(0, 5)}
          </span>
          <span className="hidden sm:inline w-1 h-1 rounded-full bg-muted-foreground/30" />
          <span className="flex items-center gap-1 truncate"><MapPin className="h-3.5 w-3.5" /> {location}</span>
        </div>
      </div>
    </motion.div>
  );
};

interface ActivityItemProps {
  icon: React.ReactNode;
  title: string;
  time: string;
  description: string;
}

const ActivityItem: React.FC<ActivityItemProps> = ({ icon, title, time, description }) => (
  <div className="relative pl-8">
    <div className="absolute left-[-5px] top-1 p-1 rounded-full bg-card border border-border z-10 shadow-sm">
      {icon}
    </div>
    <div>
      <div className="flex items-center justify-between mb-1">
        <h5 className="font-medium text-sm text-foreground">{title}</h5>
        <span className="text-xs text-muted-foreground">{time}</span>
      </div>
      <p className="text-xs text-muted-foreground/80 leading-relaxed">
        {description}
      </p>
    </div>
  </div>
);

export default DashboardPage;
