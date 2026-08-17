import React, { useState, useMemo } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import {
    useSkills,
    useEmployeeSkills,
    useAddEmployeeSkill,
    useUpdateEmployeeSkill,
    useRemoveEmployeeSkill,
    EmployeeSkill,
} from '@/modules/users/hooks/useEmployeeSkills';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/modules/core/ui/primitives/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { Label } from '@/modules/core/ui/primitives/label';
import { Input } from '@/modules/core/ui/primitives/input';
import { Zap, Plus, Trash2, Pencil, Search } from 'lucide-react';
import { format, differenceInDays, parseISO } from 'date-fns';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { cn } from '@/modules/core/lib/utils';

interface SkillsSectionProps {
    employeeId: string;
}

const SkillsSection: React.FC<SkillsSectionProps> = ({ employeeId }) => {
    const { data: allSkills } = useSkills();
    const { data: employeeSkills, isLoading } = useEmployeeSkills(employeeId);
    const addSkillMutation = useAddEmployeeSkill();
    const updateSkillMutation = useUpdateEmployeeSkill();
    const removeSkillMutation = useRemoveEmployeeSkill();

    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [editingSkill, setEditingSkill] = useState<EmployeeSkill | null>(null);
    const [filterQuery, setFilterQuery] = useState('');
    const [newSkill, setNewSkill] = useState({
        skill_id: '',
        issue_date: '',
        expiration_date: '',
    });

    const { toast } = useToast();

    const handleAddSkill = async () => {
        if (!newSkill.skill_id) {
            toast({ title: 'Error', description: 'Please select a skill', variant: 'destructive' });
            return;
        }

        if (!newSkill.issue_date) {
            toast({ title: 'Error', description: 'Issue date is mandatory', variant: 'destructive' });
            return;
        }

        if (newSkill.expiration_date) {
            const exp = new Date(newSkill.expiration_date);
            if (exp < new Date() && !confirm('This skill is already expired. Continue?')) {
                return;
            }
        }

        await addSkillMutation.mutateAsync({
            employee_id: employeeId,
            skill_id: newSkill.skill_id,
            issue_date: newSkill.issue_date,
            expiration_date: newSkill.expiration_date || undefined,
            verified_at: new Date().toISOString(),
        });

        setIsAddDialogOpen(false);
        setNewSkill({ skill_id: '', issue_date: '', expiration_date: '' });
    };

    const handleUpdateSkill = async () => {
        if (!editingSkill) return;

        if (!editingSkill.issue_date) {
            toast({ title: 'Error', description: 'Issue date is mandatory', variant: 'destructive' });
            return;
        }

        await updateSkillMutation.mutateAsync({
            id: editingSkill.id,
            updates: {
                issue_date: editingSkill.issue_date,
                expiration_date: editingSkill.expiration_date || undefined,
            },
        });

        setEditingSkill(null);
    };

    const handleRemoveSkill = async (skillId: string) => {
        if (confirm('Remove this skill?')) {
            await removeSkillMutation.mutateAsync({ id: skillId, employeeId });
        }
    };

    const getStatusBadge = (status: string, expirationDate?: string) => {
        if (status === 'Expired') {
            return <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 font-bold text-[9px] uppercase shadow-none">Expired</Badge>;
        }
        if (expirationDate) {
            const daysUntilExpiry = differenceInDays(parseISO(expirationDate), new Date());
            if (daysUntilExpiry <= 30 && daysUntilExpiry > 0) {
                return <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-bold text-[9px] uppercase shadow-none">Expiring Soon</Badge>;
            }
            if (daysUntilExpiry < 0) {
                return <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 font-bold text-[9px] uppercase shadow-none">Expired</Badge>;
            }
        }
        return <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-bold text-[9px] uppercase shadow-none">Active</Badge>;
    };

    // Filter skills by search query
    const filteredSkills = useMemo(() => {
        if (!employeeSkills) return [];
        if (!filterQuery.trim()) return employeeSkills;
        const q = filterQuery.toLowerCase();
        return employeeSkills.filter(
            (s) =>
                s.skill?.name.toLowerCase().includes(q) ||
                s.skill?.category?.toLowerCase().includes(q)
        );
    }, [employeeSkills, filterQuery]);

    // Group filtered skills by category
    const skillsByCategory = useMemo(() => {
        return filteredSkills.reduce((acc, skill) => {
            const category = skill.skill?.category || 'Other';
            if (!acc[category]) acc[category] = [];
            acc[category].push(skill);
            return acc;
        }, {} as Record<string, typeof employeeSkills>);
    }, [filteredSkills]);

    return (
        <div className="bg-card border border-border/30 rounded-2xl overflow-hidden flex flex-col h-[420px] shadow-xs">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-border/20 bg-card flex flex-col gap-2 shrink-0">
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                        <h3 className="text-sm font-black uppercase tracking-wider text-foreground flex items-center gap-2">
                            <Zap className="w-4 h-4 text-primary" aria-hidden="true" />
                            Skills ({employeeSkills?.length || 0})
                        </h3>
                    </div>
                    <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs font-bold gap-1.5 rounded-xl border-border/40 hover:bg-primary/10 hover:text-primary transition-colors focus-visible:ring-2 focus-visible:ring-primary shadow-none">
                                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                                Add Skill
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="rounded-2xl border border-border/30 bg-popover">
                            <DialogHeader>
                                <DialogTitle className="text-lg font-black uppercase tracking-tight">Add Skill</DialogTitle>
                                <DialogDescription className="text-xs text-muted-foreground">Add a new skill for this employee</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 mt-3">
                                <div>
                                    <Label className="text-xs font-bold">Select Skill *</Label>
                                    <Select value={newSkill.skill_id} onValueChange={(val) => setNewSkill({ ...newSkill, skill_id: val })}>
                                        <SelectTrigger className="rounded-xl border-border/40">
                                            <SelectValue placeholder="Select skill..." />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl">
                                            {allSkills?.map(skill => (
                                                <SelectItem key={skill.id} value={skill.id}>
                                                    {skill.name} — {skill.category}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <Label className="text-xs font-bold">Issue Date *</Label>
                                        <Input
                                            type="date"
                                            required
                                            value={newSkill.issue_date}
                                            onChange={(e) => setNewSkill({ ...newSkill, issue_date: e.target.value })}
                                            className="rounded-xl border-border/40"
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-xs font-bold">Expiry Date (Optional)</Label>
                                        <Input
                                            type="date"
                                            value={newSkill.expiration_date}
                                            onChange={(e) => setNewSkill({ ...newSkill, expiration_date: e.target.value })}
                                            className="rounded-xl border-border/40"
                                        />
                                    </div>
                                </div>
                                <Button onClick={handleAddSkill} className="w-full rounded-xl font-bold uppercase tracking-wider shadow-none">
                                    Add Skill
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>

                {/* Search / Filter skills inline */}
                {(employeeSkills?.length ?? 0) > 4 && (
                    <div className="relative w-full">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" aria-hidden="true" />
                        <input
                            type="search"
                            value={filterQuery}
                            onChange={(e) => setFilterQuery(e.target.value)}
                            placeholder="Filter skills..."
                            aria-label="Filter employee skills"
                            className="w-full bg-muted/40 border border-border/20 rounded-xl pl-8 pr-3 py-1 text-xs font-medium placeholder:text-muted-foreground/60 outline-none focus:ring-1 focus:ring-primary text-foreground"
                        />
                    </div>
                )}
            </div>

            {/* Edit Skill Dialog */}
            {editingSkill && (
                <Dialog open={!!editingSkill} onOpenChange={(open) => !open && setEditingSkill(null)}>
                    <DialogContent className="rounded-2xl border border-border/30 bg-popover">
                        <DialogHeader>
                            <DialogTitle className="text-lg font-black uppercase tracking-tight">Edit Skill</DialogTitle>
                            <DialogDescription className="text-xs text-muted-foreground">
                                Update issue & expiry dates for <span className="font-bold text-foreground">{editingSkill.skill?.name}</span>
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 mt-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs font-bold">Issue Date *</Label>
                                    <Input
                                        type="date"
                                        required
                                        value={editingSkill.issue_date ? editingSkill.issue_date.split('T')[0] : ''}
                                        onChange={(e) => setEditingSkill({ ...editingSkill, issue_date: e.target.value })}
                                        className="rounded-xl border-border/40"
                                    />
                                </div>
                                <div>
                                    <Label className="text-xs font-bold">Expiry Date (Optional)</Label>
                                    <Input
                                        type="date"
                                        value={editingSkill.expiration_date ? editingSkill.expiration_date.split('T')[0] : ''}
                                        onChange={(e) => setEditingSkill({ ...editingSkill, expiration_date: e.target.value })}
                                        className="rounded-xl border-border/40"
                                    />
                                </div>
                            </div>
                            <Button onClick={handleUpdateSkill} className="w-full rounded-xl font-bold uppercase tracking-wider shadow-none">
                                Save Changes
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            )}

            {/* Scrollable Content Body */}
            <div className="p-4 flex-1 min-h-0 overflow-y-auto scrollbar-thin">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <p className="text-muted-foreground text-xs font-medium animate-pulse">Loading skills...</p>
                    </div>
                ) : !employeeSkills || employeeSkills.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full py-8 text-center text-muted-foreground">
                        <Zap className="w-8 h-8 mb-2 opacity-20" aria-hidden="true" />
                        <p className="text-xs font-bold">No skills recorded</p>
                    </div>
                ) : filteredSkills.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground text-xs font-medium">
                        No skills matching "{filterQuery}"
                    </div>
                ) : (
                    <div className="space-y-4">
                        {Object.entries(skillsByCategory).map(([category, skills]) => {
                            const list = skills ?? [];
                            return (
                                <div key={category} className="space-y-2">
                                    <h4 className="text-[10px] font-black uppercase tracking-wider text-muted-foreground border-b border-border/10 pb-1">
                                        {category} ({list.length})
                                    </h4>
                                    <div className="space-y-2">
                                        {list.map(skill => (
                                            <div
                                                key={skill.id}
                                                className="bg-muted/30 hover:bg-muted/60 rounded-xl border border-border/20 p-3 transition-colors group flex items-center justify-between gap-2"
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <h5 className="font-bold text-xs text-foreground truncate">{skill.skill?.name}</h5>
                                                    {skill.skill?.description && (
                                                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">{skill.skill.description}</p>
                                                    )}
                                                    <div className="flex flex-wrap gap-3 text-[9px] font-semibold text-muted-foreground mt-1.5">
                                                        {skill.issue_date && (
                                                            <span>Issued: {format(parseISO(skill.issue_date), 'MMM d, yyyy')}</span>
                                                        )}
                                                        {skill.expiration_date && (
                                                            <span>Expires: {format(parseISO(skill.expiration_date), 'MMM d, yyyy')}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    {getStatusBadge(skill.status, skill.expiration_date)}
                                                    <button
                                                        type="button"
                                                        onClick={() => setEditingSkill(skill)}
                                                        aria-label={`Edit skill ${skill.skill?.name}`}
                                                        className="text-muted-foreground/60 hover:text-primary p-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                                                        title="Edit Skill"
                                                    >
                                                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveSkill(skill.id)}
                                                        aria-label={`Remove skill ${skill.skill?.name}`}
                                                        className="text-muted-foreground/60 hover:text-red-500 p-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                                                        title="Remove Skill"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SkillsSection;
