import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ScopeSelection } from './types';

interface ScopeFilterContextType {
    personalScope: ScopeSelection | null;
    setPersonalScope: (scope: ScopeSelection) => void;
    managerialScope: ScopeSelection | null;
    setManagerialScope: (scope: ScopeSelection) => void;
}

const ScopeFilterContext = createContext<ScopeFilterContextType | undefined>(undefined);

const SESSION_STORAGE_KEY = 'superman_scope_filters';

export const ScopeFilterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [personalScope, setPersonalScopeState] = useState<ScopeSelection | null>(() => {
        if (typeof window === 'undefined') return null;
        const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                return parsed.personal || null;
            } catch (e) {
                return null;
            }
        }
        return null;
    });

    const [managerialScope, setManagerialScopeState] = useState<ScopeSelection | null>(() => {
        if (typeof window === 'undefined') return null;
        const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                return parsed.managerial || null;
            } catch (e) {
                return null;
            }
        }
        return null;
    });

    const setPersonalScope = useCallback((scope: ScopeSelection) => {
        setPersonalScopeState(scope);
    }, []);

    const setManagerialScope = useCallback((scope: ScopeSelection) => {
        setManagerialScopeState(scope);
    }, []);

    // Persist to session storage
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const data = {
            personal: personalScope,
            managerial: managerialScope,
        };
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
    }, [personalScope, managerialScope]);

    return (
        <ScopeFilterContext.Provider
            value={{
                personalScope,
                setPersonalScope,
                managerialScope,
                setManagerialScope,
            }}
        >
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
