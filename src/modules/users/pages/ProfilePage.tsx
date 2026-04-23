import React, { useState } from 'react';
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
} from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { motion, type Variants } from 'framer-motion';

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

// Utility function for shift-completion percentage
const calcShiftCompletion = (completed: number, total: number) => {
  if (total === 0) return 0;
  return ((completed / total) * 100).toFixed(0);
};

const ProfilePage: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { isDark } = useTheme();

  // Basic user stats
  const userStats = {
    totalShifts: 156,
    completedShifts: 148,
    upcomingShifts: 8,
    joinDate: '2023-01-15',
    lastActive: 'Today at 2:30 PM',
  };

  // Monthly metrics data
  const monthlyStats = {
    offered: 40,
    accepted: 32,
    rejected: 8,
    upcoming: 5,
    swapped: { success: 2, fail: 1 },
    cancelled: { normal: 4, late: 2, lateLate: 1 },
    bidded: { success: 3, fail: 1 },
  };

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

  // Compute shift completion percentage for optional progress bar
  const completionPercent = calcShiftCompletion(
    userStats.completedShifts,
    userStats.totalShifts
  );

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="show"
      className="h-full flex flex-col w-full text-foreground overflow-hidden"
    >
      {/* ── Unified Header ────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 -mx-4 px-4 md:-mx-8 md:px-8 pt-4 pb-4 lg:pb-6">
        <div className={cn(
            "rounded-[32px] p-4 lg:p-6 transition-all border",
            isDark 
                ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
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
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {user?.email}
                </span>
              </div>

              <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />

              {/* Edit Profile Button */}
              <Button
                onClick={() => setIsEditing(!isEditing)}
                className={cn(
                  "flex-shrink-0 gap-2 h-10 lg:h-11 px-6 rounded-xl font-black uppercase text-[10px] tracking-wider transition-all shadow-sm",
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

      <div className="flex-1 min-h-0 overflow-hidden pt-2 lg:pt-4">
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

                {/* Quick Stats Row */}
                <div className="flex items-center justify-center md:justify-start gap-8 mt-6 pt-6 border-t border-border/10">
                  <div className="text-center md:text-left">
                    <div className="text-2xl font-black text-foreground">{userStats.totalShifts}</div>
                    <div className="font-mono uppercase tracking-[0.2em] text-[10px] text-muted-foreground font-semibold">Total Shifts</div>
                  </div>
                  <div className="w-px h-10 bg-border/10" />
                  <div className="text-center md:text-left">
                    <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{userStats.completedShifts}</div>
                    <div className="font-mono uppercase tracking-[0.2em] text-[10px] text-muted-foreground font-semibold">Completed</div>
                  </div>
                  <div className="w-px h-10 bg-border/10" />
                  <div className="text-center md:text-left">
                    <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{userStats.upcomingShifts}</div>
                    <div className="font-mono uppercase tracking-[0.2em] text-[10px] text-muted-foreground font-semibold">Upcoming</div>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* CONTACT INFO COLUMN */}
                <motion.div
                  variants={itemVariants}
                >
                  <div className="space-y-6">
                    <div>
                      <div className="font-mono uppercase tracking-[0.2em] text-[10px] text-muted-foreground mb-2">
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
                      <div className="font-mono uppercase tracking-[0.2em] text-[10px] text-muted-foreground mb-2">
                        Account Details
                      </div>
                      <div className="space-y-2 text-foreground">
                        <div className="flex items-center">
                          <Calendar className="w-4 h-4 mr-2 text-muted-foreground" />
                          <span>
                            Member Since{' '}
                            {new Date(userStats.joinDate).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex items-center">
                          <div className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />
                          <span>Currently Active</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>

                {/* SHIFT STATS + PROGRESS BAR COLUMN */}
                <motion.div variants={itemVariants}>
                  <div className="grid grid-cols-2 gap-4">
                    <motion.div {...cardInteractive}>
                      <Card className="bg-card border border-border rounded-2xl min-h-[120px] flex flex-col justify-center hover:shadow-md transition-shadow">
                        <CardHeader>
                          <CardTitle className="text-lg text-foreground">Total Shifts</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-3xl font-black text-foreground">
                            {userStats.totalShifts}
                          </div>
                          <div className="text-muted-foreground text-sm">
                            Shifts overall
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>

                    <motion.div {...cardInteractive}>
                      <Card className="bg-card border border-border rounded-2xl min-h-[120px] flex flex-col justify-center hover:shadow-md transition-shadow">
                        <CardHeader>
                          <CardTitle className="text-lg text-foreground">Upcoming</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-3xl font-black text-foreground">
                            {userStats.upcomingShifts}
                          </div>
                          <div className="text-muted-foreground text-sm">
                            Scheduled shifts
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  </div>

                  {/* Example progress bar for completed vs total */}
                  <div className="mt-6">
                    <div className="mb-1 text-sm text-muted-foreground">
                      Shift Completion
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        className="h-2 bg-indigo-500 rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${completionPercent}%` }}
                        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-foreground">
                      {completionPercent}% completed
                    </div>
                  </div>
                </motion.div>
              </div>
            )}

            {/* MONTHLY METRICS */}
            <motion.div
              variants={itemVariants}
              className="mt-8"
            >
              <h3 className="text-xl font-black tracking-tight text-foreground mb-6 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary" />
                Monthly Overview
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                <motion.div variants={itemVariants} {...cardInteractive}>
                  <Card className="bg-card border border-border rounded-2xl hover:shadow-md transition-colors group">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="p-3 rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 group-hover:scale-110 transition-transform">
                          <CheckCircle2 className="w-6 h-6" />
                        </div>
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">
                          {monthlyStats.accepted} Accepted
                        </Badge>
                      </div>
                      <div>
                        <h4 className="text-lg font-black tracking-tight text-foreground mb-1">Shift Activity</h4>
                        <div className="space-y-1 text-sm text-muted-foreground">
                          <div className="flex justify-between">
                            <span>Offered</span>
                            <span className="text-foreground font-semibold">{monthlyStats.offered}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Rejected</span>
                            <span className="text-foreground font-semibold">{monthlyStats.rejected}</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>

                <motion.div variants={itemVariants} {...cardInteractive}>
                  <Card className="bg-card border border-border rounded-2xl hover:shadow-md transition-colors group">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="p-3 rounded-xl bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                          <Shuffle className="w-6 h-6" />
                        </div>
                        <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20">
                          {monthlyStats.swapped.success} Swapped
                        </Badge>
                      </div>
                      <div>
                        <h4 className="text-lg font-black tracking-tight text-foreground mb-1">Swaps</h4>
                        <div className="space-y-1 text-sm text-muted-foreground">
                          <div className="flex justify-between">
                            <span>Requested</span>
                            <span className="text-foreground font-semibold">{monthlyStats.swapped.success + monthlyStats.swapped.fail}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Failed</span>
                            <span className="text-foreground font-semibold">{monthlyStats.swapped.fail}</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>

                <motion.div variants={itemVariants} {...cardInteractive}>
                  <Card className="bg-card border border-border rounded-2xl hover:shadow-md transition-colors group">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="p-3 rounded-xl bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400 group-hover:scale-110 transition-transform">
                          <X className="w-6 h-6" />
                        </div>
                        <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20">
                          {monthlyStats.cancelled.normal} Cancelled
                        </Badge>
                      </div>
                      <div>
                        <h4 className="text-lg font-black tracking-tight text-foreground mb-1">Cancellations</h4>
                        <div className="space-y-1 text-sm text-muted-foreground">
                          <div className="flex justify-between">
                            <span>Late Notice</span>
                            <span className="text-rose-600 dark:text-rose-400 font-semibold">{monthlyStats.cancelled.late}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>No Show</span>
                            <span className="text-rose-700 dark:text-rose-300 font-semibold">{monthlyStats.cancelled.lateLate}</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>

                <motion.div variants={itemVariants} {...cardInteractive}>
                  <Card className="bg-card border border-border rounded-2xl hover:shadow-md transition-colors group">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="p-3 rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 group-hover:scale-110 transition-transform">
                          <Hourglass className="w-6 h-6" />
                        </div>
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20">
                          {monthlyStats.bidded.success} Won
                        </Badge>
                      </div>
                      <div>
                        <h4 className="text-lg font-black tracking-tight text-foreground mb-1">Bidding</h4>
                        <div className="space-y-1 text-sm text-muted-foreground">
                          <div className="flex justify-between">
                            <span>Total Bids</span>
                            <span className="text-foreground font-semibold">{monthlyStats.bidded.success + monthlyStats.bidded.fail}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Success Rate</span>
                            <span className="text-foreground font-semibold">
                              {Math.round((monthlyStats.bidded.success / (monthlyStats.bidded.success + monthlyStats.bidded.fail || 1)) * 100)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              </div>
            </motion.div>
          </CardContent>
        </div>
      </div>
    </motion.div>
  );
};

export default ProfilePage;
