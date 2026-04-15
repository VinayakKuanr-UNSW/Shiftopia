import React, { useState } from 'react';
import { supabase } from '@/platform/realtime/client';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/modules/core/ui/primitives/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { Shield, User, Filter, Download } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { Label } from '@/modules/core/ui/primitives/label';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { motion } from 'framer-motion';

// Import section components
import SkillsSection from '@/modules/users/ui/components/SkillsSection';
import LicensesSection from '@/modules/users/ui/components/LicensesSection';
import WorkRightsSection from '@/modules/users/ui/components/WorkRightsSection';
import { UserContractsSection, AccessCertificatesSection } from '@/modules/users/ui/components/ContractsSection';
import { DeleteUserDialog } from '@/modules/users/ui/components/DeleteUserDialog';
import { useAuth } from '@/platform/auth/useAuth';

interface Profile {
    id: string;
    first_name: string;
    last_name: string;
    full_name: string;
    email: string;
}

const UsersPage: React.FC = () => {
    const { user: currentUser } = useAuth();
    const isZeta = currentUser?.highestAccessLevel === 'zeta';

    // State
    const [selectedUserId, setSelectedUserId] = useState<string>('');

    // Fetch all profiles
    const profilesResult = useQuery({
        queryKey: ['profiles', 'all'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, first_name, last_name, full_name, email')
                .order('full_name');

            if (error) {
                console.error('[UsersPage] Error fetching profiles:', error);
                throw error;
            }

            console.log('[UsersPage] Fetched profiles count:', data?.length);

            // Map the results to ensure we have a clean Profile list
            return (data || []).map(p => ({
                id: p.id,
                first_name: p.first_name,
                last_name: p.last_name,
                full_name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
                email: p.email,
            })) as Profile[];
        },
    });

    const { refetch: refetchProfiles } = profilesResult;
    const profiles = profilesResult.data;
    const isLoading = profilesResult.isLoading;

    const selectedUser = profiles?.find(p => p.id === selectedUserId);

    return (
        <div className="w-full min-h-screen p-6 md:p-10 space-y-6 pb-24 md:pb-10 bg-[#f8f9fa] dark:bg-slate-950 font-sans selection:bg-indigo-100 selection:text-indigo-900">
            {/* Header Section (Not in a card) */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-2"
            >
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 mb-1">
                        User Management
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                        Comprehensive employee profiles, performance metrics, and compliance management.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {selectedUserId && isZeta && selectedUser && (
                        <DeleteUserDialog 
                            userId={selectedUserId}
                            userName={selectedUser.full_name}
                            onSuccess={() => {
                                setSelectedUserId('');
                                refetchProfiles();
                            }}
                        />
                    )}
                    <Button variant="outline" className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 h-9 px-4 rounded-lg font-medium text-xs shadow-sm transition-all focus:ring-2 focus:ring-slate-200">
                        <Filter className="w-3.5 h-3.5 mr-2" />
                        Filters
                    </Button>
                    <Button className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shadow-indigo-200 dark:shadow-none h-9 px-4 rounded-lg font-medium text-xs transition-all focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 dark:focus:ring-offset-slate-950">
                        <Download className="w-3.5 h-3.5 mr-2" />
                        Export Data
                    </Button>
                </div>
            </motion.div>

            {/* Select Employee Card */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.05, ease: "easeOut" }}
            >
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm transition-shadow hover:shadow-md">
                    <Label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 tracking-wider uppercase mb-2.5 flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        Select Employee
                    </Label>
                    <div className="max-w-full">
                        <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                            <SelectTrigger className="w-full h-11 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm font-medium shadow-sm">
                                <SelectValue placeholder="Choose a user to manage..." />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-xl shadow-lg">
                                {profiles?.map(profile => (
                                    <SelectItem key={profile.id} value={profile.id} className="py-2.5 px-3 focus:bg-slate-50 dark:focus:bg-slate-800 cursor-pointer rounded-lg transition-colors">
                                        <div className="flex items-center">
                                            <span className="font-semibold text-slate-900 dark:text-slate-100">{profile.full_name || `${profile.first_name} ${profile.last_name}`}</span>
                                            <span className="text-slate-400 dark:text-slate-500 ml-2 font-normal text-xs">— {profile.email}</span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </motion.div>

            {/* Content Area */}
            <div className="min-h-[200px] sm:min-h-[400px]">
                {!selectedUserId && !isLoading && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex flex-col items-center justify-center py-24 text-center space-y-4 rounded-xl border border-slate-200 dark:border-slate-800 border-dashed bg-slate-50/50 dark:bg-slate-900/50"
                    >
                        <div className="w-16 h-16 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center shadow-sm border border-slate-100 dark:border-slate-700">
                            <User className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                        </div>
                        <div className="space-y-1">
                            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">No Employee Selected</h3>
                            <p className="text-slate-500 dark:text-slate-400 text-sm max-w-sm mx-auto">
                                Select an employee from the dropdown above to view their skills, compliance status, and performance metrics.
                            </p>
                        </div>
                    </motion.div>
                )}

                {selectedUserId && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                        className="space-y-6"
                    >
                        {/* Row 1: 3x1 Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.1, duration: 0.4 }}
                            >
                                <SkillsSection employeeId={selectedUserId} />
                            </motion.div>

                            <motion.div
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.15, duration: 0.4 }}
                            >
                                <LicensesSection employeeId={selectedUserId} />
                            </motion.div>

                            <motion.div
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.2, duration: 0.4 }}
                            >
                                <WorkRightsSection employeeId={selectedUserId} />
                            </motion.div>
                        </div>

                        {/* Row 2: User Contracts */}
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.25, duration: 0.4 }}
                        >
                            <UserContractsSection
                                employeeId={selectedUserId}
                                employeeName={selectedUser?.full_name || `${selectedUser?.first_name} ${selectedUser?.last_name}`}
                            />
                        </motion.div>

                        {/* Row 3: Access Certificates */}
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.3, duration: 0.4 }}
                        >
                            <AccessCertificatesSection
                                employeeId={selectedUserId}
                                employeeName={selectedUser?.full_name || `${selectedUser?.first_name} ${selectedUser?.last_name}`}
                            />
                        </motion.div>
                    </motion.div>
                )}
            </div>
        </div>
    );
};

export default UsersPage;
