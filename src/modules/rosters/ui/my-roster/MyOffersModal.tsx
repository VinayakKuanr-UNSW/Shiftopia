import React, { useState } from 'react';
import { format } from 'date-fns';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/modules/core/ui/primitives/alert-dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useMyOffers, useMyOffersHistory, useAcceptOffer, useDeclineOffer } from '@/modules/rosters/state/useRosterShifts';
import { useAuth } from '@/modules/auth/hooks/useAuth';
import { cn } from '@/modules/core/lib/utils';
import {
    Calendar,
    Clock,
    MapPin,
    User,
    FileText,
    Inbox,
    CheckCircle,
    XCircle,
    Loader2,
    AlertCircle,
    Search,
    ChevronRight,
    Sparkles,
    Building,
    Timer,
    Check,
    Layers,
    History as HistoryIcon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { Input } from '@/modules/core/ui/primitives/input';
import { isShiftLocked } from '@/modules/rosters/domain/shift-locking.utils';

type OfferStatus = 'Pending' | 'Accepted' | 'Declined';

interface MyOffersModalProps {
    isOpen: boolean;
    onClose: () => void;
    onOfferResponded?: () => void;
    filters?: {
        organizationId?: string;
        departmentId?: string;
    };
}

interface OfferData {
    id: string;
    shift_id: string;
    status: OfferStatus;
    offered_at: string;
    offered_by_name: string;
    shift: {
        id: string;
        shift_date: string;
        start_time: string;
        end_time: string;
        roles?: { name: string } | null;
        departments?: { name: string } | null;
        sub_departments?: { name: string } | null;
        organizations?: { name: string } | null;
        notes?: string | null;
        break_minutes?: number;
        paid_break_minutes?: number;
        unpaid_break_minutes?: number;
        remuneration_levels?: {
            level_name: string;
            hourly_rate_min: number;
            hourly_rate_max?: number;
            level_number?: number;
        } | null;
    };
}

export const MyOffersModal: React.FC<MyOffersModalProps> = ({
    isOpen,
    onClose,
    onOfferResponded,
    filters,
}) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState<OfferStatus>('Pending');
    const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [showDeclineConfirm, setShowDeclineConfirm] = useState<string | null>(null);

    // Get filters from context or props? 
    // Ideally passed in, but for now we might default to user's org if not provided, 
    // or rely on the parent to pass them. 
    // The user mentioned "Global filter", usually implying a context.
    // Let's assume for now we want ALL unless specific filters are needed.
    // ACTUALLY: User said "Offers are not filtered by the global filter". 
    // This implies we should listen to the global filter context if it exists.
    // However, MyOffers is usually personal. 
    // "Meaning I can accept it from a different department." -> They want to filter OUT offers from other depts?
    // Or they want to SEE offers from other depts but the global filter in the UI is hiding them?
    // Re-reading: "Shift Offers are not filtered by the global filter... Meaning I can accept it from a different department."
    // This sounds like they WANT restriction.
    // Let's import the store hook if available.

    // Using user's current view context if available, otherwise default.
    // For "My Roster" page, there might be filters. 
    // But `MyOffersModal` is often global.
    // Let's use `useRosterStore` or similar if it exists? 
    // Checking previous context: `useRosterState` or `useRosterFilters`?
    // Let's try to find where filters come from in `ManagerSwaps` or `MyRoster`.
    // In `ManagerSwaps`, filters come from local state.
    // In `MyRoster`, likely similar.

    // For now, let's look at `useRosterShifts` usage.
    // I will add optional props for filters to `MyOffersModal` and let the parent pass them.
    // But I can't change the call sites easily without knowing them all.
    // The user said "Global filter", so I assume they mean the filters on the page.
    // I I'll add `organizationId` and `departmentId` to props.

    // Updating logic to fetch based on tab
    // We need to get these from somewhere. 
    // If not passed, we might be showing everything.
    // Let's rely on the hook calls for now.

    // 1. Pending Offers
    const { data: pendingOffers = [], isLoading: isLoadingPending, error: errorPending } = useMyOffers(
        isOpen && user?.id ? user.id : null,
        filters
    );

    // 2. History (Accepted)
    const { data: acceptedOffers = [], isLoading: isLoadingAccepted, error: errorAccepted } = useMyOffersHistory(
        isOpen && user?.id ? user.id : null,
        'Accepted',
        filters
    );

    // 3. History (Declined)
    const { data: declinedOffers = [], isLoading: isLoadingDeclined, error: errorDeclined } = useMyOffersHistory(
        isOpen && user?.id ? user.id : null,
        'Declined',
        filters
    );

    // Combine for display based on tab
    const offers = activeTab === 'Pending' ? pendingOffers as OfferData[]
        : activeTab === 'Accepted' ? acceptedOffers as OfferData[]
            : declinedOffers as OfferData[];

    const isLoading = activeTab === 'Pending' ? isLoadingPending
        : activeTab === 'Accepted' ? isLoadingAccepted
            : isLoadingDeclined;

    // Combine errors
    const error = activeTab === 'Pending' ? errorPending
        : activeTab === 'Accepted' ? errorAccepted
            : errorDeclined;

    // Mutation hooks for accept/decline
    const acceptOfferMutation = useAcceptOffer();
    const declineOfferMutation = useDeclineOffer();

    // Counts
    const pendingCount = pendingOffers.length;
    // We can't easily get total counts for history without fetching them all, 
    // but we are fetching them now so we can use length.
    const acceptedCount = acceptedOffers.length;
    const declinedCount = declinedOffers.length;

    // Filter offers by active tab and search query
    const filteredOffers = (offers || []).filter(o =>
        o.shift.roles?.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (o.shift.sub_departments?.name || o.shift.departments?.name || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Handle Accept
    const handleAccept = async (shiftId: string) => {
        setProcessingId(shiftId);
        try {
            await acceptOfferMutation.mutateAsync(shiftId);
            toast({
                title: 'Engagement Successful',
                description: 'The shift has been successfully integrated into your roster.',
            });
            onOfferResponded?.();
        } catch (err: any) {
            toast({
                title: 'Synchronization Error',
                description: err?.message || 'Failed to accept offer.',
                variant: 'destructive',
            });
        } finally {
            setProcessingId(null);
        }
    };

    // Handle Decline
    const handleDecline = async (shiftId: string) => {
        setProcessingId(shiftId);
        try {
            await declineOfferMutation.mutateAsync(shiftId);
            toast({
                title: 'Offer Returned',
                description: 'The shift has been returned to the public pool.',
            });
            setShowDeclineConfirm(null);
            onOfferResponded?.();
        } catch (err: any) {
            toast({
                title: 'Error',
                description: err?.message || 'Failed to decline offer.',
                variant: 'destructive',
            });
        } finally {
            setProcessingId(null);
        }
    };


    const selectedOffer = Array.from([...pendingOffers, ...acceptedOffers, ...declinedOffers] as OfferData[]).find(o => o.id === selectedOfferId);

    return (
        <>
            <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
                <DialogContent
                    className="sm:max-w-[1040px] h-[720px] max-h-[85vh] bg-background border border-border p-0 overflow-hidden shadow-2xl flex flex-col rounded-[2.5rem] [&>button]:hidden z-[150]"
                >
                    <VisuallyHidden>
                        <DialogTitle>My Shift Offers</DialogTitle>
                        <DialogDescription>
                            Review and respond to shift offers, view your history and audit logs.
                        </DialogDescription>
                    </VisuallyHidden>

                    <div className="flex flex-1 h-full min-h-0">
                        {/* LEFT PANE: INBOX */}
                        <div className="w-[320px] border-r border-border flex flex-col bg-muted/40">
                            <div className="p-8 pb-6">
                                <div className="flex items-center gap-3 mb-8">
                                    <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-600/20 to-blue-400/10 flex items-center justify-center border border-blue-500/20 shadow-lg shadow-blue-500/5">
                                        <Inbox className="h-4.5 w-4.5 text-blue-400" />
                                    </div>
                                    <div className="flex flex-col">
                                        <h2 className="text-lg font-black text-foreground tracking-tight leading-none">Offers</h2>
                                        <p className="text-[9px] text-muted-foreground uppercase font-black tracking-[0.15em] mt-1.5 opacity-80">
                                            My Inbox
                                        </p>
                                    </div>
                                </div>

                                {/* Tab Selector */}
                                <div className="flex p-1 bg-background/50 border border-border rounded-xl mb-6 shadow-sm">
                                    {(['Pending', 'Accepted', 'Declined'] as OfferStatus[]).map((tab) => (
                                        <button
                                            key={tab}
                                            onClick={() => {
                                                setActiveTab(tab);
                                                setSelectedOfferId(null);
                                            }}
                                            className={cn(
                                                "flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all relative z-10",
                                                activeTab === tab ? "text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                            )}
                                        >
                                            {tab}
                                            {activeTab === tab && (
                                                <motion.div layoutId="activeTabGlow" className="absolute inset-0 rounded-lg bg-background ring-1 ring-border -z-10" />
                                            )}
                                        </button>
                                    ))}
                                </div>

                                <div className="relative group">
                                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground group-focus-within:text-blue-500 transition-colors" />
                                    <Input
                                        placeholder="Filter by role..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="bg-background border-border pl-10 text-[10px] h-9 focus:ring-1 focus:ring-blue-500/40 rounded-lg placeholder:text-muted-foreground font-medium text-foreground shadow-sm"
                                    />
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-2 custom-scrollbar">
                                {isLoading ? (
                                    <div className="space-y-2 px-2">
                                        {[1, 2, 3, 4].map(i => (
                                            <Skeleton key={i} className="h-20 w-full rounded-xl bg-white/[0.02]" />
                                        ))}
                                    </div>
                                ) : filteredOffers.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-20 text-center opacity-30">
                                        <Inbox className="h-8 w-8 mb-4 stroke-[1]" />
                                        <p className="text-[10px] font-black uppercase tracking-widest leading-none">Inbox Clear</p>
                                    </div>
                                ) : (
                                    filteredOffers.map((offer) => (
                                        <button
                                            key={offer.id}
                                            onClick={() => setSelectedOfferId(offer.id)}
                                            className={cn(
                                                "w-full text-left p-3.5 rounded-xl border transition-all flex flex-col gap-2 relative overflow-hidden group active:scale-[0.98]",
                                                selectedOfferId === offer.id
                                                    ? "bg-blue-50 text-blue-900 border-blue-200 shadow-sm dark:bg-blue-900/20 dark:border-blue-500/40 dark:text-white"
                                                    : "bg-background border-border hover:border-border/80 hover:bg-muted/50"
                                            )}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className={cn(
                                                    "text-[13px] font-black tracking-tight transition-colors",
                                                    selectedOfferId === offer.id ? "text-blue-700 dark:text-white" : "text-foreground group-hover:text-foreground"
                                                )}>
                                                    {offer.shift.roles?.name || 'Shift'}
                                                </span>
                                                <ChevronRight className={cn(
                                                    "h-3.5 w-3.5 transition-all duration-300",
                                                    selectedOfferId === offer.id ? "text-blue-500 translate-x-1 opacity-100" : "text-muted-foreground opacity-0 group-hover:opacity-100"
                                                )} />
                                            </div>
                                            <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500 tracking-tight">
                                                <div className="flex items-center gap-1">
                                                    <Calendar className="h-3 w-3 opacity-50" />
                                                    {format(new Date(offer.shift.shift_date), 'MMM d')}
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <Clock className="h-3 w-3 opacity-50" />
                                                    {offer.shift.start_time.slice(0, 5)}
                                                </div>
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* MIDDLE PANE: DETAILS */}
                        <div className="flex-1 flex flex-col bg-background relative overflow-hidden h-full">
                            {/* Static background flare */}
                            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/5 blur-[120px] rounded-full pointer-events-none" />
                            <div className="absolute bottom-[-5%] right-[-5%] w-[30%] h-[30%] bg-indigo-600/5 blur-[100px] rounded-full pointer-events-none" />

                            <AnimatePresence mode="wait">
                                {selectedOffer ? (
                                    <motion.div
                                        key={selectedOffer.id}
                                        initial={{ opacity: 0, scale: 0.98, y: 10 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.98, y: -10 }}
                                        transition={{ duration: 0.3, ease: "easeOut" }}
                                        className="flex-1 flex flex-col p-10 relative z-10 overflow-y-auto"
                                    >
                                        <div className="max-w-[480px] mx-auto w-full flex flex-col h-full">
                                            {/* Hero Area */}
                                            <div className="mb-10 text-center">
                                                <div className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full bg-blue-600/10 border border-blue-500/20 shadow-inner shadow-blue-500/5">
                                                    <Sparkles className="h-3.5 w-3.5 text-blue-400" />
                                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-400">
                                                        Shift Deployment
                                                    </span>
                                                </div>
                                                <h2 className="text-4xl font-black text-foreground tracking-tighter leading-none mb-4">
                                                    {selectedOffer.shift.roles?.name || 'Assigned Role'}
                                                </h2>
                                                <p className="text-sm text-muted-foreground font-medium leading-relaxed max-w-[400px] mx-auto">
                                                    {selectedOffer.shift.notes || 'This shift has been specifically selected for your primary skill set and seniority level.'}
                                                </p>
                                            </div>

                                            {/* Detailed Info Cards */}
                                            <div className="space-y-4 mb-10 text-muted-foreground">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="bg-muted/30 border border-border p-4 rounded-2xl">
                                                        <div className="flex items-center gap-2.5 opacity-60 mb-2">
                                                            <Calendar className="h-3.5 w-3.5" />
                                                            <span className="text-[9px] font-black uppercase tracking-widest text-foreground">Date</span>
                                                        </div>
                                                        <div className="text-sm font-black text-foreground px-0.5">
                                                            {format(new Date(selectedOffer.shift.shift_date), 'EEEE, MMMM d')}
                                                        </div>
                                                    </div>
                                                    <div className="bg-muted/30 border border-border p-4 rounded-2xl">
                                                        <div className="flex items-center gap-2.5 opacity-60 mb-2">
                                                            <Clock className="h-3.5 w-3.5" />
                                                            <span className="text-[9px] font-black uppercase tracking-widest text-foreground">Time</span>
                                                        </div>
                                                        <div className="text-sm font-black text-foreground px-0.5">
                                                            {selectedOffer.shift.start_time.slice(0, 5)} - {selectedOffer.shift.end_time.slice(0, 5)}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="bg-muted/30 border border-border p-5 rounded-3xl space-y-4 shadow-sm">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <div className="h-8 w-8 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 flex items-center justify-center border border-emerald-200 dark:border-emerald-500/20">
                                                                <Building className="h-4 w-4" />
                                                            </div>
                                                            <div>
                                                                <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Location</div>
                                                                <div className="text-[11px] font-bold text-foreground">
                                                                    {[
                                                                        selectedOffer.shift.organizations?.name,
                                                                        selectedOffer.shift.departments?.name,
                                                                        selectedOffer.shift.sub_departments?.name
                                                                    ].filter(Boolean).join(' → ')}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {selectedOffer.shift.remuneration_levels && (
                                                            <div className="text-right">
                                                                <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Rate</div>
                                                                <div className="text-xs font-black text-emerald-600 dark:text-emerald-400">
                                                                    ${selectedOffer.shift.remuneration_levels.hourly_rate_min ?? 0}/hr
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <Separator className="bg-border" />

                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 flex items-center justify-center border border-blue-200 dark:border-blue-500/20">
                                                                <Timer className="h-4 w-4" />
                                                            </div>
                                                            <div>
                                                                <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Break Distribution</div>
                                                                <div className="text-[11px] font-bold text-foreground">
                                                                    {selectedOffer.shift.break_minutes ?? 0}m Total ({selectedOffer.shift.unpaid_break_minutes ?? 0}m Unpaid)
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Action Buttons */}
                                            {selectedOffer.status === 'Pending' ? (
                                                <div className="flex flex-col gap-3 mt-auto mb-4">
                                                    <Button
                                                        onClick={() => handleAccept(selectedOffer.shift_id)}
                                                        disabled={processingId === selectedOffer.shift_id}
                                                        className="h-14 rounded-2xl font-black text-sm uppercase tracking-[0.2em] bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_10px_30px_-10px_rgba(16,185,129,0.3)] border-b-4 border-emerald-800 active:scale-[0.98] active:border-b-0 transition-all"
                                                    >
                                                        {processingId === selectedOffer.shift_id ? (
                                                            <Loader2 className="h-5 w-5 animate-spin" />
                                                        ) : (
                                                            <div className="flex items-center gap-2">
                                                                <Check className="h-5 w-5" />
                                                                <span>Confirm Assignment</span>
                                                            </div>
                                                        )}
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        onClick={() => setShowDeclineConfirm(selectedOffer.shift_id)}
                                                        disabled={processingId === selectedOffer.shift_id}
                                                        className="h-12 rounded-2xl font-black text-[10px] uppercase tracking-widest text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
                                                    >
                                                        Decline Shift
                                                    </Button>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center justify-center py-6 mt-auto">
                                                    <div className={cn(
                                                        "inline-flex items-center gap-3 px-8 py-4 rounded-3xl border text-sm font-black uppercase tracking-widest mb-2",
                                                        selectedOffer.status === 'Accepted' ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-red-500/10 border-red-500/30 text-red-400"
                                                    )}>
                                                        {selectedOffer.status === 'Accepted' ? <CheckCircle className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                                                        {selectedOffer.status}
                                                    </div>
                                                    <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                                                        {selectedOffer.status === 'Accepted' ? 'This shift has been successfully appended to your personal schedule' : 'This offer has been returned to the public pool for bidding'}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                ) : (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="h-full flex flex-col items-center justify-center text-center p-12"
                                    >
                                        <div className="h-28 w-28 rounded-[2.5rem] bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/5 flex items-center justify-center mb-10 shadow-2xl">
                                            <Layers className="h-10 w-10 text-slate-700 animate-pulse" />
                                        </div>
                                        <h3 className="text-2xl font-black text-foreground mb-3 tracking-tighter">Engagement Idle</h3>
                                        <p className="text-sm text-muted-foreground max-w-[280px] font-medium leading-relaxed">
                                            Select an offer from your inbox to review terms and synchronize with your roster.
                                        </p>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* RIGHT PANE: AUDIT HISTORY */}
                        <div className="w-[300px] border-l border-border flex flex-col bg-muted/30">
                            <div className="p-10 pb-6">
                                <div className="flex items-center gap-3 mb-8 text-amber-600 dark:text-amber-500/80">
                                    <div className="h-9 w-9 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center border border-amber-200 dark:border-amber-500/20">
                                        <HistoryIcon className="h-4.5 w-4.5" />
                                    </div>
                                    <h2 className="text-xs font-black text-foreground uppercase tracking-widest opacity-80">Audit Log</h2>
                                </div>
                                <Separator className="bg-border" />
                            </div>

                            <div className="flex-1 overflow-y-auto px-8 pb-10 custom-scrollbar">
                                <AnimatePresence mode="wait">
                                    {selectedOffer ? (
                                        <motion.div
                                            key={selectedOffer.id + '_audit'}
                                            initial={{ opacity: 0, x: 10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            className="space-y-6"
                                        >
                                            <div className="relative pl-6 before:absolute before:left-0 before:top-1 before:bottom-0 before:w-px before:bg-border">
                                                {/* Timeline Items */}
                                                <div className="relative mb-8">
                                                    <div className="absolute left-[-26px] top-1 h-3 w-3 rounded-full bg-blue-500 border-2 border-background shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
                                                    <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1.5">Offer Dispatched</div>
                                                    <div className="text-xs font-bold text-foreground">Offered by {selectedOffer.offered_by_name}</div>
                                                    <div className="text-[9px] text-muted-foreground font-medium mt-1 uppercase tracking-tighter">
                                                        {format(new Date(selectedOffer.offered_at), 'MMM d, HH:mm')}
                                                    </div>
                                                </div>

                                                {selectedOffer.status !== 'Pending' && (
                                                    <div className="relative">
                                                        <div className={cn(
                                                            "absolute left-[-26px] top-1 h-3 w-3 rounded-full border-2 border-background",
                                                            selectedOffer.status === 'Accepted' ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"
                                                        )} />
                                                        <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1.5">Outcome Recorded</div>
                                                        <div className="text-xs font-bold text-foreground">
                                                            {selectedOffer.status === 'Accepted' ? 'Integrated to Schedule' : 'Candidate Rejected'}
                                                        </div>
                                                        <div className="text-[9px] text-muted-foreground font-medium mt-1 uppercase tracking-tighter">
                                                            Manual Employee Action
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="mt-20 p-5 rounded-2xl bg-muted/50 border border-border">
                                                <div className="flex gap-3 mb-3">
                                                    <FileText className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                                                    <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Contextual Notes</div>
                                                </div>
                                                <p className="text-[10px] font-medium leading-relaxed text-muted-foreground">
                                                    This engagement log records critical state transitions in the shift lifecycle for compliance and payroll auditing.
                                                </p>
                                            </div>
                                        </motion.div>
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center opacity-10">
                                            <HistoryIcon className="h-10 w-10 mb-4" />
                                            <span className="text-[11px] font-black uppercase tracking-widest italic">Logs Restricted</span>
                                        </div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* Visual Footer for Right Pane */}
                            <div className="p-8 border-t border-border bg-muted/20">
                                <Button
                                    onClick={onClose}
                                    className="w-full h-10 rounded-xl bg-background hover:bg-muted text-foreground text-[10px] font-black uppercase tracking-widest border border-border transition-all shadow-sm"
                                >
                                    Dismiss Portal
                                </Button>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!showDeclineConfirm} onOpenChange={() => setShowDeclineConfirm(null)}>
                <AlertDialogContent className="bg-background border border-border rounded-[2rem] p-8 max-w-sm">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-xl font-black text-foreground tracking-tight">Decline Engagement?</AlertDialogTitle>
                        <AlertDialogDescription className="text-muted-foreground text-sm font-medium">
                            This shift will become available for public bidding. This action is irreversible.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="mt-8 gap-3">
                        <AlertDialogCancel className="h-12 rounded-xl font-black text-[10px] uppercase tracking-widest bg-muted border-border text-foreground hover:bg-muted/80 transition-all">
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            className="flex-1 h-12 rounded-xl font-black text-[10px] uppercase tracking-widest bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow-lg shadow-red-500/10 transition-all"
                            onClick={() => showDeclineConfirm && handleDecline(showDeclineConfirm)}
                            disabled={!!processingId}
                        >
                            {processingId ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Confirm Rejection
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};
