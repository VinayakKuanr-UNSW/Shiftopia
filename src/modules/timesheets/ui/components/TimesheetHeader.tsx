import React, { useState } from 'react';
import {
    Calendar,
    Download,
    RefreshCw,
    ChevronLeft,
    ChevronRight,
    FileSpreadsheet,
    FileText,
    Search,
    Filter,
    X,
    Building2,
    Layers,
    GitBranch,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { format, addDays, subDays } from 'date-fns';
import { Tabs, TabsList, TabsTrigger } from '@/modules/core/ui/primitives/tabs';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import { Calendar as CalendarComponent } from '@/modules/core/ui/primitives/calendar';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import { Badge } from '@/modules/core/ui/primitives/badge';

interface Organization {
    id: string;
    name: string;
}

interface Department {
    id: string;
    name: string;
}

interface SubDepartment {
    id: string;
    name: string;
}

interface TimesheetHeaderProps {
    selectedDate: Date;
    onDateChange: (date: Date) => void;
    onViewChange: (view: 'table' | 'group') => void;
    statusFilter: string | null;
    onStatusFilterChange: (status: string | null) => void;
    onExportPDF: () => void;
    onExportSpreadsheet: () => void;
    onRefresh: () => void;
    isRefreshing: boolean;

    // Global filter data
    organizations: Organization[];
    departments: Department[];
    subDepartments: SubDepartment[];
    selectedOrganizationId: string | null;
    selectedDepartmentId: string | null;
    selectedSubDepartmentId: string | null;
    onOrganizationChange: (id: string | null) => void;
    onDepartmentChange: (id: string | null) => void;

    onSubDepartmentChange: (id: string | null) => void;
    isOrgLocked?: boolean;
    isDeptLocked?: boolean;
    isSubDeptLocked?: boolean;

    // Secondary filter props
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    departmentFilter: string;
    setDepartmentFilter: (department: string) => void;
    subGroupFilter: string;
    setSubGroupFilter: (subGroup: string) => void;
    roleFilter: string;
    setRoleFilter: (role: string) => void;
    tierFilter: string;
    setTierFilter: (tier: string) => void;
    onClearFilters: () => void;
    activeFilterCount: number;
}

export const TimesheetHeader: React.FC<TimesheetHeaderProps> = ({
    selectedDate,
    onDateChange,
    onViewChange,
    statusFilter,
    onStatusFilterChange,
    onExportPDF,
    onExportSpreadsheet,
    onRefresh,
    isRefreshing,
    // Global filters
    organizations,
    departments,
    subDepartments,
    selectedOrganizationId,
    selectedDepartmentId,
    selectedSubDepartmentId,
    onOrganizationChange,
    onDepartmentChange,
    onSubDepartmentChange,
    isOrgLocked = false,
    isDeptLocked = false,
    isSubDeptLocked = false,
    // Secondary filters
    searchQuery,
    setSearchQuery,
    departmentFilter,
    setDepartmentFilter,
    subGroupFilter,
    setSubGroupFilter,
    roleFilter,
    setRoleFilter,
    tierFilter,
    setTierFilter,
    onClearFilters,
    activeFilterCount,
}) => {
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);

    const goToPreviousDay = () => {
        const newDate = subDays(selectedDate, 1);
        onDateChange(newDate);
    };

    const goToNextDay = () => {
        const newDate = addDays(selectedDate, 1);
        onDateChange(newDate);
    };

    return (
        <div className="space-y-4 text-white">
            {/* Title Row with Global Filters */}
            <div className="flex flex-col gap-4">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex items-center">
                        <Calendar className="mr-2 text-primary" size={24} />
                        <h1 className="text-2xl font-bold">Timesheets</h1>
                    </div>

                    <div className="flex flex-wrap gap-2 ml-auto">
                        {/* Export Dropdown */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="default"
                                    className="bg-primary hover:bg-primary/90"
                                    size="sm"
                                >
                                    <Download className="mr-1.5 h-4 w-4" />
                                    Export
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-gray-900/95 backdrop-blur-xl border-gray-800">
                                <DropdownMenuItem onClick={onExportPDF} className="cursor-pointer">
                                    <FileText className="mr-2 h-4 w-4" />
                                    Export as PDF
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={onExportSpreadsheet} className="cursor-pointer">
                                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                                    Export as Spreadsheet
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onRefresh}
                            disabled={isRefreshing}
                        >
                            <RefreshCw className={`mr-1.5 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                            {isRefreshing ? 'Refreshing...' : 'Refresh'}
                        </Button>
                    </div>
                </div>

                {/* Global Organization Filters */}
                <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                    {/* Organization */}
                    <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-blue-400" />
                        <Select
                            value={selectedOrganizationId || ''}
                            onValueChange={(val) => onOrganizationChange(val || null)}
                            disabled={isOrgLocked}
                        >
                            <SelectTrigger className="w-[180px] bg-white/5 border-white/10">
                                <SelectValue placeholder="Select Organization" />
                            </SelectTrigger>
                            <SelectContent className="bg-gray-900/95 backdrop-blur-xl border-gray-800 text-white">
                                {organizations.map((org) => (
                                    <SelectItem key={org.id} value={org.id}>
                                        {org.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <ChevronRight className="h-4 w-4 text-white/30" />

                    {/* Department */}
                    <div className="flex items-center gap-2">
                        <Layers className="h-4 w-4 text-emerald-400" />
                        <Select
                            value={selectedDepartmentId || ''}
                            onValueChange={(val) => onDepartmentChange(val || null)}
                            disabled={!selectedOrganizationId || departments.length === 0 || isDeptLocked}
                        >
                            <SelectTrigger className="w-[180px] bg-white/5 border-white/10">
                                <SelectValue placeholder="Select Department" />
                            </SelectTrigger>
                            <SelectContent className="bg-gray-900/95 backdrop-blur-xl border-gray-800 text-white">
                                {departments.map((dept) => (
                                    <SelectItem key={dept.id} value={dept.id}>
                                        {dept.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <ChevronRight className="h-4 w-4 text-white/30" />

                    {/* Sub-Department */}
                    <div className="flex items-center gap-2">
                        <GitBranch className="h-4 w-4 text-purple-400" />
                        <Select
                            value={selectedSubDepartmentId || ''}
                            onValueChange={(val) => onSubDepartmentChange(val || null)}
                            disabled={!selectedDepartmentId || subDepartments.length === 0 || isSubDeptLocked}
                        >
                            <SelectTrigger className="w-[180px] bg-white/5 border-white/10">
                                <SelectValue placeholder="Select Sub-Department" />
                            </SelectTrigger>
                            <SelectContent className="bg-gray-900/95 backdrop-blur-xl border-gray-800 text-white">
                                {subDepartments.map((subDept) => (
                                    <SelectItem key={subDept.id} value={subDept.id}>
                                        {subDept.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            {/* Search, Date Picker, and Filters Row */}
            <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
                {/* Search Bar */}
                <div className="relative flex-1 min-w-[200px] max-w-md">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-white/50" />
                    <Input
                        placeholder="Search employee, ID, role..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 bg-white/5 border-white/10"
                    />
                    {searchQuery && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6"
                            onClick={() => setSearchQuery('')}
                        >
                            <X className="h-3 w-3" />
                        </Button>
                    )}
                </div>

                {/* Date Navigation */}
                <div className="flex items-center bg-black/20 p-1.5 rounded-md border border-white/10">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={goToPreviousDay}
                        className="h-8 w-8 p-0"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>

                    <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" className="mx-1 px-3 h-8 font-medium text-sm">
                                <Calendar className="mr-2 h-4 w-4" />
                                {format(selectedDate, 'MMM dd, yyyy')}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 bg-gray-900/95 backdrop-blur-xl border-gray-800 text-white">
                            <CalendarComponent
                                mode="single"
                                selected={selectedDate}
                                onSelect={(date) => {
                                    if (date) {
                                        onDateChange(date);
                                        setIsCalendarOpen(false);
                                    }
                                }}
                                initialFocus
                            />
                        </PopoverContent>
                    </Popover>

                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={goToNextDay}
                        className="h-8 w-8 p-0"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>

                {/* Filter Popover */}
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="bg-white/5 border-white/10 relative">
                            <Filter className="mr-2 h-4 w-4" />
                            Filters
                            {activeFilterCount > 0 && (
                                <Badge className="ml-2 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs">
                                    {activeFilterCount}
                                </Badge>
                            )}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-4 bg-gray-900/95 backdrop-blur-xl border-gray-800 text-white">
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <h3 className="font-medium">Filters</h3>
                                <Button variant="ghost" size="sm" onClick={onClearFilters} className="h-8 px-2 text-xs">
                                    <X className="mr-1 h-3 w-3" />
                                    Clear All
                                </Button>
                            </div>

                            {/* Group Type Filter */}
                            <div className="space-y-2">
                                <label className="text-sm">Group Type</label>
                                <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                                    <SelectTrigger className="bg-white/5 border-white/10">
                                        <SelectValue placeholder="All Groups" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-gray-900/95 backdrop-blur-xl border-gray-800 text-white">
                                        <SelectItem value="all">All Groups</SelectItem>
                                        <SelectItem value="convention_centre">Convention Centre</SelectItem>
                                        <SelectItem value="exhibition_centre">Exhibition Centre</SelectItem>
                                        <SelectItem value="theatre">Theatre</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Sub-Group Filter */}
                            <div className="space-y-2">
                                <label className="text-sm">Sub-Group</label>
                                <Select value={subGroupFilter} onValueChange={setSubGroupFilter}>
                                    <SelectTrigger className="bg-white/5 border-white/10">
                                        <SelectValue placeholder="All Sub-Groups" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-gray-900/95 backdrop-blur-xl border-gray-800 text-white">
                                        <SelectItem value="all">All Sub-Groups</SelectItem>
                                        <SelectItem value="AM Base">AM Base</SelectItem>
                                        <SelectItem value="AM Assist">AM Assist</SelectItem>
                                        <SelectItem value="PM Base">PM Base</SelectItem>
                                        <SelectItem value="PM Assist">PM Assist</SelectItem>
                                        <SelectItem value="Graveyard">Graveyard</SelectItem>
                                        <SelectItem value="Bump-In">Bump-In</SelectItem>
                                        <SelectItem value="Bump-Out">Bump-Out</SelectItem>
                                        <SelectItem value="Setup">Setup</SelectItem>
                                        <SelectItem value="Packdown">Packdown</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Role Filter */}
                            <div className="space-y-2">
                                <label className="text-sm">Role</label>
                                <Select value={roleFilter} onValueChange={setRoleFilter}>
                                    <SelectTrigger className="bg-white/5 border-white/10">
                                        <SelectValue placeholder="All Roles" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-gray-900/95 backdrop-blur-xl border-gray-800 text-white">
                                        <SelectItem value="all">All Roles</SelectItem>
                                        <SelectItem value="Team Leader">Team Leader</SelectItem>
                                        <SelectItem value="TM3">TM3</SelectItem>
                                        <SelectItem value="TM2">TM2</SelectItem>
                                        <SelectItem value="Coordinator">Coordinator</SelectItem>
                                        <SelectItem value="Supervisor">Supervisor</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Tier/Remuneration Level Filter */}
                            <div className="space-y-2">
                                <label className="text-sm">Remuneration Level</label>
                                <Select value={tierFilter} onValueChange={setTierFilter}>
                                    <SelectTrigger className="bg-white/5 border-white/10">
                                        <SelectValue placeholder="All Levels" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-gray-900/95 backdrop-blur-xl border-gray-800 text-white">
                                        <SelectItem value="all">All Levels</SelectItem>
                                        <SelectItem value="Level 1">Level 1</SelectItem>
                                        <SelectItem value="Level 2">Level 2</SelectItem>
                                        <SelectItem value="Level 3">Level 3</SelectItem>
                                        <SelectItem value="Level 4">Level 4</SelectItem>
                                        <SelectItem value="Level 5">Level 5</SelectItem>
                                        <SelectItem value="Level 6">Level 6</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Live Status Filter */}
                            <div className="space-y-2">
                                <label className="text-sm">Live Status</label>
                                <Select
                                    value={statusFilter || 'all'}
                                    onValueChange={(value) => onStatusFilterChange(value === 'all' ? null : value)}
                                >
                                    <SelectTrigger className="bg-white/5 border-white/10">
                                        <SelectValue placeholder="All Statuses" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-gray-900/95 backdrop-blur-xl border-gray-800 text-white">
                                        <SelectItem value="all">All Statuses</SelectItem>
                                        <SelectItem value="open">Open</SelectItem>
                                        <SelectItem value="assigned">Assigned</SelectItem>
                                        <SelectItem value="confirmed">Confirmed</SelectItem>
                                        <SelectItem value="completed">Completed</SelectItem>
                                        <SelectItem value="cancelled">Cancelled</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </PopoverContent>
                </Popover>

                {/* View Toggle */}
                <div className="ml-auto">
                    <Tabs value="table" className="w-auto">
                        <TabsList className="bg-black/20 border border-white/10">
                            <TabsTrigger
                                value="table"
                                className="data-[state=active]:bg-white/10"
                                onClick={() => onViewChange('table')}
                            >
                                Table
                            </TabsTrigger>
                            <TabsTrigger
                                value="group"
                                className="data-[state=active]:bg-white/10"
                                onClick={() => onViewChange('group')}
                            >
                                Group
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>
            </div>

            {/* Active Filters Display */}
            {activeFilterCount > 0 && (
                <div className="flex flex-wrap gap-2">
                    {searchQuery && (
                        <Badge variant="outline" className="bg-white/10 gap-1 px-2 py-1">
                            Search: "{searchQuery}"
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 ml-1 p-0"
                                onClick={() => setSearchQuery('')}
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        </Badge>
                    )}
                    {departmentFilter !== 'all' && (
                        <Badge variant="outline" className="bg-white/10 gap-1 px-2 py-1">
                            Group: {departmentFilter}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 ml-1 p-0"
                                onClick={() => setDepartmentFilter('all')}
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        </Badge>
                    )}
                    {subGroupFilter !== 'all' && (
                        <Badge variant="outline" className="bg-white/10 gap-1 px-2 py-1">
                            Sub-Group: {subGroupFilter}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 ml-1 p-0"
                                onClick={() => setSubGroupFilter('all')}
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        </Badge>
                    )}
                    {roleFilter !== 'all' && (
                        <Badge variant="outline" className="bg-white/10 gap-1 px-2 py-1">
                            Role: {roleFilter}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 ml-1 p-0"
                                onClick={() => setRoleFilter('all')}
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        </Badge>
                    )}
                    {tierFilter !== 'all' && (
                        <Badge variant="outline" className="bg-white/10 gap-1 px-2 py-1">
                            Level: {tierFilter}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 ml-1 p-0"
                                onClick={() => setTierFilter('all')}
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        </Badge>
                    )}
                    {statusFilter && (
                        <Badge variant="outline" className="bg-white/10 gap-1 px-2 py-1">
                            Status: {statusFilter}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 ml-1 p-0"
                                onClick={() => onStatusFilterChange(null)}
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        </Badge>
                    )}
                    {activeFilterCount > 1 && (
                        <Button variant="outline" size="sm" onClick={onClearFilters} className="h-7 px-2 py-0 text-xs">
                            Clear All Filters
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
};
