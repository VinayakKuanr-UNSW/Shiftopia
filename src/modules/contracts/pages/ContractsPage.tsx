import React, { useState, useEffect } from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import { supabase } from '@/platform/realtime/client';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/modules/core/ui/primitives/card';
import { Button } from '@/modules/core/ui/primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/modules/core/ui/primitives/table';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Plus, Trash2, Shield, User, Building2, Users, Briefcase, DollarSign, ChevronRight } from 'lucide-react';

// Type assertion for user_contracts table (not yet in generated types)
// Run `npx supabase gen types typescript` to regenerate types and remove this
const supabaseAny = supabase as any;

type AccessLevel = 'Alpha' | 'Beta' | 'Gamma' | 'Delta';

interface Profile {
    id: string;
    first_name: string;
    last_name: string;
    full_name: string;
    email: string;
}

interface Organization {
    id: string;
    name: string;
}

interface Department {
    id: string;
    name: string;
    organization_id: string;
}

interface SubDepartment {
    id: string;
    name: string;
    department_id: string;
}

interface Role {
    id: string;
    name: string;
    sub_department_id: string;
    remuneration_level_id: string;
}

interface RemLevel {
    id: string;
    level_number: number;
    level_name: string;
    hourly_rate_min: number;
}

interface Contract {
    id: string;
    user_id: string;
    organization_id: string;
    department_id: string;
    sub_department_id: string;
    role_id: string;
    rem_level_id: string;
    access_level: AccessLevel;
    status: string;
    // Joined fields
    organization_name?: string;
    department_name?: string;
    sub_department_name?: string;
    role_name?: string;
    level_name?: string;
}

const ACCESS_LEVEL_COLORS: Record<AccessLevel, string> = {
    Alpha: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
    Beta: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    Gamma: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    Delta: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
};

const ACCESS_LEVEL_DESCRIPTIONS: Record<AccessLevel, string> = {
    Alpha: 'Employee - View own data only',
    Beta: 'Team Lead - View timesheets',
    Gamma: 'Manager - Manage sub-department',
    Delta: 'Admin - Global access',
};

const ContractsPage: React.FC = () => {
    const { user } = useAuth();
    const { toast } = useToast();

    // Data state
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [organizations, setOrganizations] = useState<Organization[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [subDepartments, setSubDepartments] = useState<SubDepartment[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [remLevels, setRemLevels] = useState<RemLevel[]>([]);
    const [contracts, setContracts] = useState<Contract[]>([]);

    // Selection state
    const [selectedUserId, setSelectedUserId] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);

    // New contract form
    const [newContract, setNewContract] = useState({
        organization_id: '',
        department_id: '',
        sub_department_id: '',
        role_id: '',
        rem_level_id: '',
        access_level: 'Alpha' as AccessLevel,
    });

    // Filtered options based on hierarchy
    const filteredDepartments = departments.filter(d => d.organization_id === newContract.organization_id);
    const filteredSubDepartments = subDepartments.filter(sd => sd.department_id === newContract.department_id);
    // Roles filtered by selected sub-department
    const filteredRoles = roles.filter(r => r.sub_department_id === newContract.sub_department_id);
    // Get the selected role's default rem level
    const selectedRole = roles.find(r => r.id === newContract.role_id);

    // Load initial data
    useEffect(() => {
        loadInitialData();
    }, []);

    // Load contracts when user changes
    useEffect(() => {
        if (selectedUserId) {
            loadUserContracts(selectedUserId);
        } else {
            setContracts([]);
        }
    }, [selectedUserId]);

    const loadInitialData = async () => {
        setIsLoading(true);
        try {
            // Fetch all reference data in parallel
            const [profilesRes, orgsRes, deptsRes, subDeptsRes, rolesRes, remLevelsRes] = await Promise.all([
                supabase.from('profiles').select('id, first_name, last_name, full_name, email').order('full_name'),
                supabase.from('organizations').select('id, name').order('name'),
                supabase.from('departments').select('id, name, organization_id').order('name'),
                supabase.from('sub_departments').select('id, name, department_id').order('name'),
                supabase.from('roles').select('id, name, sub_department_id, remuneration_level_id').order('name'),
                supabase.from('remuneration_levels').select('id, level_number, level_name, hourly_rate_min').order('level_number'),
            ]);

            if (profilesRes.data) setProfiles(profilesRes.data);
            if (orgsRes.data) setOrganizations(orgsRes.data);
            if (deptsRes.data) setDepartments(deptsRes.data);
            if (subDeptsRes.data) setSubDepartments(subDeptsRes.data);
            if (rolesRes.data) setRoles(rolesRes.data);
            if (remLevelsRes.data) setRemLevels(remLevelsRes.data);
        } catch (error) {
            console.error('Error loading data:', error);
            toast({ title: 'Error', description: 'Failed to load data', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const loadUserContracts = async (userId: string) => {
        try {
            const { data, error } = await supabaseAny
                .from('user_contracts')
                .select(`
                    *,
                    organization:organizations(name),
                    department:departments(name),
                    sub_department:sub_departments(name),
                    role:roles(name),
                    rem_level:remuneration_levels(level_name)
                `)
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const formatted = (data || []).map((c: any) => ({
                ...c,
                organization_name: c.organization?.name,
                department_name: c.department?.name,
                sub_department_name: c.sub_department?.name,
                role_name: c.role?.name,
                level_name: c.rem_level?.level_name,
            }));

            setContracts(formatted);
        } catch (error) {
            console.error('Error loading contracts:', error);
            toast({ title: 'Error', description: 'Failed to load contracts', variant: 'destructive' });
        }
    };

    const handleAddContract = async () => {
        if (!selectedUserId) {
            toast({ title: 'Error', description: 'Please select a user', variant: 'destructive' });
            return;
        }

        if (!newContract.organization_id || !newContract.department_id || !newContract.sub_department_id || !newContract.role_id || !newContract.rem_level_id) {
            toast({ title: 'Error', description: 'Please fill all fields', variant: 'destructive' });
            return;
        }

        try {
            const { error } = await supabaseAny.from('user_contracts').insert({
                user_id: selectedUserId,
                ...newContract,
            });

            if (error) throw error;

            toast({ title: 'Success', description: 'Contract added successfully' });
            loadUserContracts(selectedUserId);

            // Reset form
            setNewContract({
                organization_id: '',
                department_id: '',
                sub_department_id: '',
                role_id: '',
                rem_level_id: '',
                access_level: 'Alpha',
            });
        } catch (error: any) {
            console.error('Error adding contract:', error);
            toast({ title: 'Error', description: error.message || 'Failed to add contract', variant: 'destructive' });
        }
    };

    const handleDeleteContract = async (contractId: string) => {
        if (!confirm('Are you sure you want to delete this contract?')) return;

        try {
            const { error } = await supabaseAny.from('user_contracts').delete().eq('id', contractId);
            if (error) throw error;

            toast({ title: 'Success', description: 'Contract deleted' });
            loadUserContracts(selectedUserId);
        } catch (error) {
            console.error('Error deleting contract:', error);
            toast({ title: 'Error', description: 'Failed to delete contract', variant: 'destructive' });
        }
    };

    const selectedUser = profiles.find(p => p.id === selectedUserId);

    return (
        <div className="w-full">
            <div className="glass-panel p-6 mb-6">
                {/* Header */}
                <div className="mb-6 flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold mb-1">User Contracts</h1>
                        <p className="text-white/60">
                            Manage user roles, departments, and access levels
                        </p>
                    </div>
                    {activeContract?.accessLevel === 'delta' && (
                        <div className="bg-amber-600/20 text-amber-300 text-xs px-2.5 py-1 rounded-full border border-amber-600/30 flex items-center gap-1">
                            <Shield className="w-3 h-3" />
                            Delta Access
                        </div>
                    )}
                </div>

                {/* User Selector */}
                <Card className="border border-white/10 bg-white/5 mb-6">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <User className="w-5 h-5" />
                            Select User
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                            <SelectTrigger className="w-full max-w-md">
                                <SelectValue placeholder="Choose a user to manage contracts..." />
                            </SelectTrigger>
                            <SelectContent>
                                {profiles.map(profile => (
                                    <SelectItem key={profile.id} value={profile.id}>
                                        {profile.full_name || `${profile.first_name} ${profile.last_name}`} — {profile.email}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </CardContent>
                </Card>

                {selectedUserId && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Add Contract Form */}
                        <Card className="col-span-1 border border-white/10 bg-white/5">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Plus className="w-5 h-5" />
                                    Add Contract
                                </CardTitle>
                                <CardDescription>
                                    Add a new role/position for {selectedUser?.first_name}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {/* Organization */}
                                <div className="space-y-2">
                                    <label className="text-sm text-white/70 flex items-center gap-2">
                                        <Building2 className="w-4 h-4" />
                                        Organization
                                    </label>
                                    <Select
                                        value={newContract.organization_id}
                                        onValueChange={(val) => setNewContract({
                                            ...newContract,
                                            organization_id: val,
                                            department_id: '',
                                            sub_department_id: '',
                                        })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select organization" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {organizations.map(org => (
                                                <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Department */}
                                <div className="space-y-2">
                                    <label className="text-sm text-white/70 flex items-center gap-2">
                                        <Users className="w-4 h-4" />
                                        Department
                                    </label>
                                    <Select
                                        value={newContract.department_id}
                                        onValueChange={(val) => setNewContract({
                                            ...newContract,
                                            department_id: val,
                                            sub_department_id: '',
                                        })}
                                        disabled={!newContract.organization_id}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder={newContract.organization_id ? "Select department" : "Select org first"} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {filteredDepartments.map(dept => (
                                                <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Sub-Department */}
                                <div className="space-y-2">
                                    <label className="text-sm text-white/70 flex items-center gap-2">
                                        <ChevronRight className="w-4 h-4" />
                                        Sub-Department
                                    </label>
                                    <Select
                                        value={newContract.sub_department_id}
                                        onValueChange={(val) => setNewContract({
                                            ...newContract,
                                            sub_department_id: val,
                                            role_id: '',  // Reset role when sub-dept changes
                                            rem_level_id: '',  // Reset rem level too
                                        })}
                                        disabled={!newContract.department_id}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder={newContract.department_id ? "Select sub-department" : "Select dept first"} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {filteredSubDepartments.map(sd => (
                                                <SelectItem key={sd.id} value={sd.id}>{sd.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Role */}
                                <div className="space-y-2">
                                    <label className="text-sm text-white/70 flex items-center gap-2">
                                        <Briefcase className="w-4 h-4" />
                                        Role
                                    </label>
                                    <Select
                                        value={newContract.role_id}
                                        onValueChange={(val) => {
                                            const role = roles.find(r => r.id === val);
                                            setNewContract({
                                                ...newContract,
                                                role_id: val,
                                                // Auto-set the role's default rem level
                                                rem_level_id: role?.remuneration_level_id || newContract.rem_level_id,
                                            });
                                        }}
                                        disabled={!newContract.sub_department_id}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder={newContract.sub_department_id ? "Select role" : "Select sub-dept first"} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {filteredRoles.map(role => (
                                                <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Remuneration Level */}
                                <div className="space-y-2">
                                    <label className="text-sm text-white/70 flex items-center gap-2">
                                        <DollarSign className="w-4 h-4" />
                                        Remuneration Level
                                    </label>
                                    <Select
                                        value={newContract.rem_level_id}
                                        onValueChange={(val) => setNewContract({ ...newContract, rem_level_id: val })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select level" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {remLevels.map(rl => (
                                                <SelectItem key={rl.id} value={rl.id}>
                                                    L{rl.level_number} - {rl.level_name} (${rl.hourly_rate_min}/hr)
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Access Level */}
                                <div className="space-y-2">
                                    <label className="text-sm text-white/70 flex items-center gap-2">
                                        <Shield className="w-4 h-4" />
                                        Access Level
                                    </label>
                                    <Select
                                        value={newContract.access_level}
                                        onValueChange={(val) => setNewContract({ ...newContract, access_level: val as AccessLevel })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {(['Alpha', 'Beta', 'Gamma', 'Delta'] as AccessLevel[]).map(level => (
                                                <SelectItem key={level} value={level}>
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{level}</span>
                                                        <span className="text-xs text-white/50">{ACCESS_LEVEL_DESCRIPTIONS[level]}</span>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <Button onClick={handleAddContract} className="w-full mt-4">
                                    <Plus className="w-4 h-4 mr-2" />
                                    Add Contract
                                </Button>
                            </CardContent>
                        </Card>

                        {/* Existing Contracts Table */}
                        <Card className="col-span-1 lg:col-span-2 border border-white/10 bg-white/5">
                            <CardHeader>
                                <CardTitle>
                                    {selectedUser?.first_name}'s Contracts
                                </CardTitle>
                                <CardDescription>
                                    {contracts.length} active contract{contracts.length !== 1 ? 's' : ''}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Organization</TableHead>
                                                <TableHead>Department</TableHead>
                                                <TableHead>Sub-Department</TableHead>
                                                <TableHead>Role</TableHead>
                                                <TableHead>Level</TableHead>
                                                <TableHead>Access</TableHead>
                                                <TableHead className="text-right">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {contracts.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={7} className="text-center py-8 text-white/50">
                                                        No contracts found. Add one using the form.
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                contracts.map(contract => (
                                                    <TableRow key={contract.id}>
                                                        <TableCell className="font-medium">{contract.organization_name}</TableCell>
                                                        <TableCell>{contract.department_name}</TableCell>
                                                        <TableCell>{contract.sub_department_name}</TableCell>
                                                        <TableCell>{contract.role_name}</TableCell>
                                                        <TableCell>{contract.level_name}</TableCell>
                                                        <TableCell>
                                                            <Badge className={ACCESS_LEVEL_COLORS[contract.access_level as AccessLevel]}>
                                                                {contract.access_level}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => handleDeleteContract(contract.id)}
                                                                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {!selectedUserId && !isLoading && (
                    <div className="text-center py-12 text-white/50">
                        <User className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>Select a user above to manage their contracts</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ContractsPage;
