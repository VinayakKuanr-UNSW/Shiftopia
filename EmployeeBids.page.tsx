            if (eligibilityFilter === 'eligible' && !shift.isEligible) return false;
            if (eligibilityFilter === 'ineligible' && shift.isEligible) return false;

            // Date range filter logic would go here
            if (dateRangeFilter !== 'all') {
                // Implementation for date filtering
            }

            // Debug filter rejection
            // if (shift.role !== roleFilter && roleFilter !== 'all') console.log('Filtered out by role:', shift.role, roleFilter);

            return true;
        });
    };

    const filterBids = (items: BidData[]) => {
        return items.filter((bid) => {
            if (deptFilter !== 'all' && bid.department !== deptFilter) return false;
            if (subDeptFilter !== 'all' && bid.subGroup !== subDeptFilter) return false;
            if (roleFilter !== 'all' && bid.role !== roleFilter) return false;
            if (tierFilter !== 'all' && bid.remunerationLevel !== tierFilter) return false;
            return true;
        });
    };

    // Get filtered and sorted data
    const filteredAvailableShifts = filterShifts(shiftsTableSort.sortedData);
    const filteredMyBids = filterBids(bidsTableSort.sortedData);

    // --------------------------------------------------------------------------
    // 1) Manage Selection State
    //    We'll use a single "selectedBidIds" array to store the IDs of whatever
    //    we've currently selected—shifts in Available tab or bids in My Bids tab.
    // --------------------------------------------------------------------------
    const handleSelectAllAvailable = (isChecked: boolean) => {
        // We only select the shifts that are currently filtered + eligible
        const eligibleShifts = filterShifts(availableShifts)
            .filter((shift) => shift.isEligible)
            .map((shift) => shift.id);
        setSelectedBidIds(isChecked ? eligibleShifts : []);
    };

    // --------------------------------------------------------------------------
    //    Implement "Select All" for "My Bids"
    // --------------------------------------------------------------------------
    const handleSelectAllMyBids = (isChecked: boolean) => {
        // We select all bids in the current (filtered) My Bids
        const allBidIds = filterBids(myBids).map((bid) => bid.id);
        setSelectedBidIds(isChecked ? allBidIds : []);
    };

    // --------------------------------------------------------------------------
    // 3) Handle Individual Selection
    //    Toggles either a shift's ID or a bid's ID (depending on current tab).
    // --------------------------------------------------------------------------
    const handleSelectBid = (id: number) => {
        setSelectedBidIds((prev) =>
            prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
        );
    };

    // --------------------------------------------------------------------------
    // 4) Validate Selections Before Actions
    //    - If action is "express": we check the selected shifts for eligibility.
    //    - If action is "withdraw": we check the selected bids.
    // --------------------------------------------------------------------------
    const validateSelections = (action: 'express' | 'withdraw') => {
        if (action === 'express') {
            // Which shifts did the user select?
            const selectedShifts = availableShifts.filter((shift) =>
                selectedBidIds.includes(shift.id)
            );

            // 1) Ineligible shifts?
            const ineligibleShifts = selectedShifts.filter(
                (shift) => !shift.isEligible
            );
            if (ineligibleShifts.length > 0) {
                toast({
                    title: 'Ineligible Shifts Selected',
                    description: 'Please deselect ineligible shifts before proceeding.',
                    variant: 'destructive',
                });
                return false;
            }

            // 2) Already expressed interest?
            //    i.e. shifts that appear in myBids
            const alreadyProcessed = myBids.filter((bid) =>
                selectedBidIds.includes(bid.shiftId)
            );
            if (alreadyProcessed.length > 0) {
                toast({
                    title: 'Already Expressed Interest',
                    description:
                        'You have already expressed interest in some selected shifts.',
                    variant: 'destructive',
                });
                return false;
            }

            return true;
        } else {
            // action === 'withdraw'
            // We're withdrawing from selected Bids, so let's find them
            const selectedUserBids = myBids.filter((b) =>
                selectedBidIds.includes(b.id)
            );

            // Do not allow withdrawing from "rejected" bids
            const rejected = selectedUserBids.filter((b) => b.status === 'rejected');
            if (rejected.length > 0) {
                toast({
                    title: 'Rejected Bids',
                    description: 'You can\'t withdraw from already rejected bids.',
                    variant: 'destructive',
                });
                return false;
            }

            return true;
        }
    };

    // --------------------------------------------------------------------------
    // 5) Perform Bulk Actions: "Bulk Express" and "Bulk Withdraw"
    // --------------------------------------------------------------------------
    const handleBulkExpressInterest = () => {
        if (!validateSelections('express')) return;

        // Proceed with expressing interest for each selected shift ID
        selectedBidIds.forEach((shiftId) => {
            handleBidForShift(shiftId);
        });

        // Clear selections after action
        setSelectedBidIds([]);
    };

    const handleBulkWithdraw = () => {
        if (!validateSelections('withdraw')) return;

        // Proceed with withdrawing from each selected bid ID
        selectedBidIds.forEach((bidId) => {
            handleWithdrawBid(bidId);
        });

        // Clear selections after action
        setSelectedBidIds([]);
    };

    // HANDLERS
    const handleBidForShift = (shiftId: number) => {
        placeBidMutation.mutate(shiftId);
    };

    const handleWithdrawBid = (bidId: number) => {
        withdrawBidMutation.mutate(bidId);
    };

    // CLEAR FILTERS
    const clearFilters = () => {
        setDeptFilter('all');
        setSubDeptFilter('all');
        setRoleFilter('all');
        setTierFilter('all');
        setEligibilityFilter('all');
        setDateRangeFilter('all');
    };

    return (
        <div className="min-h-screen w-full p-4 md:p-8">
            {/* ENHANCED FILTER BAR */}
            <div className="flex flex-wrap items-center gap-4 mb-6">
                <div className="flex items-center space-x-2 text-white/80 font-semibold">
                    <FilterIcon size={20} />
                    <span>Filters:</span>
                </div>

                {/* DEPARTMENT FILTER */}
                <Select value={deptFilter} onValueChange={setDeptFilter}>
                    <SelectTrigger className="w-[150px] bg-white/5 border-white/10 text-white/80">
                        <SelectValue placeholder="Department" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Depts</SelectItem>
                        <SelectItem value="Convention Centre">Convention Centre</SelectItem>
                        <SelectItem value="Exhibition Centre">Exhibition Centre</SelectItem>
                        <SelectItem value="Theatre">Theatre</SelectItem>
                    </SelectContent>
                </Select>

                {/* SUB-DEPT FILTER */}
                <Select value={subDeptFilter} onValueChange={setSubDeptFilter}>
                    <SelectTrigger className="w-[150px] bg-white/5 border-white/10 text-white/80">
                        <SelectValue placeholder="Sub-Dept" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="AM Base">AM Base</SelectItem>
                        <SelectItem value="AM Assist">AM Assist</SelectItem>
                        <SelectItem value="Bump-In">Bump-In</SelectItem>
                        <SelectItem value="AM Floaters">AM Floaters</SelectItem>
                        <SelectItem value="PM Base">PM Base</SelectItem>
                    </SelectContent>
                </Select>

                {/* ROLE FILTER */}
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="w-[150px] bg-white/5 border-white/10 text-white/80">
                        <SelectValue placeholder="Role" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Roles</SelectItem>
                        <SelectItem value="Team Leader">Team Leader</SelectItem>
                        <SelectItem value="TM3">TM3</SelectItem>
                        <SelectItem value="TM2">TM2</SelectItem>
                        <SelectItem value="Supervisor">Supervisor</SelectItem>
                    </SelectContent>
                </Select>

                {/* TIER FILTER */}
                <Select value={tierFilter} onValueChange={setTierFilter}>
                    <SelectTrigger className="w-[120px] bg-white/5 border-white/10 text-white/80">
                        <SelectValue placeholder="Tier" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Tiers</SelectItem>
                        <SelectItem value="Level-4">Level-4</SelectItem>
                        <SelectItem value="Level-3">Level-3</SelectItem>
                        <SelectItem value="Level-2">Level-2</SelectItem>
                    </SelectContent>
                </Select>

                {/* ELIGIBILITY FILTER (only for Available tab) */}
                {activeTab === 'available' && (
                    <Select value={eligibilityFilter} onValueChange={setEligibilityFilter}>
                        <SelectTrigger className="w-[120px] bg-white/5 border-white/10 text-white/80">
                            <SelectValue placeholder="Eligibility" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="eligible">Eligible</SelectItem>
                            <SelectItem value="ineligible">Ineligible</SelectItem>
                        </SelectContent>
                    </Select>
                )}

                {/* CLEAR ALL FILTERS */}
                <Button
                    variant="outline"
                    className="text-sm text-white/80 border-white/10"
                    onClick={clearFilters}
                >
                    Clear All
                </Button>

                {/* CARD/TABLE VIEW TOGGLE (on the right) */}
                <div className="ml-auto flex items-center gap-2">
                    <Button
                        variant="outline"
                        onClick={() => setViewMode('card')}
                        className={`flex items-center gap-2 text-sm ${viewMode === 'card'
                            ? 'bg-white/10 text-white border-white/20'
                            : 'text-white/80'
                            }`}
                    >
                        <Columns size={16} />
                        Card View
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => setViewMode('table')}
                        className={`flex items-center gap-2 text-sm ${viewMode === 'table'
                            ? 'bg-white/10 text-white border-white/20'
                            : 'text-white/80'
                            }`}
                    >
                        <ListIcon size={16} />
                        Table View
                    </Button>
                </div>
            </div>

            {/* MAIN BIDDING PAGE */}
            <h1 className="text-2xl font-bold mb-6 flex items-center text-white">
                <User className="mr-2 text-purple-400" size={24} />
                Shift Bidding
            </h1>

            <Tabs
                defaultValue="available"
                value={activeTab}
                onValueChange={(val) => setActiveTab(val as typeof activeTab)}
            >
                <TabsList className="bg-black/20 border border-white/10 mb-6">
                    <TabsTrigger
                        value="available"
                        className="data-[state=active]:bg-white/10"
                    >
                        Available Shifts ({filteredAvailableShifts.length})
                    </TabsTrigger>
                    <TabsTrigger
                        value="myBids"
                        className="data-[state=active]:bg-white/10"
                    >
                        My Bids ({filteredMyBids.length})
                    </TabsTrigger>
                </TabsList>

                {/* ---------------------------------------- */}
                {/* TAB 1: AVAILABLE SHIFTS */}
                <TabsContent value="available" className="space-y-6">
                    <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4 flex items-start">
                        <Info className="text-blue-400 mr-3 mt-1" size={20} />
                        <div>
                            <h3 className="text-blue-300 font-medium mb-1">
                                Bidding Information
                            </h3>
                            <p className="text-white/80 text-sm">
                                You can bid on shifts that match your role, department, and
                                sub-department. Click column headers to sort. The system will check your eligibility and work
                                hour compliance before bidding.
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-2 items-center">
                        {/* SELECT ALL Checkbox for Card View */}
                        <div className="flex items-center bg-white/5 px-3 py-2 rounded border border-white/10">
                            <input
                                type="checkbox"
                                checked={filteredAvailableShifts.length > 0 && filteredAvailableShifts.every(s => selectedBidIds.includes(s.id))}
                                onChange={(e) => handleSelectAllAvailable(e.target.checked)}
                                className="mr-2 h-4 w-4"
                            />
                            <span className="text-sm text-white/80">Select All</span>
                        </div>

                        <Button
                            onClick={handleBulkExpressInterest}
                            disabled={selectedBidIds.length === 0}
                        >
                            Express Interest in Selected ({selectedBidIds.length})
                        </Button>
                    </div>

                    {/* SHIFT LIST */}
                    {viewMode === 'card' ? (
                        // --- CARD VIEW ---
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredAvailableShifts.map((shift) => {
                                const coveragePct = getShiftCoveragePercent(
                                    shift.startTime,
                                    shift.endTime
                                );
                                return (
                                    <motion.div
                                        key={shift.id}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.3 }}
                                        className={`p-4 rounded-lg border ${getDeptColor(
                                            shift.groupType,
                                            shift.department
                                        )} transition-all duration-300`}
                                    >
                                        {/* Checkbox for selection */}
                                        <div className="flex items-center mb-2">
                                            <input
                                                type="checkbox"
                                                checked={selectedBidIds.includes(shift.id)}
                                                onChange={() => handleSelectBid(shift.id)}
                                                disabled={!shift.isEligible}
                                                className="mr-2"
                                            />
                                            <span className="text-sm text-white/80">Select</span>
                                        </div>

                                        {/* Shift Header (Refined) */}
                                        <div className="flex justify-between items-start mb-3">
                                            <div className="flex flex-col gap-1 w-full">
                                                <h3 className="font-medium text-white text-base">{shift.role}</h3>
                                                <div className="flex items-center gap-2">
                                                    {/* DEPT NAME + SUB-GROUP BADGE */}
                                                    <span className="text-sm text-white/60">{shift.department}</span>
                                                    {shift.subGroup && shift.subGroup !== 'General' && (
                                                        <Badge variant="outline" className={`text-[10px] px-1.5 h-5 font-normal border ${shift.subGroupColor || 'border-blue-500/30 text-blue-300'}`}>
                                                            {shift.subGroup}
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Date/Time/Break */}
                                        <div className="space-y-2 mb-4 text-sm">
                                            <div className="flex items-center">
                                                <Calendar size={14} className="text-white/60 mr-2" />
                                                <span className="text-white/80">{shift.date} ({shift.weekday})</span>
                                            </div>
                                            {/* VISUAL STATE GRID - 3x2 (Roster Style) */}
                                            <div className="bg-[#0f172a] rounded-lg border border-white/10 p-2 mb-4">
                                                <div className="grid grid-cols-3 gap-y-3 gap-x-1">
                                                    {/* 1. ID */}
                                                    <div className="flex flex-col items-center gap-1">
                                                        <div className="w-4 h-4 flex items-center justify-center font-mono font-bold text-xs text-white/50 border border-white/20 rounded">#</div>
                                                        <span className="text-[9px] font-bold text-blue-400 text-center">{shift.stateId || 'S?'}</span>
                                                    </div>
                                                    {/* 2. LIFECYCLE */}
                                                    <div className="flex flex-col items-center gap-1">
                                                        <Megaphone className="w-4 h-4 text-blue-600" />
                                                        <span className="text-[9px] font-bold text-gray-400 capitalize truncate w-full text-center">Published</span>
                                                    </div>
                                                    {/* 3. ASSIGNMENT */}
                                                    <div className="flex flex-col items-center gap-1">
                                                        {shift.assignedTo ? <UserCheck className="w-4 h-4 text-green-600" /> : <UserPlus className="w-4 h-4 text-amber-500" />}
                                                        <span className="text-[9px] font-bold text-gray-400 capitalize truncate w-full text-center">{shift.assignedTo ? 'Assigned' : 'Unassigned'}</span>
                                                    </div>
                                                    {/* 4. OFFER */}
                                                    <div className="flex flex-col items-center gap-1">
                                                        <Circle className="w-4 h-4 text-gray-300" />
                                                        <span className="text-[9px] font-bold text-gray-400 capitalize truncate w-full text-center">null</span>
                                                    </div>
                                                    {/* 5. BIDDING */}
                                                    <div className="flex flex-col items-center gap-1">
                                                        {shift.isUrgent ? <Flame className="w-4 h-4 text-red-600" /> : <Gavel className="w-4 h-4 text-blue-500" />}
                                                        <span className="text-[9px] font-bold text-gray-400 truncate w-full text-center">{shift.isUrgent ? 'OnBiddingUrgent' : 'OnBiddingNormal'}</span>
                                                    </div>
                                                    {/* 6. TRADE */}
                                                    <div className="flex flex-col items-center gap-1">
                                                        <Minus className="w-4 h-4 text-gray-400" />
                                                        <span className="text-[9px] font-bold text-gray-400 truncate w-full text-center">NoTrade</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* CTA or Ineligible */}
                                        {shift.isEligible ? (
                                            (() => {
                                                const existingBid = myBids.find(b => String(b.shiftId) === String(shift.id) && b.status !== 'withdrawn');
                                                const isBidPlaced = !!existingBid;

                                                // Check expiration for button disable
                                                const isExpired = shift.biddingWindowCloses
                                                    ? new Date(shift.biddingWindowCloses) < new Date()
                                                    : false;

                                                return (
                                                    <Button
                                                        onClick={() => handleBidForShift(shift.id)}
                                                        disabled={isBidPlaced || isExpired}
                                                        className={`w-full text-white ${isBidPlaced || isExpired ? 'bg-white/10 cursor-not-allowed text-white/50' : 'bg-purple-600 hover:bg-purple-700'}`}
                                                    >
                                                        {isBidPlaced ? (
                                                            <>
                                                                <ThumbsUp className="mr-2 h-4 w-4" />
                                                                Bid Placed
                                                            </>
                                                        ) : isExpired ? (
                                                            <>
                                                                <Ban className="mr-2 h-4 w-4" />
                                                                Bidding Closed
                                                            </>
                                                        ) : (
                                                            <>
                                                                <ThumbsUp className="mr-2 h-4 w-4" />
                                                                Express Interest
                                                            </>
                                                        )}
                                                    </Button>
                                                );
                                            })()
                                        ) : (
                                            <div className="bg-red-900/20 border border-red-500/30 rounded-md p-3 text-sm mt-2">
                                                <div className="flex items-center text-red-300 mb-1">
                                                    <ShieldAlert size={14} className="mr-1" />
                                                    <span className="font-medium">Not Eligible</span>
                                                </div>
                                                <p className="text-white/70">
                                                    {shift.ineligibilityReason || 'Reason not provided'}
                                                </p>
                                            </div>
                                        )}
                                    </motion.div>
                                );
                            })}

                            {filteredAvailableShifts.length === 0 && (
                                <div className="text-center py-6 text-white/60 col-span-full">
                                    No shifts match the selected filters.
                                </div>
                            )}
                        </div>
                    ) : (
                        // --- TABLE VIEW ---
                        <div className="overflow-x-auto border border-white/10 rounded-lg">
                            <table className="w-full border-collapse text-white">
                                <thead className="sticky top-0 bg-black/80 z-10 text-sm">
                                    <tr>
                                        <th className="p-4 text-left">
                                            <input
                                                type="checkbox"
                                                checked={filteredAvailableShifts.length > 0 && filteredAvailableShifts.every(s => selectedBidIds.includes(s.id))}
                                                onChange={(e) => handleSelectAllAvailable(e.target.checked)}
                                            />
                                        </th>
                                        <SortableTableHeader
                                            sortKey="department"
                                            currentSort={shiftsTableSort.sortConfig}
                                            onSort={shiftsTableSort.handleSort}
                                        >
                                            Dept
                                        </SortableTableHeader>
                                        <SortableTableHeader
                                            sortKey="subGroup"
                                            currentSort={shiftsTableSort.sortConfig}
                                            onSort={shiftsTableSort.handleSort}
                                        >
                                            Sub-Dept
                                        </SortableTableHeader>
                                        <SortableTableHeader
                                            sortKey="role"
                                            currentSort={shiftsTableSort.sortConfig}
                                            onSort={shiftsTableSort.handleSort}
                                        >
                                            Role
                                        </SortableTableHeader>
                                        <SortableTableHeader
                                            sortKey="remunerationLevel"
                                            currentSort={shiftsTableSort.sortConfig}
                                            onSort={shiftsTableSort.handleSort}
                                        >
                                            Tier
                                        </SortableTableHeader>
                                        <SortableTableHeader
                                            sortKey="date"
                                            currentSort={shiftsTableSort.sortConfig}
                                            onSort={shiftsTableSort.handleSort}
                                        >
                                            Date
                                        </SortableTableHeader>
                                        <th className="p-4 text-left font-semibold">Time</th>
                                        <th className="p-4 text-left font-semibold">Eligibility</th>
                                        <th className="p-4 text-left font-semibold">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="text-sm">
                                    {filteredAvailableShifts.map((shift) => (
                                        <tr
                                            key={shift.id}
                                            className="border-t border-white/10 hover:bg-white/5 transition-colors"
                                        >
                                            <td className="p-4">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedBidIds.includes(shift.id)}
                                                    onChange={() => handleSelectBid(shift.id)}
                                                    disabled={!shift.isEligible}
                                                />
                                            </td>
                                            <td className="p-4">{shift.department}</td>
                                            <td className="p-4">{shift.subGroup}</td>
                                            <td className="p-4">{shift.role}</td>
                                            <td className="p-4">{shift.remunerationLevel}</td>
                                            <td className="p-4">{shift.date}</td>
                                            <td className="p-4">{shift.startTime} - {shift.endTime}</td>
                                            <td className="p-4">
                                                {shift.isEligible ? (
                                                    <span className="text-green-400">Eligible</span>
                                                ) : (
                                                    <span className="text-red-400">Ineligible</span>
                                                )}
                                            </td>
                                            <td className="p-4">
                                                {(() => {
                                                    const existingBid = myBids.find(b => String(b.shiftId) === String(shift.id) && b.status !== 'withdrawn');
                                                    const isBidPlaced = !!existingBid;
                                                    return (
                                                        <Button
                                                            size="sm"
                                                            onClick={() => handleBidForShift(shift.id)}
                                                            disabled={!shift.isEligible || isBidPlaced}
                                                            className={isBidPlaced ? 'bg-green-600/50' : 'bg-purple-600 hover:bg-purple-700'}
                                                        >
                                                            {isBidPlaced ? 'Placed' : 'Bid'}
                                                        </Button>
                                                    );
                                                })()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="myBids" className="space-y-6">
                    <div className="flex gap-2">
                        <Button
                            variant="destructive"
                            onClick={handleBulkWithdraw}
                            disabled={selectedBidIds.length === 0}
                        >
                            Withdraw Selected ({selectedBidIds.length})
                        </Button>
                    </div>

                    {viewMode === 'card' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredMyBids.map((bid) => (
                                <motion.div
                                    key={bid.id}
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="bg-white/5 border border-white/10 p-4 rounded-lg"
                                >
                                    <div className="flex items-center mb-2">
                                        <input
                                            type="checkbox"
                                            checked={selectedBidIds.includes(bid.id)}
                                            onChange={() => handleSelectBid(bid.id)}
                                            className="mr-2"
                                        />
                                        <span className="text-sm text-white/80">Select</span>
                                    </div>
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="flex flex-col gap-1 w-full">
                                            <h3 className="font-medium text-white">{bid.role}</h3>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm text-white/60">{bid.department}</span>
                                                {bid.subGroup && bid.subGroup !== 'General' && (
                                                    <Badge variant="outline" className={`text-[10px] px-1.5 h-5 font-normal border ${bid.subGroupColor || 'border-blue-500/30 text-blue-300'}`}>
                                                        {bid.subGroup}
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                        <BidStatusBadge status={bid.status as any} />
                                    </div>
                                    <div className="space-y-2 mb-4 text-sm text-white/80">
                                        <div className="flex items-center">
                                            <Calendar size={14} className="mr-2 opacity-60" />
                                            {bid.date}
                                        </div>
                                        <div className="flex items-center">
                                            <Clock size={14} className="mr-2 opacity-60" />
                                            {bid.startTime} - {bid.endTime}
                                        </div>
                                    </div>

                                    {/* VISUAL STATE GRID - 3x2 (Roster Style) */}
                                    <div className="bg-[#0f172a] rounded-lg border border-white/10 p-2 mb-4">
                                        <div className="grid grid-cols-3 gap-y-3 gap-x-1">
                                            {/* 1. ID */}
                                            <div className="flex flex-col items-center gap-1">
                                                <div className="w-4 h-4 flex items-center justify-center font-mono font-bold text-xs text-white/50 border border-white/20 rounded">#</div>
                                                <span className="text-[9px] font-bold text-blue-400 text-center">{bid.stateId || 'S?'}</span>
                                            </div>
                                            {/* 2. LIFECYCLE */}
                                            <div className="flex flex-col items-center gap-1">
                                                <Megaphone className="w-4 h-4 text-blue-600" />
                                                <span className="text-[9px] font-bold text-gray-400 capitalize truncate w-full text-center">Published</span>
                                            </div>
                                            {/* 3. ASSIGNMENT */}
                                            <div className="flex flex-col items-center gap-1">
                                                <UserPlus className="w-4 h-4 text-amber-500" />
                                                <span className="text-[9px] font-bold text-gray-400 capitalize truncate w-full text-center">Unassigned</span>
                                            </div>
                                            {/* 4. OFFER */}
                                            <div className="flex flex-col items-center gap-1">
                                                <Circle className="w-4 h-4 text-gray-300" />
                                                <span className="text-[9px] font-bold text-gray-400 capitalize truncate w-full text-center">null</span>
                                            </div>
                                            {/* 5. BIDDING */}
                                            <div className="flex flex-col items-center gap-1">
                                                <Gavel className="w-4 h-4 text-blue-500" />
                                                <span className="text-[9px] font-bold text-gray-400 truncate w-full text-center">OnBiddingNormal</span>
                                            </div>
                                            {/* 6. TRADE */}
                                            <div className="flex flex-col items-center gap-1">
                                                <Minus className="w-4 h-4 text-gray-400" />
                                                <span className="text-[9px] font-bold text-gray-400 truncate w-full text-center">NoTrade</span>
                                            </div>
                                        </div>
                                    </div>
                                    <Button
                                        variant="outline"
                                        className="w-full border-white/10 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20"
                                        onClick={() => handleWithdrawBid(bid.id)}
                                    >
                                        Withdraw Bid
                                    </Button>
                                </motion.div>
                            ))}
                        </div>
                    ) : (
                        <div className="overflow-x-auto border border-white/10 rounded-lg">
                            <table className="w-full border-collapse text-white">
                                <thead className="sticky top-0 bg-black/80 z-10 text-sm">
                                    <tr>
                                        <th className="p-4 text-left">
                                            <input
                                                type="checkbox"
                                                checked={filteredMyBids.length > 0 && filteredMyBids.every(b => selectedBidIds.includes(b.id))}
                                                onChange={(e) => handleSelectAllMyBids(e.target.checked)}
                                            />
                                        </th>
                                        <th className="p-4 text-left font-semibold">Bid Time</th>
                                        <th className="p-4 text-left font-semibold">Details</th>
                                        <th className="p-4 text-left font-semibold">Status</th>
                                        <th className="p-4 text-left font-semibold">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="text-sm">
                                    {filteredMyBids.map((bid) => (
                                        <tr key={bid.id} className="border-t border-white/10 hover:bg-white/5 transition-colors">
                                            <td className="p-4">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedBidIds.includes(bid.id)}
                                                    onChange={() => handleSelectBid(bid.id)}
                                                />
                                            </td>
                                            <td className="p-4">{bid.bidTime}</td>
                                            <td className="p-4">
                                                <div className="font-medium">{bid.role}</div>
                                                <div className="text-xs text-white/60">{bid.department} • {bid.date}</div>
                                            </td>
                                            <td className="p-4">
                                                <BidStatusBadge status={bid.status as any} />
                                            </td>
                                            <td className="p-4">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => handleWithdrawBid(bid.id)}
                                                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                                >
                                                    Withdraw
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
};
