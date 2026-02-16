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
import { motion } from 'framer-motion';

// Utility function for shift-completion percentage
const calcShiftCompletion = (completed: number, total: number) => {
  if (total === 0) return 0;
  return ((completed / total) * 100).toFixed(0);
};

const ProfilePage: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();

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
    <div className="w-full min-h-screen p-4 md:p-6 lg:p-8 space-y-8 bg-transparent">
      {/* Profile Header Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#1a2744] to-[#0d1424] border border-white/5 shadow-2xl"
      >
        {/* Background Decorative Elements */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2 pointer-events-none" />

        <div className="relative z-10 px-8 py-10 flex flex-col md:flex-row items-center md:items-start gap-8">
          {/* Avatar Section */}
          <div className="relative">
            <div className="w-32 h-32 rounded-full p-1 bg-gradient-to-br from-primary via-purple-500 to-indigo-600">
              <Avatar className="w-full h-full border-4 border-[#0d1424]">
                <AvatarImage src={user?.avatar} className="object-cover" />
                <AvatarFallback className="bg-[#1a2744] text-3xl font-bold text-primary">
                  {user?.name?.charAt(0) || 'U'}
                </AvatarFallback>
              </Avatar>
            </div>
            <button className="absolute bottom-1 right-1 p-2 rounded-full bg-primary text-white hover:bg-primary/90 transition-colors shadow-lg border border-[#0d1424]">
              <Camera size={16} />
            </button>
          </div>

          {/* User Info Section */}
          <div className="flex-1 text-center md:text-left space-y-2 pt-2">
            <div className="flex flex-col md:flex-row items-center md:items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold text-white tracking-tight">{user?.firstName} {user?.lastName}</h1>
                <div className="flex items-center justify-center md:justify-start gap-2 mt-2">
                  <span className="text-blue-200/60 font-medium italic">
                    {user?.email}
                  </span>
                </div>
              </div>

              <Button
                onClick={() => setIsEditing(!isEditing)}
                variant="outline"
                className="bg-white/5 border-white/10 hover:bg-white/10 text-white min-w-[120px]"
              >
                {isEditing ? 'Cancel' : 'Edit Profile'}
              </Button>
            </div>

            {/* Quick Stats Row */}
            <div className="flex items-center justify-center md:justify-start gap-8 mt-6 pt-6 border-t border-white/5">
              <div className="text-center md:text-left">
                <div className="text-2xl font-bold text-white">{userStats.totalShifts}</div>
                <div className="text-xs text-blue-200/40 uppercase tracking-wider font-semibold">Total Shifts</div>
              </div>
              <div className="w-px h-10 bg-white/5" />
              <div className="text-center md:text-left">
                <div className="text-2xl font-bold text-emerald-400">{userStats.completedShifts}</div>
                <div className="text-xs text-blue-200/40 uppercase tracking-wider font-semibold">Completed</div>
              </div>
              <div className="w-px h-10 bg-white/5" />
              <div className="text-center md:text-left">
                <div className="text-2xl font-bold text-purple-400">{userStats.upcomingShifts}</div>
                <div className="text-xs text-blue-200/40 uppercase tracking-wider font-semibold">Upcoming</div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
      {/* CONTENT SECTION */}
      <CardContent className="px-4 py-6 md:px-8 md:py-8">
        {isEditing ? (
          <div className="space-y-4 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-white/60 mb-1.5 block">
                  Name
                </label>
                <Input
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="bg-black/20 text-white border-white/20 focus:border-primary/50"
                />
              </div>
              <div>
                <label className="text-sm text-white/60 mb-1.5 block">
                  Email
                </label>
                <Input
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  className="bg-black/20 text-white border-white/20 focus:border-primary/50"
                  disabled
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleSave}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                Save Changes
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* CONTACT INFO COLUMN */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4 }}
            >
              <div className="space-y-6">
                <div>
                  <div className="text-sm text-white/60 mb-1">
                    Personal Information
                  </div>
                  <div className="space-y-2 text-white">
                    <div className="flex items-center">
                      <Mail className="w-4 h-4 mr-2 text-white/40" />
                      <span>{user?.email || 'No Email'}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-sm text-white/60 mb-1">
                    Account Details
                  </div>
                  <div className="space-y-2 text-white">
                    <div className="flex items-center">
                      <Calendar className="w-4 h-4 mr-2 text-white/40" />
                      <span>
                        Member Since{' '}
                        {new Date(userStats.joinDate).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-2 h-2 rounded-full bg-green-500 mr-2" />
                      <span>Currently Active</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* SHIFT STATS + PROGRESS BAR COLUMN */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4 }}
            >
              <div className="grid grid-cols-2 gap-4">
                <Card className="bg-white/10 border-white/20 text-white min-h-[120px] flex flex-col justify-center hover:shadow-md transition-shadow">
                  <CardHeader>
                    <CardTitle className="text-lg">Total Shifts</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {userStats.totalShifts}
                    </div>
                    <div className="text-white/60 text-sm">
                      Shifts overall
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-white/10 border-white/20 text-white min-h-[120px] flex flex-col justify-center hover:shadow-md transition-shadow">
                  <CardHeader>
                    <CardTitle className="text-lg">Upcoming</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {userStats.upcomingShifts}
                    </div>
                    <div className="text-white/60 text-sm">
                      Scheduled shifts
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Example progress bar for completed vs total */}
              <div className="mt-6 text-white">
                <div className="mb-1 text-sm text-white/60">
                  Shift Completion
                </div>
                <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-2 bg-purple-500 rounded-full transition-all duration-300"
                    style={{ width: `${completionPercent}%` }}
                  />
                </div>
                <div className="mt-1 text-xs">
                  {completionPercent}% completed
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* MONTHLY METRICS */}
        <motion.div
          className="mt-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <h3 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            Monthly Overview
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
            <Card className="bg-[#1a2744]/40 backdrop-blur-xl border-white/5 hover:bg-[#1a2744]/60 transition-colors group">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 group-hover:scale-110 transition-transform">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <Badge variant="glass" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                    {monthlyStats.accepted} Accepted
                  </Badge>
                </div>
                <div>
                  <h4 className="text-lg font-medium text-white mb-1">Shift Activity</h4>
                  <div className="space-y-1 text-sm text-blue-200/60">
                    <div className="flex justify-between">
                      <span>Offered</span>
                      <span className="text-white">{monthlyStats.offered}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Rejected</span>
                      <span className="text-white">{monthlyStats.rejected}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-[#1a2744]/40 backdrop-blur-xl border-white/5 hover:bg-[#1a2744]/60 transition-colors group">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-xl bg-blue-500/10 text-blue-400 group-hover:scale-110 transition-transform">
                    <Shuffle className="w-6 h-6" />
                  </div>
                  <Badge variant="glass" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
                    {monthlyStats.swapped.success} Swapped
                  </Badge>
                </div>
                <div>
                  <h4 className="text-lg font-medium text-white mb-1">Swaps</h4>
                  <div className="space-y-1 text-sm text-blue-200/60">
                    <div className="flex justify-between">
                      <span>Requested</span>
                      <span className="text-white">{monthlyStats.swapped.success + monthlyStats.swapped.fail}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Failed</span>
                      <span className="text-white">{monthlyStats.swapped.fail}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-[#1a2744]/40 backdrop-blur-xl border-white/5 hover:bg-[#1a2744]/60 transition-colors group">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-xl bg-red-500/10 text-red-400 group-hover:scale-110 transition-transform">
                    <X className="w-6 h-6" />
                  </div>
                  <Badge variant="glass" className="bg-red-500/10 text-red-400 border-red-500/20">
                    {monthlyStats.cancelled.normal} Cancelled
                  </Badge>
                </div>
                <div>
                  <h4 className="text-lg font-medium text-white mb-1">Cancellations</h4>
                  <div className="space-y-1 text-sm text-blue-200/60">
                    <div className="flex justify-between">
                      <span>Late Notice</span>
                      <span className="text-red-300">{monthlyStats.cancelled.late}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>No Show</span>
                      <span className="text-red-400">{monthlyStats.cancelled.lateLate}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-[#1a2744]/40 backdrop-blur-xl border-white/5 hover:bg-[#1a2744]/60 transition-colors group">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 group-hover:scale-110 transition-transform">
                    <Hourglass className="w-6 h-6" />
                  </div>
                  <Badge variant="glass" className="bg-amber-500/10 text-amber-400 border-amber-500/20">
                    {monthlyStats.bidded.success} Won
                  </Badge>
                </div>
                <div>
                  <h4 className="text-lg font-medium text-white mb-1">Bidding</h4>
                  <div className="space-y-1 text-sm text-blue-200/60">
                    <div className="flex justify-between">
                      <span>Total Bids</span>
                      <span className="text-white">{monthlyStats.bidded.success + monthlyStats.bidded.fail}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Success Rate</span>
                      <span className="text-white">
                        {Math.round((monthlyStats.bidded.success / (monthlyStats.bidded.success + monthlyStats.bidded.fail || 1)) * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </motion.div>
      </CardContent>
    </div>
  );
};

export default ProfilePage;
