import React, { useState } from 'react';
import { supabase } from '@/platform/supabase/client';
import { Shield, User, Filter, Download, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/modules/core/ui/primitives/button';
import { motion } from 'framer-motion';

// Import section components
import SkillsSection from '@/modules/users/ui/components/SkillsSection';
import LicensesSection from '@/modules/users/ui/components/LicensesSection';
import WorkRightsSection from '@/modules/users/ui/components/WorkRightsSection';
import { UserContractsSection, AccessCertificatesSection } from '@/modules/users/ui/components/ContractsSection';
import { DeleteUserDialog } from '@/modules/users/ui/components/DeleteUserDialog';
import { useAuth } from '@/platform/auth/useAuth';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { UserManagementFunctionBar } from '../ui/components/UserManagementFunctionBar';

interface Profile {
    id: string;
    first_name: string;
    last_name: string;
    full_name: string;
    email: string;
}

const UsersPage: React.FC = () => {
    const { user: currentUser } = useAuth();
    const { isDark } = useTheme();
    const isAuthorizedAdmin = ['epsilon', 'zeta'].includes(currentUser?.highestAccessLevel || '');

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
    const profiles = profilesResult.data || [];
    const isLoading = profilesResult.isLoading;

    const selectedUser = profiles?.find(p => p.id === selectedUserId);

    return (
        <div className="h-full flex flex-col overflow-hidden space-y-4 text-foreground">
            {/* ── Header Landmark ────────────────────────────────────────────── */}
            <header role="banner" className="sticky top-0 z-30 pt-2 pb-2 lg:pb-4 shrink-0">
                <div className={cn(
                    "rounded-[28px] p-4 lg:p-6 transition-all border",
                    isDark 
                        ? "bg-[#1c2333]/70 border-white/10 shadow-2xl shadow-black/20" 
                        : "bg-white/80 backdrop-blur-md border-slate-200 shadow-xl shadow-slate-200/50"
                )}>
                    {/* Identity & Scope Filter */}
                    <PersonalPageHeader
                        title="User Management"
                        Icon={Users}
                        mode="managerial"
                        className="mb-4 lg:mb-6"
                    />

                    {/* User Management Function Bar */}
                    <UserManagementFunctionBar
                        profiles={profiles}
                        selectedUserId={selectedUserId}
                        onUserSelect={setSelectedUserId}
                        isZeta={isAuthorizedAdmin}
                        transparent
                    />
                </div>
            </header>

            {/* ── Main Content Landmark ─────────────────────────────────────────── */}
            <main role="main" aria-label="User Management Profile Details" className="flex-1 min-h-0 overflow-hidden">
                <div className={cn(
                    "h-full rounded-[28px] overflow-auto transition-all border p-6 lg:p-10 scrollbar-none",
                    isDark 
                        ? "bg-[#1c2333]/50 border-white/10 shadow-2xl shadow-black/20" 
                        : "bg-white/80 backdrop-blur-md border-slate-200 shadow-xl shadow-slate-200/50"
                )}>
                    {!selectedUserId && !isLoading && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex flex-col items-center justify-center py-24 text-center space-y-4"
                        >
                            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center shadow-inner border border-primary/20">
                                <User className="w-10 h-10 text-primary" aria-hidden="true" />
                            </div>
                            <div className="space-y-1 max-w-sm mx-auto">
                                <h2 className="text-xl font-black uppercase tracking-widest text-foreground">
                                    No Employee Selected
                                </h2>
                                <p className="text-muted-foreground text-sm font-medium">
                                    Select an employee from the dropdown above to view their profile, compliance, and performance metrics.
                                </p>
                            </div>
                        </motion.div>
                    )}

                    {selectedUserId && (
                        <motion.section
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.4, ease: "easeOut" }}
                            aria-labelledby="selected-user-heading"
                            className="space-y-8"
                        >
                            {/* Summary Action Header for Selected User */}
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-border/20">
                                <div>
                                    <h2 id="selected-user-heading" className="text-2xl md:text-3xl font-black uppercase tracking-tight text-foreground">
                                        {selectedUser?.full_name}
                                    </h2>
                                    <p className="text-muted-foreground text-sm font-semibold mt-0.5">
                                        {selectedUser?.email}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0" role="group" aria-label="Employee profile actions">
                                    {isAuthorizedAdmin && selectedUser && (
                                        <DeleteUserDialog 
                                            userId={selectedUserId}
                                            userName={selectedUser.full_name}
                                            onSuccess={() => {
                                                setSelectedUserId('');
                                                refetchProfiles();
                                            }}
                                        />
                                    )}
                                    <Button
                                        variant="outline"
                                        aria-label={`Edit profile for ${selectedUser?.full_name}`}
                                        className="rounded-xl h-10 px-5 font-black uppercase tracking-widest text-[10px] focus-visible:ring-2 focus-visible:ring-primary"
                                    >
                                        Edit Profile
                                    </Button>
                                </div>
                            </div>

                            {/* Sectioned Content */}
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" aria-label="Employee compliance sections">
                                <SkillsSection employeeId={selectedUserId} />
                                <LicensesSection employeeId={selectedUserId} />
                                <WorkRightsSection employeeId={selectedUserId} />
                            </div>

                            <div className="space-y-8" aria-label="Employee contracts and certificates">
                                <UserContractsSection
                                    employeeId={selectedUserId}
                                    employeeName={selectedUser?.full_name || ''}
                                />
                                <AccessCertificatesSection
                                    employeeId={selectedUserId}
                                    employeeName={selectedUser?.full_name || ''}
                                />
                            </div>
                        </motion.section>
                    )}
                </div>
            </main>
        </div>
    );
};


export default UsersPage;
