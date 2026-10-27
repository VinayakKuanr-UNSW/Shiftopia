/**
 * When every selected shift fails the compliance pre-check, the dialog used to
 * read "Publish 0 Shifts?" with Confirm still enabled and no reasons shown.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/modules/core/ui/primitives/tooltip';
import { BulkActionsToolbar } from '../BulkActionsToolbar';

describe('BulkActionsToolbar publish confirm', () => {
    it('blocks confirming and explains why when nothing passed compliance', async () => {
        const user = userEvent.setup();
        const onPublish = vi.fn();
        render(
            <TooltipProvider>
                <BulkActionsToolbar
                    selectedCount={2}
                    selectedV8ShiftIds={['s1', 's2']}
                    onClearSelection={() => {}}
                    onDelete={vi.fn()}
                    onPublish={onPublish}
                    stateCounts={{ assignedCount: 2, unassignedCount: 0, draftCount: 2, publishedCount: 0 }}
                    onValidatePublish={async () => ({
                        eligible: [],
                        complianceFailed: [
                            { id: 's1', reason: 'Rest gap under 10h' },
                            { id: 's2', reason: 'Rest gap under 10h' },
                        ],
                        skipped: [],
                    })}
                />
            </TooltipProvider>,
        );

        await user.click(screen.getByRole('button', { name: /^publish/i }));

        expect(await screen.findByText('2 × Rest gap under 10h')).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Confirm Publish' }) as HTMLButtonElement).disabled).toBe(true);
        expect(onPublish).not.toHaveBeenCalled();
    });
});
