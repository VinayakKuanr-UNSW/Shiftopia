// src/pages/DashboardPage.tsx
import React, { useMemo } from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import { motion } from 'framer-motion';
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
  CalendarDays
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/modules/core/ui/primitives/card';
import { Badge } from '@/modules/core/ui/primitives/badge';
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
   ANIMATION VARIANTS
   ============================================================ */
const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
};

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
  const handleViewSchedule = () => navigate('/roster');
  const handleNewRequest = () => {
    // Placeholder for now
    console.log('New Request clicked');
  };

  return (
    <div className="space-y-4 md:space-y-8 p-1">
      {/* Welcome Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary/80 to-indigo-600 dark:from-indigo-900 dark:via-purple-900 dark:to-indigo-950 p-4 sm:p-6 md:p-10 shadow-2xl"
      >
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-black/10 rounded-full blur-2xl translate-y-1/3 -translate-x-1/3 pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <Badge variant="glass" className="mb-3 backdrop-blur-md bg-white/10 border-white/20 text-white">
              {user?.systemRole?.toUpperCase() || 'MEMBER'}
            </Badge>
            <h1 className="text-3xl md:text-5xl font-heading font-bold text-white mb-2 tracking-tight">
              Welcome back, {firstName}
            </h1>
            <p className="text-blue-100/80 text-lg max-w-xl">
              You have <span className="text-white font-semibold">{upcomingCount} upcoming shifts</span> this week.
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="glass"
              className="bg-white/10 hover:bg-white/20 border-white/20"
              onClick={handleViewSchedule}
            >
              View Schedule
            </Button>
            <Button
              variant="default"
              className="bg-white text-primary hover:bg-white/90 shadow-xl shadow-black/20"
              onClick={handleNewRequest}
              disabled
            >
              New Request
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Main Grid */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
      >
        <StatCard
          icon={<Calendar className="h-6 w-6 text-blue-400" />}
          title="Shifts This Week"
          value={isLoading ? '-' : stats.count.toString()}
          trend="Current Roster"
          trendUp={true}
          delay={0.1}
          loading={isLoading}
        />
        <StatCard
          icon={<Clock className="h-6 w-6 text-emerald-400" />}
          title="Hours Logged"
          value={isLoading ? '-' : String(stats.hours)}
          trend="This Week"
          trendUp={true}
          delay={0.2}
          loading={isLoading}
        />
        <StatCard
          icon={<Users className="h-6 w-6 text-purple-400" />}
          title="Team Members"
          value="-"
          trend="Unavailable"
          trendUp={true}
          delay={0.3}
          loading={false}
        />
        <StatCard
          icon={<Briefcase className="h-6 w-6 text-amber-400" />}
          title="Next Payday"
          value="Fri"
          trend="Weekly Cycle"
          trendUp={true}
          delay={0.4}
        />
      </motion.div>

      {/* Bento Grid Content */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 lg:gap-8">
        {/* Left Column (2/3) */}
        <div className="md:col-span-2 lg:col-span-2 space-y-8">
          {/* Upcoming Shifts */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <Card className="h-full border-white/5 bg-card/50 backdrop-blur-xl">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-xl">Upcoming Shifts</CardTitle>
                  <CardDescription>Your schedule for the next few days</CardDescription>
                </div>
                <Button variant="ghost" size="sm" className="gap-1" onClick={handleViewSchedule}>
                  View All <ArrowRight className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading schedule...</div>
                ) : displayShifts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No upcoming shifts scheduled.
                    <div className="mt-2">
                      <Button variant="link" onClick={handleViewSchedule}>Check Roster</Button>
                    </div>
                  </div>
                ) : (
                  displayShifts.map((shift) => (
                    <ShiftItem
                      key={shift.id}
                      shift={shift}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Manager Quick View (Conditional) */}
          {(user?.systemRole === 'admin' || user?.systemRole === 'manager') && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
            >
              <Card className="border-white/5 bg-gradient-to-br from-card/80 to-card/40 backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="text-xl">Manager Overview</CardTitle>
                  <CardDescription>Quick actions and status updates</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-primary/10 border border-primary/20 flex flex-col items-center justify-center text-center">
                    <span className="text-3xl font-bold text-primary">-</span>
                    <span className="text-sm text-primary/80 font-medium mt-1">Open Shifts</span>
                  </div>
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex flex-col items-center justify-center text-center">
                    <span className="text-3xl font-bold text-amber-500">-</span>
                    <span className="text-sm text-amber-500/80 font-medium mt-1">Pending items</span>
                  </div>
                  <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex flex-col items-center justify-center text-center">
                    <span className="text-3xl font-bold text-emerald-500">-</span>
                    <span className="text-sm text-emerald-500/80 font-medium mt-1">Coverage</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </div>

        {/* Right Column (1/3) */}
        <div className="space-y-8">
          {/* Recent Activity */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6 }}
          >
            <Card className="h-full border-white/5 bg-card/30 backdrop-blur-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5 text-primary" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="relative border-l border-white/10 ml-3 space-y-4 md:space-y-8 py-2">
                  <ActivityItem
                    icon={<CheckCircle className="h-4 w-4 text-emerald-400" />}
                    title="System Update"
                    time="Just now"
                    description="Dashboard has been updated with real-time data."
                  />
                  {/* Real activity feed to be implemented */}
                </div>
              </CardContent>
            </Card>
          </motion.div>
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
  <motion.div variants={item} className="h-full">
    <Card className="h-full border-white/5 bg-card/40 backdrop-blur-lg hover:bg-card/60 transition-colors group">
      <CardContent className="p-6">
        <div className="flex justify-between items-start mb-4">
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-primary group-hover:scale-110 transition-transform duration-300">
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
    <div className="group flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all duration-300">
      <div className="flex-shrink-0 flex flex-col items-center justify-center w-14 h-14 rounded-lg bg-black/20 border border-white/5 text-center">
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
          <span className="hidden sm:inline w-1 h-1 rounded-full bg-white/20" />
          <span className="flex items-center gap-1 truncate"><MapPin className="h-3.5 w-3.5" /> {location}</span>
        </div>
      </div>
    </div>
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
    <div className="absolute left-[-5px] top-1 p-1 rounded-full bg-card border border-white/10 z-10 shadow-sm">
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
