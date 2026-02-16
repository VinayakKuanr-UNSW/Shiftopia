// src/pages/DashboardPage.tsx
import React from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import { motion } from 'framer-motion';
import {
  Calendar,
  Clock,
  Users,
  Bell,
  TrendingUp,
  CheckCircle,
  AlertCircle,
  Briefcase,
  ArrowRight
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/modules/core/ui/primitives/card';
import { Badge } from '@/modules/core/ui/primitives/badge';

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
  const firstName = user?.firstName || 'User';

  return (
    <div className="space-y-8 p-1">
      {/* Welcome Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary/80 to-indigo-600 dark:from-indigo-900 dark:via-purple-900 dark:to-indigo-950 p-8 md:p-10 shadow-2xl"
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
              You have <span className="text-white font-semibold">2 upcoming shifts</span> and <span className="text-white font-semibold">3 notifications</span> waiting for you.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="glass" className="bg-white/10 hover:bg-white/20 border-white/20">
              View Schedule
            </Button>
            <Button variant="default" className="bg-white text-primary hover:bg-white/90 shadow-xl shadow-black/20">
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
          value="5"
          trend="+1 from last week"
          trendUp={true}
          delay={0.1}
        />
        <StatCard
          icon={<Clock className="h-6 w-6 text-emerald-400" />}
          title="Hours Logged"
          value="32.5"
          trend="On track (160h goal)"
          trendUp={true}
          delay={0.2}
        />
        <StatCard
          icon={<Users className="h-6 w-6 text-purple-400" />}
          title="Team Members"
          value="24"
          trend="3 active now"
          trendUp={true}
          delay={0.3}
        />
        <StatCard
          icon={<Briefcase className="h-6 w-6 text-amber-400" />}
          title="Next Payday"
          value="Feb 1"
          trend="6 days remaining"
          trendUp={true}
          delay={0.4}
        />
      </motion.div>

      {/* Bento Grid Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column (2/3) */}
        <div className="lg:col-span-2 space-y-8">
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
                  <CardDescription>Your schedule for the next 7 days</CardDescription>
                </div>
                <Button variant="ghost" size="sm" className="gap-1">
                  View All <ArrowRight className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <ShiftItem
                  day="Today"
                  date="Jan 24"
                  time="09:00 - 17:00"
                  role="Event Coordinator"
                  location="Hall 4, ICC Sydney"
                  status="confirmed"
                />
                <ShiftItem
                  day="Tomorrow"
                  date="Jan 25"
                  time="14:00 - 22:00"
                  role="Floor Manager"
                  location="Grand Ballroom"
                  status="confirmed"
                />
                <ShiftItem
                  day="Monday"
                  date="Jan 28"
                  time="08:00 - 16:00"
                  role="Safety Officer"
                  location="Exhibition Centre"
                  status="pending"
                />
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
                    <span className="text-3xl font-bold text-primary">12</span>
                    <span className="text-sm text-primary/80 font-medium mt-1">Open Shifts</span>
                  </div>
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex flex-col items-center justify-center text-center">
                    <span className="text-3xl font-bold text-amber-500">5</span>
                    <span className="text-sm text-amber-500/80 font-medium mt-1">Pending items</span>
                  </div>
                  <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex flex-col items-center justify-center text-center">
                    <span className="text-3xl font-bold text-emerald-500">98%</span>
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
                <div className="relative border-l border-white/10 ml-3 space-y-8 py-2">
                  <ActivityItem
                    icon={<CheckCircle className="h-4 w-4 text-emerald-400" />}
                    title="Timesheet Approved"
                    time="2 hours ago"
                    description="Your timesheet for Jan 20-24 has been approved."
                  />
                  <ActivityItem
                    icon={<Bell className="h-4 w-4 text-blue-400" />}
                    title="New Broadcast"
                    time="5 hours ago"
                    description="New safety protocols have been updated for Hall 7."
                  />
                  <ActivityItem
                    icon={<AlertCircle className="h-4 w-4 text-amber-400" />}
                    title="Shift Request"
                    time="Yesterday"
                    description="Your swap request for Feb 2 is still pending."
                  />
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
}

const StatCard: React.FC<StatCardProps> = ({ icon, title, value, trend, trendUp, delay = 0 }) => (
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
          <div className="text-3xl font-bold font-heading tracking-tight mb-1">{value}</div>
          <p className="text-xs text-muted-foreground/60">{trend}</p>
        </div>
      </CardContent>
    </Card>
  </motion.div>
);

interface ShiftItemProps {
  day: string;
  date: string;
  time: string;
  role: string;
  location: string;
  status: 'confirmed' | 'pending';
}

const ShiftItem: React.FC<ShiftItemProps> = ({ day, date, time, role, location, status }) => (
  <div className="group flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all duration-300">
    <div className="flex-shrink-0 flex flex-col items-center justify-center w-14 h-14 rounded-lg bg-black/20 border border-white/5 text-center">
      <span className="text-[10px] text-muted-foreground uppercase font-bold">{date.split(' ')[0]}</span>
      <span className="text-lg font-bold text-foreground">{date.split(' ')[1]}</span>
    </div>

    <div className="flex-grow min-w-0">
      <div className="flex items-center justify-between mb-1">
        <h4 className="font-semibold text-foreground truncate">{role}</h4>
        <Badge variant={status === 'confirmed' ? 'success' : 'warning'}>
          {status}
        </Badge>
      </div>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {time}</span>
        <span className="hidden sm:inline w-1 h-1 rounded-full bg-white/20" />
        <span className="flex items-center gap-1 truncate"><Briefcase className="h-3.5 w-3.5" /> {location}</span>
      </div>
    </div>
  </div>
);

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
