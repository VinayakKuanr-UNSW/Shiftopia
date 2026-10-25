/**
 * The frame both leave pages share: the standard header, then the body inside
 * the same rounded card the Roster Planner uses, so leave reads as part of the
 * same product. The body scrolls inside the card; the header stays put.
 */
import React from 'react';
import { Palmtree } from 'lucide-react';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageLayout } from '@/modules/core/ui/layout/PageLayout';
import { page, surface } from '@/modules/core/ui/layout/pageTokens';
import { cn } from '@/modules/core/lib/utils';
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
        <PageLayout>
            <GoldStandardHeader
                title={title}
                Icon={Palmtree}
                mode={mode}
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                functionBar={functionBar}
            />
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                <div className={cn('h-full overflow-hidden flex flex-col', surface.bodyCard)}>
                    <div className={cn('flex-1 overflow-y-auto custom-scrollbar', page.bodyInset)}>
                        {children}
                    </div>
                </div>
            </div>
        </PageLayout>
    </TooltipProvider>
);
