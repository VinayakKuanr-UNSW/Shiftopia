import React, { useState } from 'react';
import { supabase } from '@/platform/realtime/client';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/modules/core/ui/primitives/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { Shield, User, Filter, Download } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getQuarterOptions, formatQuarter } from '@/modules/users/hooks/usePerformanceMetrics';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { Label } from '@/modules/core/ui/primitives/label';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { motion } from 'framer-motion';

// Import section components
import SkillsSection from '@/modules/users/ui/components/SkillsSection';
import LicensesSection from '@/modules/users/ui/components/LicensesSection';
import WorkRightsSection from '@/modules/users/ui/components/WorkRightsSection';
import PerformanceSection from '@/modules/users/ui/components/PerformanceSection';
import RiskAlertsSection from '@/modules/users/ui/components/RiskAlertsSection';
import ContractsSection from '@/modules/users/ui/components/ContractsSection';

interface Profile {
    id: string;
    first_name: string;
    last_name: string;
    full_name: string;
    email: string;
}

const UsersPage: React.FC = () => {

    // State
    const [selectedUserId, setSelectedUserId] = useState<string>('');
    const [selectedQuarter, setSelectedQuarter] = useState<string>('Q1_2026');
    const [isAllTime, setIsAllTime] = useState(false);

    // Fetch all profiles
    const { data: profiles, isLoading } = useQuery({
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

    const selectedUser = profiles?.find(p => p.id === selectedUserId);
    const quarterOptions = getQuarterOptions();
    const effectiveQuarter = isAllTime ? 'ALL_TIME' : selectedQuarter;

    return (
        <div className="w-full min-h-screen p-4 md:p-6 lg:p-8 space-y-8">
            {/* Header Section */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="relative overflow-hidden rounded-[2.5rem] bg-card p-8 border border-border/50 shadow-2xl shadow-primary/5"
            >
                <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <h1 className="text-4xl font-black text-foreground tracking-tight leading-none">
                                User Management
                            </h1>
                        </div>
                        <p className="text-muted-foreground max-w-xl font-medium">
                            Comprehensive employee profiles, performance metrics, and compliance management.
                        </p>
                    </div>

                    <div className="flex gap-3">
                        <Button variant="outline" className="bg-muted/40 border-border/50 hover:bg-muted/60 text-foreground gap-2 rounded-xl h-11 px-5">
                            <Filter className="w-4 h-4" />
                            Filters
                        </Button>
                        <Button variant="default" className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-glow gap-2 rounded-xl h-11 px-6 text-[11px] font-black uppercase tracking-[0.2em] shadow-lg shadow-primary/20">
                            <Download className="w-4 h-4" />
                            Export Data
                        </Button>
                    </div>
                </div>

                {/* Filters Bar */}
                <div className="mt-8 p-5 rounded-2xl bg-muted/30 border border-border/50 backdrop-blur-md flex flex-wrap gap-6 items-end">
                    {/* User Selector */}
                    <div className="flex-1 min-w-[300px]">
                        <Label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest mb-3 flex items-center gap-2">
                            <User className="w-3.5 h-3.5 text-primary" />
                            Select Employee
                        </Label>
                        <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                            <SelectTrigger className="w-full bg-card border border-border/50 text-foreground h-12 rounded-xl focus:ring-2 focus:ring-primary/30 text-sm font-semibold hover:border-primary/30 transition-all shadow-sm">
                                <SelectValue placeholder="Choose a user to manage..." />
                            </SelectTrigger>
                            <SelectContent className="bg-card border-border text-foreground shadow-2xl rounded-xl">
                                {profiles?.map(profile => (
                                    <SelectItem key={profile.id} value={profile.id} className="focus:bg-muted/50 focus:text-foreground cursor-pointer py-2.5 rounded-lg">
                                        <span className="font-semibold">{profile.full_name || `${profile.first_name} ${profile.last_name}`}</span>
                                        <span className="text-muted-foreground ml-2 text-xs font-medium">— {profile.email}</span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Quarter Selector */}
                    <div className="w-48">
                        <Label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest mb-3 block">Period</Label>
                        <Select
                            value={selectedQuarter}
                            onValueChange={setSelectedQuarter}
                            disabled={isAllTime}
                        >
                            <SelectTrigger className="w-full bg-card border border-border/50 text-foreground h-12 rounded-xl disabled:opacity-50 text-sm font-semibold hover:border-primary/30 transition-all shadow-sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-card border-border text-foreground shadow-2xl rounded-xl">
                                {quarterOptions.map(quarter => (
                                    <SelectItem key={quarter} value={quarter} className="focus:bg-muted/50 focus:text-foreground cursor-pointer py-2.5 rounded-lg font-semibold">
                                        {formatQuarter(quarter)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* All Time Toggle */}
                    <div className="flex items-center space-x-3 pb-3 px-2 h-12">
                        <Switch
                            id="all-time-mode"
                            checked={isAllTime}
                            onCheckedChange={setIsAllTime}
                            className="data-[state=checked]:bg-primary"
                        />
                        <Label
                            htmlFor="all-time-mode"
                            className="text-xs font-black uppercase tracking-widest text-foreground cursor-pointer select-none"
                        >
                            All Time View
                        </Label>
                    </div>
                </div>
            </motion.div>

            {/* Content Area */}
            <div className="min-h-[400px]">
                {!selectedUserId && !isLoading && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex flex-col items-center justify-center py-20 text-center space-y-6 rounded-[2.5rem] border border-border/50 bg-muted/10 border-dashed"
                    >
                        <div className="w-20 h-20 rounded-[2rem] bg-primary/5 flex items-center justify-center mb-2 shadow-inner">
                            <User className="w-10 h-10 text-primary/60" />
                        </div>
                        <div className="space-y-2">
                            <h3 className="text-xl font-black text-foreground">No Employee Selected</h3>
                            <p className="text-muted-foreground max-w-sm mx-auto font-medium">
                                Select an employee from the dropdown above to view their skills, compliance status, and performance metrics.
                            </p>
                        </div>
                    </motion.div>
                )}

                {selectedUserId && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-8"
                    >
                        {/* Grid Layout for Sections */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {/* Skills & Competencies */}
                            <motion.div
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.1 }}
                            >
                                <SkillsSection employeeId={selectedUserId} />
                            </motion.div>

                            {/* Licenses */}
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.2 }}
                            >
                                <LicensesSection employeeId={selectedUserId} />
                            </motion.div>
                        </div>

                        {/* Work Rights - Full Width */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.3 }}
                        >
                            <WorkRightsSection employeeId={selectedUserId} />
                        </motion.div>

                        {/* Performance & Risk - Grid */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            {/* Performance takes 2 columns */}
                            <motion.div
                                className="lg:col-span-2"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.4 }}
                            >
                                <PerformanceSection
                                    employeeId={selectedUserId}
                                    quarterYear={effectiveQuarter}
                                />
                            </motion.div>

                            {/* Risk & Alerts takes 1 column */}
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.5 }}
                            >
                                <RiskAlertsSection
                                    employeeId={selectedUserId}
                                    quarterYear={effectiveQuarter}
                                />
                            </motion.div>
                        </div>

                        {/* Contracts - Full Width */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.6 }}
                        >
                            <ContractsSection
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
