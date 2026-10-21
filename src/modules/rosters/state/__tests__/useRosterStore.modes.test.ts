/**
 * Switching roster mode must not strand the manager in DnD mode.
 *
 * DnD is not available in Events mode, so its toolbar toggle is disabled
 * there — and Bulk is disabled while DnD is on. Switching to Events with DnD on
 * therefore left DnD on with no control able to turn it off (and the Unfilled
 * panel open). Entering Events now ends DnD.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useRosterStore } from '../useRosterStore';

beforeEach(() => {
    useRosterStore.setState({ activeMode: 'group', isDnDModeActive: false, showUnfilledPanel: false, bulkModeActive: false });
});

describe('useRosterStore.setActiveMode', () => {
    it('ends DnD mode (and closes its Unfilled panel) when switching to Events', () => {
        useRosterStore.getState().setIsDnDModeActive(true);
        expect(useRosterStore.getState().showUnfilledPanel).toBe(true);

        useRosterStore.getState().setActiveMode('events');

        expect(useRosterStore.getState().isDnDModeActive).toBe(false);
        expect(useRosterStore.getState().showUnfilledPanel).toBe(false);
    });

    it('keeps DnD on between modes that support it', () => {
        useRosterStore.getState().setIsDnDModeActive(true);

        useRosterStore.getState().setActiveMode('people');

        expect(useRosterStore.getState().isDnDModeActive).toBe(true);
    });

    it('still clears the bulk selection on any mode change (unchanged)', () => {
        useRosterStore.getState().setBulkModeActive(true);
        useRosterStore.getState().selectMultiple(['s1']);

        useRosterStore.getState().setActiveMode('roles');

        expect(useRosterStore.getState().bulkModeActive).toBe(false);
        expect(useRosterStore.getState().selectedV8ShiftIds.size).toBe(0);
    });
});
