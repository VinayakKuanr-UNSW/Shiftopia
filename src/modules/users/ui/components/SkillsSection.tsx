import React, { useState } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { useSkills, useEmployeeSkills, useAddEmployeeSkill, useRemoveEmployeeSkill } from '@/modules/users/hooks/useEmployeeSkills';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/modules/core/ui/primitives/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { Label } from '@/modules/core/ui/primitives/label';
import { Input } from '@/modules/core/ui/primitives/input';
import { Zap, Plus, Trash2 } from 'lucide-react';
import { format, differenceInDays, parseISO } from 'date-fns';
import { useToast } from '@/modules/core/ui/primitives/use-toast';

interface SkillsSectionProps {
    employeeId: string;
}

const SkillsSection: React.FC<SkillsSectionProps> = ({ employeeId }) => {
    const { data: allSkills } = useSkills();
    const { data: employeeSkills, isLoading } = useEmployeeSkills(employeeId);
    const addSkillMutation = useAddEmployeeSkill();
    const removeSkillMutation = useRemoveEmployeeSkill();

    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [newSkill, setNewSkill] = useState({
        skill_id: '',
        proficiency_level: 'Competent' as const,
        expiration_date: '',
        notes: '',
    });

    const { toast } = useToast();

    const handleAddSkill = async () => {
        if (!newSkill.skill_id) {
            toast({ title: 'Error', description: 'Please select a skill', variant: 'destructive' });
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
            proficiency_level: newSkill.proficiency_level,
            expiration_date: newSkill.expiration_date || undefined,
            notes: newSkill.notes || undefined,
            verified_at: new Date().toISOString(),
        });

        setIsAddDialogOpen(false);
        setNewSkill({ skill_id: '', proficiency_level: 'Competent', expiration_date: '', notes: '' });
    };

    const handleRemoveSkill = async (skillId: string) => {
        if (confirm('Remove this skill?')) {
            await removeSkillMutation.mutateAsync({ id: skillId, employeeId });
        }
    };

    const getStatusBadge = (status: string, expirationDate?: string) => {
        if (status === 'Expired') {
            return <Badge className="bg-destructive/10 text-destructive border border-destructive/20">Expired</Badge>;
        }
        if (expirationDate) {
            const daysUntilExpiry = differenceInDays(parseISO(expirationDate), new Date());
            if (daysUntilExpiry <= 30 && daysUntilExpiry > 0) {
                return <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">Expiring Soon</Badge>;
            }
            if (daysUntilExpiry < 0) {
                return <Badge className="bg-destructive/10 text-destructive border border-destructive/20">Expired</Badge>;
            }
        }
        return <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">Active</Badge>;
    };

    const PROFICIENCY_COLORS: Record<string, string> = {
        Novice: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700',
        Competent: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20',
        Proficient: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20',
        Expert: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20',
    };

    // Group skills by category
    const skillsByCategory = employeeSkills?.reduce((acc, skill) => {
        const category = skill.skill?.category || 'Other';
        if (!acc[category]) acc[category] = [];
        acc[category].push(skill);
        return acc;
    }, {} as Record<string, typeof employeeSkills>);

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden flex flex-col h-full">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/60 bg-white dark:bg-slate-900 flex items-center justify-between">
                <div className="space-y-0.5">
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <Zap className="w-4 h-4 text-slate-500" />
                        Skills & Competencies
                    </h3>
                    <p className="text-[10px] text-slate-400 font-medium pl-6 uppercase tracking-wider">
                        {employeeSkills?.length || 0} skills recorded
                    </p>
                </div>
                <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                    <DialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 h-8 px-2 text-xs font-medium gap-1.5 transition-colors">
                            <Plus className="w-3.5 h-3.5" />
                            Add Skill
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Add Skill</DialogTitle>
                            <DialogDescription>Add a new skill or competency</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 mt-4">
                            <div>
                                <Label>Skill</Label>
                                <Select value={newSkill.skill_id} onValueChange={(val) => setNewSkill({ ...newSkill, skill_id: val })}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select skill..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {allSkills?.map(skill => (
                                            <SelectItem key={skill.id} value={skill.id}>
                                                {skill.name} — {skill.category}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label>Proficiency Level</Label>
                                <Select value={newSkill.proficiency_level} onValueChange={(val: any) => setNewSkill({ ...newSkill, proficiency_level: val })}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Novice">Novice</SelectItem>
                                        <SelectItem value="Competent">Competent</SelectItem>
                                        <SelectItem value="Proficient">Proficient</SelectItem>
                                        <SelectItem value="Expert">Expert</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label>Expiration Date (Optional)</Label>
                                <Input
                                    type="date"
                                    value={newSkill.expiration_date}
                                    onChange={(e) => setNewSkill({ ...newSkill, expiration_date: e.target.value })}
                                />
                            </div>
                            <div>
                                <Label>Notes (Optional)</Label>
                                <Input
                                    placeholder="Add any notes..."
                                    value={newSkill.notes}
                                    onChange={(e) => setNewSkill({ ...newSkill, notes: e.target.value })}
                                />
                            </div>
                            <Button onClick={handleAddSkill} className="w-full">
                                Add Skill
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
            <div className="p-5 flex-1">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <p className="text-slate-400 text-sm animate-pulse">Loading skills...</p>
                    </div>
                ) : !employeeSkills || employeeSkills.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full py-8 text-center text-slate-400">
                        <Zap className="w-8 h-8 mb-3 opacity-20" />
                        <p className="text-sm font-medium">No skills recorded</p>
                    </div>
                ) : (
                    <div className="space-y-5">
                        {Object.entries(skillsByCategory || {}).map(([category, skills]) => (
                            <div key={category}>
                                <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-3 uppercase tracking-wider">{category}</h4>
                                <div className="space-y-3">
                                    {skills.map(skill => (
                                        <div
                                            key={skill.id}
                                            className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-sm transition-all group p-4"
                                        >
                                            <div className="flex items-start justify-between mb-2">
                                                <div className="flex-1">
                                                    <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100">{skill.skill?.name}</h4>
                                                    {skill.skill?.description && (
                                                        <p className="text-[11px] text-slate-500 mt-1">{skill.skill.description}</p>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <Badge className={`text-[10px] font-semibold uppercase tracking-wide ${PROFICIENCY_COLORS[skill.proficiency_level] || PROFICIENCY_COLORS.Competent}`}>
                                                        {skill.proficiency_level}
                                                    </Badge>
                                                    {getStatusBadge(skill.status, skill.expiration_date)}
                                                    <button
                                                        onClick={() => handleRemoveSkill(skill.id)}
                                                        className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-1"
                                                        title="Remove Skill"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="flex gap-4 text-[10px] text-slate-400 uppercase tracking-widest font-semibold mt-3">
                                                {skill.verified_at && (
                                                    <span>Verified: {format(parseISO(skill.verified_at), 'MMM d, yyyy')}</span>
                                                )}
                                                {skill.expiration_date && (
                                                    <span>Expires: {format(parseISO(skill.expiration_date), 'MMM d, yyyy')}</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SkillsSection;
