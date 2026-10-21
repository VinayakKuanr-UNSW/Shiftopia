import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { AuthContext } from './AuthProvider';
import { asSelection } from './scope-selection';
import type { ScopeSelection } from './types';

interface ScopeFilterContextType {
    personalScope: ScopeSelection | null;
    setPersonalScope: (scope: ScopeSelection) => void;
    managerialScope: ScopeSelection | null;
    setManagerialScope: (scope: ScopeSelection) => void;
}

const ScopeFilterContext = createContext<ScopeFilterContextType | undefined>(undefined);

/** One device-wide key, shared by everyone who signed in on it. Read never; removed. */
const LEGACY_STORAGE_KEY = 'superman_scope_filters';

/** Each person's own last choice: the next person on this device never inherits it. */
export const scopeStorageKey = (userId: string) => `superman_scope_filters:${userId}`;

interface SavedScopes {
    userId: string | null;
    personal: ScopeSelection | null;
    managerial: ScopeSelection | null;
}

function readSavedScopes(userId: string | null): SavedScopes {
    const none: SavedScopes = { userId, personal: null, managerial: null };
    if (!userId) return none;
    try {
        const raw = localStorage.getItem(scopeStorageKey(userId));
        if (!raw) return none;
        const parsed = JSON.parse(raw);
        return { userId, personal: asSelection(parsed?.personal), managerial: asSelection(parsed?.managerial) };
    } catch {
        // Private mode, blocked storage or a damaged value: start from the defaults.
        return none;
    }
}

export const ScopeFilterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const userId = useContext(AuthContext)?.user?.id ?? null;
    const [saved, setSaved] = useState<SavedScopes>(() => readSavedScopes(userId));

    // Someone else signed in (or out): load their choice, not the last person's.
    if (saved.userId !== userId) {
        setSaved(readSavedScopes(userId));
    }

    useEffect(() => {
        try {
            localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch {
            /* storage unavailable: nothing to remove */
        }
    }, []);

    const setPersonalScope = useCallback((scope: ScopeSelection) => {
        setSaved((s) => ({ ...s, personal: scope }));
    }, []);

    const setManagerialScope = useCallback((scope: ScopeSelection) => {
        setSaved((s) => ({ ...s, managerial: scope }));
    }, []);

    // Persist under the signed-in person's own key.
    useEffect(() => {
        if (!saved.userId) return;
        try {
            localStorage.setItem(
                scopeStorageKey(saved.userId),
                JSON.stringify({ personal: saved.personal, managerial: saved.managerial }),
            );
        } catch {
            /* storage unavailable: the choice lasts for this session only */
        }
    }, [saved]);

    const value = useMemo(() => ({
        personalScope: saved.personal,
        setPersonalScope,
        managerialScope: saved.managerial,
        setManagerialScope,
    }), [saved.personal, saved.managerial, setPersonalScope, setManagerialScope]);

    return (
        <ScopeFilterContext.Provider value={value}>
            {children}
        </ScopeFilterContext.Provider>
    );
};

export const useGlobalScopeContext = () => {
    const context = useContext(ScopeFilterContext);
    if (!context) {
        throw new Error('useGlobalScopeContext must be used within a ScopeFilterProvider');
    }
    return context;
};
