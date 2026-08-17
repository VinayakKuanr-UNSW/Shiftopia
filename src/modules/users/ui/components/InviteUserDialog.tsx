import React, { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { toast } from 'sonner';
import { UserPlus, Copy, Check, ExternalLink } from 'lucide-react';

/**
 * InviteUserDialog
 *
 * Onboarding a new user is already supported end to end — it just wasn't reachable
 * from this page. The chain is:
 *
 *   1. the person registers at /signup (supabase.auth.signUp)
 *   2. the handle_new_user trigger on auth.users creates their profiles row
 *   3. with no active contract, ProtectedRoute parks them on /pending-access
 *   4. an admin grants access from the user's Contracts / Access Certificates section
 *
 * This dialog surfaces step 1 so an admin can hand out the link, and states the
 * remaining steps so nobody assumes the account is live the moment it is created.
 *
 * Creating the auth user directly on the admin's behalf needs
 * supabase.auth.admin.inviteUserByEmail(), which requires the service_role key and
 * therefore an Edge Function — deliberately out of scope here, since that key must
 * never reach the browser.
 */

// Prefer an explicitly configured public URL: inside the Capacitor shell
// window.location.origin is the local WebView host, which is useless to share.
const APP_URL =
    (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.replace(/\/$/, '') ||
    (typeof window !== 'undefined' ? window.location.origin : '');

const SIGNUP_URL = `${APP_URL}/signup`;

export const InviteUserDialog: React.FC<{ className?: string }> = ({ className }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(SIGNUP_URL);
            setCopied(true);
            toast.success('Registration link copied.');
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard is unavailable over plain http and in some WebViews; the
            // input is selectable, so fall back to asking the admin to copy it.
            toast.error('Could not copy automatically — select the link and copy it manually.');
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button className={className}>
                    <UserPlus className="h-3.5 w-3.5 mr-2 shrink-0" />
                    NEW USER
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <div className="flex items-center gap-3 mb-1">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <UserPlus className="w-5 h-5 text-primary" />
                        </div>
                        <DialogTitle className="text-xl font-bold">Add a new user</DialogTitle>
                    </div>
                    <DialogDescription asChild>
                        <div className="text-sm leading-relaxed text-muted-foreground">
                            Send this registration link to the new employee. They set their own
                            password, so no one else ever handles it.
                        </div>
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-center gap-2 mt-2">
                    <Input
                        readOnly
                        value={SIGNUP_URL}
                        onFocus={(e) => e.currentTarget.select()}
                        aria-label="Registration link"
                        className="font-mono text-xs"
                    />
                    <Button
                        variant="outline"
                        onClick={handleCopy}
                        aria-label="Copy registration link"
                        className="shrink-0"
                    >
                        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                </div>

                <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">
                        What happens next
                    </p>
                    <ol className="space-y-2 text-xs text-muted-foreground list-decimal list-inside">
                        <li>They register and their profile is created automatically.</li>
                        <li>
                            Until you grant access they stay on a{' '}
                            <span className="font-semibold text-foreground">pending</span> screen and
                            can see nothing.
                        </li>
                        <li>
                            Select them above, then add a contract under{' '}
                            <span className="font-semibold text-foreground">Access Certificates</span>{' '}
                            to let them in.
                        </li>
                    </ol>
                </div>

                <DialogFooter className="mt-4 gap-2">
                    <Button variant="outline" onClick={() => setIsOpen(false)}>
                        Close
                    </Button>
                    <Button asChild>
                        <a href={SIGNUP_URL} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="w-4 h-4 mr-2" />
                            Open link
                        </a>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default InviteUserDialog;
