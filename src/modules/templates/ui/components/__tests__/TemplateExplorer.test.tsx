// src/modules/templates/ui/components/__tests__/TemplateExplorer.test.tsx

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TemplateExplorer, ExplorerTemplate } from '../TemplateExplorer';

const mockTemplates: ExplorerTemplate[] = [
  {
    id: 'tpl-1',
    name: 'Alpha Setup',
    description: 'First test template',
    status: 'draft',
    version: 1,
    groupCount: 2,
    subgroupCount: 4,
    shiftCount: 10,
    updatedAt: '2026-08-16T10:00:00.000Z',
    createdAt: '2026-08-15T10:00:00.000Z',
    organizationName: 'ICC Sydney',
    departmentName: 'Event Delivery',
    subDepartmentName: 'Set-up',
  },
  {
    id: 'tpl-2',
    name: 'Beta Event Baseline',
    description: 'Second test template',
    status: 'draft',
    version: 2,
    groupCount: 4,
    subgroupCount: 8,
    shiftCount: 25,
    updatedAt: '2026-08-16T12:00:00.000Z',
    createdAt: '2026-08-14T10:00:00.000Z',
    organizationName: 'ICC Sydney',
    departmentName: 'Audio Visual',
    subDepartmentName: 'Staging',
  },
  {
    id: 'tpl-3',
    name: 'Zeta Ready Template',
    description: 'Published template',
    status: 'published',
    version: 3,
    groupCount: 1,
    subgroupCount: 2,
    shiftCount: 5,
    updatedAt: '2026-08-16T14:00:00.000Z',
    createdAt: '2026-08-13T10:00:00.000Z',
    organizationName: 'ICC Sydney',
    departmentName: 'Culinary',
  },
];

describe('TemplateExplorer', () => {
  it('renders a file explorer table with template items', () => {
    render(
      <TemplateExplorer
        templates={mockTemplates}
        selectedTemplateId={null}
        onSelectTemplate={vi.fn()}
        onOpenTemplate={vi.fn()}
        onCreateTemplate={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onArchiveTemplate={vi.fn()}
        statusFilter="draft"
        searchQuery=""
        sortBy="updated-desc"
        onSortChange={vi.fn()}
        viewMode="list"
        onViewModeChange={vi.fn()}
      />
    );

    expect(screen.getByText('Alpha Setup')).toBeInTheDocument();
    expect(screen.getByText('Beta Event Baseline')).toBeInTheDocument();
    // Published template should not be displayed in draft view
    expect(screen.queryByText('Zeta Ready Template')).not.toBeInTheDocument();
  });

  it('selects a template on single click', () => {
    const onSelect = vi.fn();
    render(
      <TemplateExplorer
        templates={mockTemplates}
        selectedTemplateId={null}
        onSelectTemplate={onSelect}
        onOpenTemplate={vi.fn()}
        onCreateTemplate={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onArchiveTemplate={vi.fn()}
        statusFilter="draft"
        searchQuery=""
        sortBy="updated-desc"
        onSortChange={vi.fn()}
        viewMode="list"
        onViewModeChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Alpha Setup'));
    expect(onSelect).toHaveBeenCalledWith('tpl-1');
  });

  it('opens the template editor on double click', () => {
    const onOpen = vi.fn();
    render(
      <TemplateExplorer
        templates={mockTemplates}
        selectedTemplateId={null}
        onSelectTemplate={vi.fn()}
        onOpenTemplate={onOpen}
        onCreateTemplate={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onArchiveTemplate={vi.fn()}
        statusFilter="draft"
        searchQuery=""
        sortBy="updated-desc"
        onSortChange={vi.fn()}
        viewMode="list"
        onViewModeChange={vi.fn()}
      />
    );

    fireEvent.doubleClick(screen.getByText('Beta Event Baseline'));
    expect(onOpen).toHaveBeenCalledWith('tpl-2');
  });

  it('opens template editor via keyboard Enter', () => {
    const onOpen = vi.fn();
    render(
      <TemplateExplorer
        templates={mockTemplates}
        selectedTemplateId={null}
        onSelectTemplate={vi.fn()}
        onOpenTemplate={onOpen}
        onCreateTemplate={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onArchiveTemplate={vi.fn()}
        statusFilter="draft"
        searchQuery=""
        sortBy="updated-desc"
        onSortChange={vi.fn()}
        viewMode="list"
        onViewModeChange={vi.fn()}
      />
    );

    const rows = screen.getAllByRole('row');
    // First data row (index 1 after header row)
    fireEvent.keyDown(rows[1], { key: 'Enter' });
    expect(onOpen).toHaveBeenCalled();
  });

  it('triggers onSortChange when clicking table headers', () => {
    const onSortChange = vi.fn();
    render(
      <TemplateExplorer
        templates={mockTemplates}
        selectedTemplateId={null}
        onSelectTemplate={vi.fn()}
        onOpenTemplate={vi.fn()}
        onCreateTemplate={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onArchiveTemplate={vi.fn()}
        statusFilter="draft"
        searchQuery=""
        sortBy="updated-desc"
        onSortChange={onSortChange}
        viewMode="list"
        onViewModeChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Name'));
    expect(onSortChange).toHaveBeenCalledWith('name-asc');
  });

  it('renders grid view when viewMode is grid', () => {
    render(
      <TemplateExplorer
        templates={mockTemplates}
        selectedTemplateId={null}
        onSelectTemplate={vi.fn()}
        onOpenTemplate={vi.fn()}
        onCreateTemplate={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onArchiveTemplate={vi.fn()}
        statusFilter="draft"
        searchQuery=""
        sortBy="updated-desc"
        onSortChange={vi.fn()}
        viewMode="grid"
        onViewModeChange={vi.fn()}
      />
    );

    expect(screen.getByText('Alpha Setup')).toBeInTheDocument();
    expect(screen.getByText('Beta Event Baseline')).toBeInTheDocument();
  });
});
