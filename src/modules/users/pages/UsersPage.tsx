import React, { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { useAuth } from '@/platform/auth/useAuth';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { todayISO } from '@/modules/core/lib/date.utils';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageLayout } from '@/modules/core/ui/layout/PageLayout';
import { UserManagementFunctionBar, type UsersExportFormat } from '../ui/components/UserManagementFunctionBar';
import { UsersTable } from '../ui/components/UsersTable';
import { useUsersTable } from '../hooks/useUsersTable';
import { coversWholeTree, exportRows, searchGroups, type PersonGroup } from '../domain/usersTable';
import { useColumnVisibility } from '../ui/usersTableColumns';
import type { ScopeSelection } from '@/platform/auth/types';

/** "Event Setup, Ushering" — the scope in words, from the places of the rows in it. */
function scopeLabelOf(scope: ScopeSelection, groups: readonly PersonGroup[]): string {
    const contracts = groups.flatMap((g) => g.contracts);
    const names = (ids: string[], pick: (c: (typeof contracts)[number]) => [string | null | undefined, string | undefined]) =>
        [...new Set(contracts.map(pick).filter(([id, name]) => id && ids.includes(id) && name).map(([, name]) => name as string))];
    if (scope.subdept_ids.length) return names(scope.subdept_ids, (c) => [c.sub_department_id, c.sub_departments?.name]).join(', ') || 'Selected sub-departments';
    if (scope.dept_ids.length) return names(scope.dept_ids, (c) => [c.department_id, c.departments?.name]).join(', ') || 'Selected departments';
    if (scope.org_ids.length) return names(scope.org_ids, (c) => [c.organization_id, c.organizations?.name]).join(', ') || 'Selected organizations';
    return 'Everyone';
}

/**
 * User Management (2026-10-17): the page is one table — a row per contract —
 * inside the global scope chosen in the header (any number of departments and
 * sub-departments), narrowed by the search in the function bar.
 */
const UsersPage: React.FC = () => {
    const { hasPermission } = useAuth();
    const { toast } = useToast();
    const { scope, setScope, isGammaLocked, scopeTree } = useScopeFilter('managerial');
    // Admin suite: zeta only, matching the database's grant rules.
    const isAuthorizedAdmin = hasPermission('users');

    // Every place chosen is "everyone": that includes people still waiting for a contract.
    const table = useUsersTable(scope, { includeUnplaced: coversWholeTree(scope, scopeTree) });
    const scopeLabel = useMemo(() => scopeLabelOf(scope, table.groups), [scope, table.groups]);

    const [search, setSearch] = useState('');
    const shown = useMemo(() => searchGroups(table.groups, search), [table.groups, search]);
    const totals = useMemo(() => ({
        people: table.groups.length,
        contracts: table.groups.reduce((n, g) => n + g.contracts.length, 0),
    }), [table.groups]);
    const [columns, setColumns] = useColumnVisibility();

    const [exporting, setExporting] = useState(false);
    const onExport = async (fmt: UsersExportFormat) => {
        setExporting(true);
        try {
            // The rows the table shows: the scope, narrowed by the search.
            const rows = exportRows(shown, todayISO());
            const exporter = await import('../ui/users.export');
            if (fmt === 'xlsx') await exporter.exportUsersXLSX(rows, scopeLabel);
            else await exporter.exportUsersPDF(rows, scopeLabel);
        } catch (e) {
            console.error('[UsersPage] export failed:', e);
            toast({ variant: 'destructive', title: 'Export failed', description: (e as { message?: string })?.message ?? 'Try again.' });
        } finally {
            setExporting(false);
        }
    };

    return (
        <PageLayout className="text-foreground">
            <GoldStandardHeader
                title="User Management"
                Icon={Users}
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                mode="managerial"
                // A list to narrow, not one place to work in: choose any number of each.
                multiSelect
                functionBar={
                    <UserManagementFunctionBar
                        isAdmin={isAuthorizedAdmin}
                        onExport={onExport}
                        exportDisabled={exporting || table.isLoading || shown.length === 0}
                        search={search}
                        onSearchChange={setSearch}
                        columns={columns ?? {}}
                        onColumnsChange={setColumns}
                        transparent
                    />
                }
            />

            {/* The table is the body. A region, not <main>: AppLayout already
                renders the page's one main landmark around every route. */}
            <section aria-label="Users" className="flex-1 min-h-0 min-w-0 w-full overflow-hidden">
                <UsersTable
                    groups={shown}
                    totals={totals}
                    search={search}
                    onClearSearch={() => setSearch('')}
                    columns={columns ?? {}}
                    isLoading={table.isLoading}
                    isError={table.isError}
                    onRetry={table.refetch}
                    contractsOf={table.contractsOf}
                    refresh={table.refresh}
                    canManage={isAuthorizedAdmin}
                />
            </section>
        </PageLayout>
    );
};

export default UsersPage;
