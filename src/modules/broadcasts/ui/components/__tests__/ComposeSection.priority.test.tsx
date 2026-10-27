/**
 * broadcasts_priority_check allows only normal/high/urgent. Offering "Low" made
 * every Low send fail behind a generic "Failed to send broadcast" toast.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComposeSection } from '../ComposeSection';

vi.mock('../RichTextEditor', () => ({ RichTextEditor: () => null }));

describe('ComposeSection priority options', () => {
    it('offers only the priorities the database accepts', () => {
        render(
            <ComposeSection
                channelId="c1"
                channelName="General"
                groupName="Front of House"
                totalRecipients={3}
                onSend={async () => {}}
            />,
        );

        for (const p of ['normal', 'high', 'urgent']) {
            expect(screen.getByRole('button', { name: new RegExp(`^${p}$`, 'i') })).toBeTruthy();
        }
        expect(screen.queryByRole('button', { name: /^low$/i })).toBeNull();
    });
});
