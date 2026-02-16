// Templates Module - Barrel Export
// This file provides a clean public API for the templates module

// API / Service
export * from './api/templates.service';

// Model/Types (includes re-exported utils for backward compatibility)
export * from './model/templates.types';

// State (Legacy hooks - to be deprecated)
export { useTemplates } from './state/useTemplates';
export { useTemplateHandlers } from './state/useTemplateHandlers';

// State (New - for local editor state)
export { useTemplateEditor } from './state/useTemplateEditor';

// Hooks (React Query - for server state)
export * from './hooks';

// UI Constants
export * from './ui/constants';

// Pages
export { default as TemplatesPage } from './pages/TemplatesPage';
