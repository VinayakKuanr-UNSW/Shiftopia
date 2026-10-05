/**
 * The frame both leave pages share: the standard header, then the body inside
 * the same rounded card the Roster Planner uses, so leave reads as part of the
 * same product. The body scrolls inside the card; the header stays put.
 */
import React from 'react';
import { Palmtree } from 'lucide-react';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { TooltipProvider } from '@/modules/core/ui/primitives/tooltip';
import type { ScopeMode } from '@/platform/auth/useScopeFilter';

type HeaderProps = React.ComponentProps<typeof GoldStandardHeader>;

export const LeavePageShell: React.FC<{
    title: string;
    mode: ScopeMode;
    scope: HeaderProps['scope'];
    setScope: HeaderProps['setScope'];
    isGammaLocked: HeaderProps['isGammaLocked'];
    /** Omitted ⇒ the header has no function bar row. */
    functionBar?: React.ReactNode;
    children: React.ReactNode;
}> = ({ title, mode, scope, setScope, isGammaLocked, functionBar, children }) => (
    <TooltipProvider delayDuration={150}>
        <div className="h-full flex flex-col overflow-hidden bg-background">
            <GoldStandardHeader
                title={title}
                Icon={Palmtree}
                mode={mode}
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                functionBar={functionBar}
            />
            <div className="flex-1 min-h-0 overflow-hidden px-4 lg:px-6 pb-4 lg:pb-6 flex flex-col">
                <div className="h-full rounded-[24px] sm:rounded-[32px] overflow-hidden transition-all border flex flex-col bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50 dark:bg-[#1c2333]/40 dark:border-white/5 dark:shadow-2xl dark:shadow-black/20 dark:backdrop-blur-xl">
                    <div className="flex-1 overflow-y-auto p-5 sm:p-7 lg:p-8 custom-scrollbar">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    </TooltipProvider>
);
