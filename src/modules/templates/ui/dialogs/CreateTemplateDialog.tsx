// src/components/templates/CreateTemplateDialog.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import { Plus, FileText, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';
import { validateTemplateName, sanitizeTemplateName } from '@/modules/templates/model/templates.types';
import { format, addMonths, startOfMonth } from 'date-fns';
import { shiftsApi as enhancedShiftService } from '@/modules/rosters';
import { supabase } from '@/platform/realtime/client';

interface CreateTemplateDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateTemplate: (input: {
    name: string;
    description: string;
    month: string;
    organizationId: string;
    departmentId: string;
    subDepartmentId: string;
  }) => Promise<void>;
  existingMonths?: string[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const CreateTemplateDialog: React.FC<CreateTemplateDialogProps> = ({
  isOpen,
  onOpenChange,
  onCreateTemplate,
  existingMonths = [],
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');

  // Organization/Department/SubDepartment state
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [subDepartments, setSubDepartments] = useState<{ id: string; name: string }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');
  const [selectedSubDeptId, setSelectedSubDeptId] = useState<string>('');
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(false);
  const [isLoadingDepts, setIsLoadingDepts] = useState(false);
  const [isLoadingSubDepts, setIsLoadingSubDepts] = useState(false);

  // DEBUG: Track Render State (Placed after initialization)
  console.log('[CreateTemplateDialog] RENDER:', { isOpen, selectedOrgId, selectedDeptId, selectedSubDeptId, orgsCount: organizations.length });

  // Generation options (Current month + 24 future months)
  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return [currentYear, currentYear + 1, currentYear + 2];
  }, []);

  const monthString = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
  const isExistingMonth = existingMonths.includes(monthString);

  const { activeContract, user } = useAuth();

  // Check permissions based on certificates (preferred) or active contract (fallback)
  const effectiveScope = useMemo(() => {
    if (!user) return null;

    // 1. Check for High-Level Certificates first
    const epsilonCert = user.certificates?.find(c => c.accessLevel === 'epsilon');
    if (epsilonCert) return { type: 'epsilon', scope: null }; // Global Access

    const deltaCert = user.certificates?.find(c => c.accessLevel === 'delta');
    if (deltaCert) {
      return {
        type: 'delta',
        scope: {
          organizationId: deltaCert.organizationId,
          departmentId: deltaCert.departmentId,
          subDepartmentId: null // Explicitly null to indicate unlocked
        }
      };
    }

    const gammaCert = user.certificates?.find(c => c.accessLevel === 'gamma');
    if (gammaCert) {
      return {
        type: 'gamma',
        scope: {
          organizationId: gammaCert.organizationId,
          departmentId: gammaCert.departmentId,
          subDepartmentId: gammaCert.subDepartmentId
        }
      };
    }

    // 2. Fallback to Active Contract (Legacy/Low Level)
    if (activeContract) {
      // Treating Admin contract as Epsilon equivalent for legacy support
      if (activeContract.userId === 'admin') return { type: 'epsilon', scope: null };
      // Treat Delta contract
      if (activeContract.accessLevel === 'delta' || activeContract.accessLevel === 'Delta') {
        return {
          type: 'delta',
          scope: {
            organizationId: activeContract.organizationId,
            departmentId: activeContract.departmentId,
            subDepartmentId: null
          }
        };
      }
      // Determine other contract levels if needed, but usually they don't create templates?
      // Actually Gamma contracts CAN create templates.
      if (activeContract.accessLevel === 'gamma' || activeContract.accessLevel === 'Gamma') {
        return {
          type: 'gamma',
          scope: {
            organizationId: activeContract.organizationId,
            departmentId: activeContract.departmentId,
            subDepartmentId: activeContract.subDepartmentId
          }
        }
      }
    }

    return null;
  }, [user, activeContract]);

  const lockedScope = useMemo(() => {
    if (!effectiveScope || effectiveScope.type === 'epsilon') return null;
    return effectiveScope.scope;
  }, [effectiveScope]);

  // Reset state when dialog opens - SAFE MODE
  // Only resets form fields. Does NOT touch IDs or Lists to prevent race conditions with Unified Loader.
  useEffect(() => {
    if (isOpen) {
      const now = new Date();
      setName((prev) => prev || `${format(now, 'MMMM yyyy')} Template`);
      if (!description) setDescription('');
      setSelectedMonth(now.getMonth());
      setSelectedYear(now.getFullYear());
      setError('');
      setNameError('');
      setIsCreating(false);
    }
  }, [isOpen]);

  // Unified Data Loading Logic
  useEffect(() => {
    if (!isOpen) return;

    const loadData = async () => {
      console.log('[CreateTemplateDialog] Loading Data...', { lockedScope, activeContract });

      // 1. Always load Organizations
      setIsLoadingOrgs(true);
      try {
        let orgs = await enhancedShiftService.getOrganizations();
        console.log('[CreateTemplateDialog] Fetched Orgs:', orgs);

        // FALLBACK: If locked scope exists but org is missing (likely RLS), fetch it specifically
        if (lockedScope && !orgs.find(o => o.id === lockedScope.organizationId)) {
          console.log('[CreateTemplateDialog] Locked Org missing from list, fetching directly...');
          const { data: specificOrg, error: specificOrgError } = await supabase
            .from('organizations')
            .select('id, name')
            .eq('id', lockedScope.organizationId)
            .single();

          if (specificOrg) {
            console.log('[CreateTemplateDialog] Fetched specific org:', specificOrg);
            orgs = [...orgs, specificOrg];
          } else if (specificOrgError) {
            console.error('[CreateTemplateDialog] Failed to fetch specific org:', specificOrgError);
          }
        }

        setOrganizations(orgs);

        // Handle Auto-Selection for Non-Locked (Default to first)
        if (!lockedScope && orgs.length > 0 && !selectedOrgId) {
          setSelectedOrgId(orgs[0].id);
        }
      } catch (err) {
        console.error('Failed to load organizations:', err);
      } finally {
        setIsLoadingOrgs(false);
      }

      // 2. Locked Scope: Pre-load Department and Sub-Department data
      if (lockedScope) {
        console.log('[CreateTemplateDialog] Applying Locked Scope:', lockedScope);
        // Set State Immediately
        setSelectedOrgId(lockedScope.organizationId);
        setSelectedDeptId(lockedScope.departmentId);
        setSelectedSubDeptId(lockedScope.subDepartmentId);

        // Load Departments for Locked Org
        setIsLoadingDepts(true);
        try {
          const depts = await enhancedShiftService.getDepartments(lockedScope.organizationId);
          console.log('[CreateTemplateDialog] Fetched Depts:', depts);
          setDepartments(depts);

          // Re-assert selection to ensure UI captures it (prevents race condition clearing)
          setTimeout(() => setSelectedDeptId(lockedScope.departmentId), 0);

        } catch (err) {
          console.error('Failed to load locked departments:', err);
        } finally {
          setIsLoadingDepts(false);
        }

        // Load Sub-Departments for Locked Dept
        setIsLoadingSubDepts(true);
        try {
          const subDepts = await enhancedShiftService.getSubDepartments(lockedScope.departmentId);
          console.log('[CreateTemplateDialog] Fetched SubDepts:', subDepts);
          setSubDepartments(subDepts);

          // Re-assert selection
          setTimeout(() => setSelectedSubDeptId(lockedScope.subDepartmentId), 0);

        } catch (err) {
          console.error('Failed to load locked sub-departments:', err);
        } finally {
          setIsLoadingSubDepts(false);
        }
      }
    };

    loadData();
  }, [isOpen, lockedScope]); // Re-run if dialog opens or permissions change

  // CRITICAL SYNCHRONIZATION: Enforce Locked Scope
  // If the component state drifts (e.g. Select unmounting/remounting or race conditions),
  // this ensures the Organization ID always snaps back to the locked value.
  useEffect(() => {
    if (lockedScope && selectedOrgId !== lockedScope.organizationId) {
      console.log('[CreateTemplateDialog] Enforcing Locked Org ID:', lockedScope.organizationId);
      setSelectedOrgId(lockedScope.organizationId);
    }
  }, [lockedScope, selectedOrgId]);

  // Cascading Loaders for NON-LOCKED interactions (Manual Selection)
  // Only validation: ensure we don't double-fetch if lockedScope is active, 
  // as the unified effect handles that.

  // Load departments when organization changes (User Action)
  useEffect(() => {
    // CRITICAL FIX: Do NOT run this if lockedScope is active.
    // The unified loader handles all data fetching for locked users.
    // Running this will clear the state because it sees the initial "change"
    if (lockedScope) return;

    if (!selectedOrgId) {
      setDepartments([]);
      setSelectedDeptId('');
      setSubDepartments([]);
      setSelectedSubDeptId('');
      return;
    }

    const loadDepts = async () => {
      setIsLoadingDepts(true);
      try {
        const depts = await enhancedShiftService.getDepartments(selectedOrgId);
        setDepartments(depts);
        if (depts.length > 0) {
          setSelectedDeptId(depts[0].id);
        } else {
          setSelectedDeptId('');
        }
      } catch (err) {
        console.error('Failed to load departments:', err);
      } finally {
        setIsLoadingDepts(false);
      }
    };
    loadDepts();
  }, [selectedOrgId, lockedScope]);

  // Load sub-departments when department changes (User Action)
  useEffect(() => {
    // CRITICAL FIX: Do NOT run this if lockedScope is active.
    if (lockedScope) return;

    if (!selectedDeptId) {
      setSubDepartments([]);
      setSelectedSubDeptId('');
      return;
    }

    const loadSubDepts = async () => {
      setIsLoadingSubDepts(true);
      try {
        const subDepts = await enhancedShiftService.getSubDepartments(selectedDeptId);
        setSubDepartments(subDepts);
        if (subDepts.length > 0) {
          setSelectedSubDeptId(subDepts[0].id);
        } else {
          setSelectedSubDeptId('');
        }
      } catch (err) {
        console.error('Failed to load sub-departments:', err);
      } finally {
        setIsLoadingSubDepts(false);
      }
    };
    loadSubDepts();
  }, [selectedDeptId, lockedScope]);

  // Update name when month/year changes if name was default
  useEffect(() => {
    const date = new Date(selectedYear, selectedMonth);
    const defaultName = `${format(date, 'MMMM yyyy')} Template`;
    setName(defaultName);
  }, [selectedMonth, selectedYear]);

  // Validation: Check if selected is in the past
  const isPast = useMemo(() => {
    const selected = startOfMonth(new Date(selectedYear, selectedMonth));
    const current = startOfMonth(new Date());
    return selected < current;
  }, [selectedMonth, selectedYear]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPast) {
      setError('Cannot create templates for past months.');
      return;
    }
    setError('');

    const sanitizedName = sanitizeTemplateName(name);

    // Validate
    // Local Format Validation
    const formatValidation = validateTemplateName(sanitizedName);
    if (!formatValidation.valid) {
      setNameError(formatValidation.errors[0]);
      return;
    }

    // Verify IDs are present (double check)
    if (!selectedOrgId || !selectedDeptId || !selectedSubDeptId) {
      const missing = [];
      if (!selectedOrgId) missing.push('Organization');
      if (!selectedDeptId) missing.push('Department');
      if (!selectedSubDeptId) missing.push('Sub-Department');

      console.warn('Validation Missing Fields:', { selectedOrgId, selectedDeptId, selectedSubDeptId, organizations });
      setError(`Please select: ${missing.join(', ')}`);
      return;
    }

    // Backend Uniqueness Validation
    try {
      console.log('[CreateTemplateDialog] Validating name...', { name: sanitizedName, org: selectedOrgId });
      const { data: rpcData, error: rpcError } = await supabase.rpc('validate_template_name', {
        p_name: sanitizedName,
        p_organization_id: selectedOrgId,
        p_department_id: selectedDeptId,
        p_sub_department_id: selectedSubDeptId,
        p_exclude_id: null
      } as any);

      if (rpcError) {
        console.error("Validation RPC error:", rpcError);
        if (rpcError.code !== 'PGRST202') { // Ignore function not found for robustness
          // Warn but don't block? Or block?
        }
      } else {
        const result = rpcData as any;
        if (result && !result.valid) {
          setNameError(result.message || "Template name already exists in this sub-department.");
          return;
        }
      }
    } catch (e) {
      console.error("Validation error:", e);
    }

    setIsCreating(true);

    try {
      await onCreateTemplate({
        name: sanitizedName,
        description: description.trim(),
        month: monthString,
        organizationId: selectedOrgId,
        departmentId: selectedDeptId,
        subDepartmentId: selectedSubDeptId,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to create template');
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    if (!isCreating) {
      onOpenChange(false);
    }
  };

  const canSubmit = name.trim().length >= 3 && !nameError && !isCreating && !isPast && !!selectedSubDeptId;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-[#0d1829] border-white/10 sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <Plus className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <DialogTitle className="text-xl text-white">
                Create New Template
              </DialogTitle>
              <DialogDescription className="text-white/50 text-sm">
                Start with 3 default groups: Convention Centre, Exhibition
                Centre, Theatre
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 py-4">
          {/* Organization / Department / Sub-Department */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-white/70">
                Organization <span className="text-red-400">*</span>
              </Label>
              <Select
                value={selectedOrgId}
                onValueChange={setSelectedOrgId}
                disabled={isLoadingOrgs || !!lockedScope}
              >
                <SelectTrigger className="bg-[#1a2744] border-white/10 text-white">
                  <SelectValue placeholder={isLoadingOrgs ? 'Loading...' : 'Select organization'} />
                </SelectTrigger>
                <SelectContent className="bg-[#1a2744] border-white/10 text-white">
                  {organizations.map(org => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium text-white/70">
                  Department <span className="text-red-400">*</span>
                </Label>
                <Select
                  value={selectedDeptId}
                  onValueChange={setSelectedDeptId}
                  disabled={(!selectedOrgId || isLoadingDepts) || !!lockedScope}
                >
                  <SelectTrigger className="bg-[#1a2744] border-white/10 text-white">
                    <SelectValue placeholder={isLoadingDepts ? 'Loading...' : 'Select department'} />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a2744] border-white/10 text-white">
                    {departments.map(dept => (
                      <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-white/70">
                  Sub-Department <span className="text-red-400">*</span>
                </Label>
                <Select
                  value={selectedSubDeptId}
                  onValueChange={setSelectedSubDeptId}
                  disabled={(!selectedDeptId || isLoadingSubDepts) || !!lockedScope}
                >
                  <SelectTrigger className="bg-[#1a2744] border-white/10 text-white">
                    <SelectValue placeholder={isLoadingSubDepts ? 'Loading...' : 'Select sub-department'} />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a2744] border-white/10 text-white">
                    {subDepartments.map(subDept => (
                      <SelectItem key={subDept.id} value={subDept.id}>{subDept.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Month & Year Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="month" className="text-sm font-medium text-white/70">
                Target Month <span className="text-red-400">*</span>
              </Label>
              <Select
                value={String(selectedMonth)}
                onValueChange={(val) => setSelectedMonth(parseInt(val))}
              >
                <SelectTrigger className="bg-[#1a2744] border-white/10 text-white">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent className="bg-[#1a2744] border-white/10 text-white">
                  {MONTHS.map((m, idx) => (
                    <SelectItem key={m} value={String(idx)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="year" className="text-sm font-medium text-white/70">
                Target Year <span className="text-red-400">*</span>
              </Label>
              <Select
                value={String(selectedYear)}
                onValueChange={(val) => setSelectedYear(parseInt(val))}
              >
                <SelectTrigger className="bg-[#1a2744] border-white/10 text-white">
                  <SelectValue placeholder="Select year" />
                </SelectTrigger>
                <SelectContent className="bg-[#1a2744] border-white/10 text-white">
                  {years.map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Validation Warnings */}
          {isPast && (
            <div className="p-2 rounded bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-xs text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>Cannot create templates for past months.</span>
            </div>
          )}

          {isExistingMonth && (
            <div className="p-3 rounded bg-amber-500/10 border border-amber-500/20 flex items-start gap-2 text-xs text-amber-300">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold mb-1">Template Already Exists</p>
                <p>A template for {MONTHS[selectedMonth]} {selectedYear} already exists.
                  Any new sub-groups or shifts you define will be **appended** to the existing roster when applied.</p>
              </div>
            </div>
          )}

          {/* Template Name */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-sm font-medium text-white/70">
              Template Name <span className="text-red-400">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., January 2025 Template"
              disabled={isCreating}
              className={`bg-[#1a2744] border-white/10 text-white placeholder:text-white/40 focus:border-white/20 ${nameError ? 'border-red-500/50 focus:border-red-500' : ''
                }`}
              autoFocus
            />
            {nameError && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {nameError}
              </p>
            )}
            <p className="text-xs text-white/40">
              Must be at least 3 characters. Must be unique within your
              Sub-Department.
            </p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label
              htmlFor="description"
              className="text-sm font-medium text-white/70"
            >
              Description <span className="text-white/40">(optional)</span>
            </Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this template..."
              disabled={isCreating}
              className="bg-[#1a2744] border-white/10 text-white placeholder:text-white/40 focus:border-white/20 min-h-[80px] resize-none"
            />
          </div>

          {/* Info Box */}
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <div className="flex items-start gap-2">
              <FileText className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
              <div className="text-sm text-blue-300/80">
                <p className="font-medium text-blue-300 mb-1">Default Groups</p>
                <p>
                  Your template will be created with three fixed groups:
                  <span className="text-blue-400"> Convention Centre</span>,
                  <span className="text-emerald-400"> Exhibition Centre</span>,
                  and
                  <span className="text-red-400"> Theatre</span>.
                </p>
              </div>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
        </form>

        <DialogFooter className="gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isCreating}
            className="bg-white/5 border-white/10 text-white hover:bg-white/10 hover:text-white"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[120px] disabled:opacity-50"
          >
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Create Template
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateTemplateDialog;
