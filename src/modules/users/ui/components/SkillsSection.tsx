import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/modules/core/ui/primitives/card';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { useSkills, useEmployeeSkills, useAddEmployeeSkill, useUpdateEmployeeSkill, useRemoveEmployeeSkill } from '@/modules/users/hooks/useEmployeeSkills';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/modules/core/ui/primitives/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { Label } from '@/modules/core/ui/primitives/label';
import { Input } from '@/modules/core/ui/primitives/input';
import { Calendar, Plus, X, AlertTriangle } from 'lucide-react';
import { format, differenceInDays, parseISO } from 'date-fns';
import { useToast } from '@/modules/core/ui/primitives/use-toast';

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
    const [newSkill, setNewSkill] = useState({
        skill_id: '',
        proficiency_level: 'Competent' as const,
        expiration_date: '',
        notes: '',
    });

    const { toast } = useToast();  // Ensure useToast is imported or available

    const handleAddSkill = async () => {
        if (!newSkill.skill_id) {
            toast({ title: 'Error', description: 'Please select a skill', variant: 'destructive' });
            return;
        }

        if (newSkill.expiration_date) {
            const exp = new Date(newSkill.expiration_date);
            const today = new Date();
            // Optional: warn if adding already expired skill?
            if (exp < today && !confirm('This skill is already expired. Continue?')) {
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
        setNewSkill({
            skill_id: '',
            proficiency_level: 'Competent',
            expiration_date: '',
            notes: '',
        });
    };

    const handleRemoveSkill = async (skillId: string) => {
        if (confirm('Remove this skill?')) {
            await removeSkillMutation.mutateAsync({ id: skillId, employeeId });
        }
    };

    const getExpiryStatus = (expirationDate?: string) => {
        if (!expirationDate) return null;

        const daysUntilExpiry = differenceInDays(parseISO(expirationDate), new Date());

        if (daysUntilExpiry < 0) {
            return { label: 'Expired', class: 'bg-destructive/10 text-destructive border border-destructive/20' };
        } else if (daysUntilExpiry <= 30) {
            return { label: 'Expiring Soon', class: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20' };
        }
        return { label: `Exp: ${format(parseISO(expirationDate), 'MMM yyyy')}`, class: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' };
    };

    // Group skills by category
    const skillsByCategory = employeeSkills?.reduce((acc, skill) => {
        const category = skill.skill?.category || 'Other';
        if (!acc[category]) acc[category] = [];
        acc[category].push(skill);
        return acc;
    }, {} as Record<string, typeof employeeSkills>);

    return (
        <Card className="border border-border bg-card">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Calendar className="w-5 h-5" />
                        Skills & Competencies
                    </CardTitle>
                    <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-2">
                                <Plus className="w-4 h-4" />
                                Add Skill
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Add Skill</DialogTitle>
                                <DialogDescription>Add a new skill or certification</DialogDescription>
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
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <p className="text-muted-foreground text-sm">Loading skills...</p>
                ) : !employeeSkills || employeeSkills.length === 0 ? (
                    <div className="text-center py-6">
                        <Calendar className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                        <p className="text-muted-foreground text-sm">No skills added yet</p>
                        <p className="text-muted-foreground/70 text-xs mt-1">Add skills to improve shift eligibility</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {Object.entries(skillsByCategory || {}).map(([category, skills]) => (
                            <div key={category}>
                                <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">{category}</h4>
                                <div className="flex flex-wrap gap-2">
                                    {skills.map(skill => {
                                        const expiryStatus = getExpiryStatus(skill.expiration_date);
                                        return (
                                            <div key={skill.id} className="group relative">
                                                <Badge
                                                    className="bg-primary/10 text-primary border border-primary/20 pr-6 cursor-pointer hover:bg-primary/20 transition-colors"
                                                >
                                                    {skill.skill?.name}
                                                    {expiryStatus && (
                                                        <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${expiryStatus.class}`}>
                                                            {expiryStatus.label}
                                                        </span>
                                                    )}
                                                </Badge>
                                                <button
                                                    onClick={() => handleRemoveSkill(skill.id)}
                                                    className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default SkillsSection;
