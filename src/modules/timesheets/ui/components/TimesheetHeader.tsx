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
        <div className="space-y-6">
            {/* Title Row */}
            <div className="flex flex-col gap-4">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm">
                            <Calendar className="h-5 w-5 text-primary" />
                        </div>
                        <h1 className="text-2xl font-black tracking-tight text-foreground">Timesheets</h1>
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
                            className="bg-card border-border hover:bg-muted font-bold"
                        >
                            <RefreshCw className={`mr-1.5 h-4 w-4 text-primary ${isRefreshing ? 'animate-spin' : ''}`} />
                            {isRefreshing ? 'Refreshing...' : 'Refresh'}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Search, Date Picker, and Filters Row */}
            <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
                {/* Search Bar */}
                <div className="relative flex-1 min-w-[200px] max-w-md group">
                    <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground/50 group-focus-within:text-primary transition-colors" />
                    <Input
                        placeholder="Search employee, ID, role..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10 bg-muted/30 border-border h-11 rounded-xl focus:ring-1 focus:ring-primary/40 transition-all font-medium"
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
                <div className="flex items-center bg-muted/30 p-1.5 rounded-xl border border-border shadow-sm">
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
                            <Button variant="ghost" className="mx-1 px-4 h-9 font-black text-sm text-foreground hover:bg-primary/5 rounded-lg">
                                <Calendar className="mr-2 h-4 w-4 text-primary" />
                                {format(selectedDate, 'MMM dd, yyyy')}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 bg-popover border-border rounded-2xl shadow-2xl">
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
                        <Button variant="ghost" size="sm" className="bg-muted/30 border border-border hover:bg-muted rounded-xl h-11 px-4 relative group transition-all">
                            <Filter className="mr-2 h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                            <span className="font-bold text-foreground">Filters</span>
                            {activeFilterCount > 0 && (
                                <Badge className="ml-2 h-5 w-5 rounded-full p-0 flex items-center justify-center text-[10px] font-black bg-primary text-primary-foreground animate-in zoom-in">
                                    {activeFilterCount}
                                </Badge>
                            )}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-5 bg-popover border-border rounded-2xl shadow-2xl">
                        <div className="space-y-4">
                            <div className="flex justify-between items-center mb-1">
                                <h3 className="font-black text-xs uppercase tracking-widest text-muted-foreground/60">Search Config</h3>
                                <Button variant="ghost" size="sm" onClick={onClearFilters} className="h-7 px-2 text-[10px] font-black uppercase tracking-tighter text-red-500 hover:bg-red-500/10">
                                    <X className="mr-1 h-3 w-3" />
                                    Reset
                                </Button>
                            </div>

                            {/* Group Type Filter */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">Group Type</label>
                                <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                                    <SelectTrigger className="bg-muted/30 border-border rounded-xl">
                                        <SelectValue placeholder="All Groups" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-popover border-border rounded-xl shadow-2xl">
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
                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">Live Status</label>
                                <Select
                                    value={statusFilter || 'all'}
                                    onValueChange={(value) => onStatusFilterChange(value === 'all' ? null : value)}
                                >
                                    <SelectTrigger className="bg-muted/30 border-border rounded-xl">
                                        <SelectValue placeholder="All Statuses" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-popover border-border rounded-xl shadow-2xl">
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

                <div className="ml-auto">
                    <Tabs value="table" className="w-auto">
                        <TabsList className="bg-muted/30 border border-border p-1 h-11 rounded-xl">
                            <TabsTrigger
                                value="table"
                                className="data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-lg px-6 font-bold"
                                onClick={() => onViewChange('table')}
                            >
                                Table
                            </TabsTrigger>
                            <TabsTrigger
                                value="group"
                                className="data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-lg px-6 font-bold"
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
