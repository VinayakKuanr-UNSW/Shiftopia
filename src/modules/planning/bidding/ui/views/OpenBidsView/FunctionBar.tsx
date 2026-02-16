// src/modules/planning/ui/views/OpenBidsView/components/FunctionBar.tsx

import React from 'react';
import { Search, Layers } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';
import { Input } from '@/modules/core/ui/primitives/input';
import { cn } from '@/modules/core/lib/utils';
import type {
  FilterState,
  Organization,
  Department,
  SubDepartment,
  ShiftStatus,
  StatusCounts
} from './types';

interface FunctionBarProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filters: FilterState;
  setFilters: (filters: FilterState) => void;
  organizations: Organization[];
  departments: Department[];
  subDepartments: SubDepartment[];
  isBulkMode: boolean;
  toggleBulkMode: () => void;
  counts: StatusCounts;
  isOrgLocked?: boolean;
  isDeptLocked?: boolean;
  isSubDeptLocked?: boolean;
}

export const FunctionBar: React.FC<FunctionBarProps> = ({
  searchQuery,
  setSearchQuery,
  filters,
  setFilters,
  organizations,
  departments,
  subDepartments,
  isBulkMode,
  toggleBulkMode,
  counts,
  isOrgLocked = false,
  isDeptLocked = false,
  isSubDeptLocked = false,
}) => {
  // Filter departments and sub-departments based on selection
  const filteredDepts = filters.orgId
    ? departments.filter((d) => d.organization_id === filters.orgId)
    : departments;

  const filteredSubDepts = filters.deptId
    ? subDepartments.filter((s) => s.department_id === filters.deptId)
    : [];

  const statusButtons: Array<{ status: ShiftStatus; label: string }> = [
    { status: 'urgent', label: 'urgent' },
    { status: 'pending', label: 'pending' },
    { status: 'resolved', label: 'resolved' },
  ];

  const getStatusButtonClass = (status: ShiftStatus, isActive: boolean) => {
    if (!isActive) return 'text-white/40 hover:text-white/60';
    switch (status) {
      case 'urgent':
        return 'bg-red-500/20 text-red-400';
      case 'pending':
        return 'bg-amber-500/20 text-amber-400';
      case 'resolved':
        return 'bg-green-500/20 text-green-400';
    }
  };

  return (
    <div className="h-16 px-4 border-b border-white/10 bg-[#0d1424] flex items-center justify-between gap-4 shrink-0 z-20 relative">
      {/* LEFT: Hierarchy Filters */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar mask-gradient-r">
        <Select
          value={filters.orgId || 'all'}
          onValueChange={(v) =>
            setFilters({ ...filters, orgId: v === 'all' ? '' : v, deptId: '', subDeptId: '' })
          }
          disabled={isOrgLocked}
        >
          <SelectTrigger className="w-[180px] h-9 bg-[#1a1f2e] border-white/10 text-xs">
            <SelectValue placeholder="All Organizations" />
          </SelectTrigger>
          <SelectContent className="bg-[#1a1f2e] border-white/10">
            <SelectItem value="all">All Organizations</SelectItem>
            {organizations.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-white/20">/</span>

        <Select
          value={filters.deptId || 'all'}
          onValueChange={(v) =>
            setFilters({ ...filters, deptId: v === 'all' ? '' : v, subDeptId: '' })
          }
          disabled={isDeptLocked}
        >
          <SelectTrigger className="w-[160px] h-9 bg-[#1a1f2e] border-white/10 text-xs">
            <SelectValue placeholder="All Departments" />
          </SelectTrigger>
          <SelectContent className="bg-[#1a1f2e] border-white/10">
            <SelectItem value="all">All Departments</SelectItem>
            {filteredDepts.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-white/20">/</span>

        <Select
          value={filters.subDeptId || 'all'}
          onValueChange={(v) => setFilters({ ...filters, subDeptId: v === 'all' ? '' : v })}
          disabled={!filters.deptId || isSubDeptLocked}
        >
          <SelectTrigger className="w-[160px] h-9 bg-[#1a1f2e] border-white/10 text-xs disabled:opacity-50">
            <SelectValue placeholder="All Sub-Depts" />
          </SelectTrigger>
          <SelectContent className="bg-[#1a1f2e] border-white/10">
            <SelectItem value="all">All Sub-Depts</SelectItem>
            {filteredSubDepts.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* RIGHT: Search, Bulk, Status */}
      <div className="flex items-center gap-3 ml-auto">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search roles, locations..."
            className="h-9 pl-9 bg-[#1a1f2e] border-white/10 text-xs focus:ring-1 focus:ring-purple-500/50"
          />
        </div>

        <div className="h-6 w-px bg-white/10 mx-1" />

        <Button
          variant={isBulkMode ? 'default' : 'outline'}
          size="sm"
          onClick={toggleBulkMode}
          className={cn(
            'h-9 text-xs gap-2 border-white/10',
            isBulkMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-[#1a1f2e] hover:bg-[#252b3d]'
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          {isBulkMode ? 'Bulk Mode' : 'Bulk Actions'}
        </Button>

        <div className="flex bg-[#1a1f2e] rounded-lg p-1 border border-white/10">
          {statusButtons.map(({ status, label }) => (
            <button
              key={status}
              onClick={() =>
                setFilters({
                  ...filters,
                  status: filters.status === status ? 'all' : status,
                })
              }
              className={cn(
                'px-3 py-1 rounded text-[10px] font-bold uppercase transition-all flex items-center gap-1.5',
                getStatusButtonClass(status, filters.status === status)
              )}
            >
              {label}
              <span
                className={cn(
                  'rounded-full px-1.5 min-w-[16px] text-center',
                  filters.status === status ? 'bg-white/10 text-white' : 'bg-white/5 text-white/30'
                )}
              >
                {counts[status]}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
