/**
 * Global Types Definition File
 * Aggregates types from various modules.
 */

// ===================================
// 1. ROSTERS & SHIFTS
// ===================================
export * from '@/modules/rosters/model/shift.types';

// ===================================
// 2. USERS & EMPLOYEES
// ===================================
export * from '@/modules/users/model/employee.types';

// ===================================
// 3. CORE / ORGANIZATION
// ===================================
export * from '@/modules/core/model/org.types';

// ===================================
// 4. TEMPLATES
// ===================================
export * from '@/modules/templates/model/templates.types';

// ===================================
// 5. BROADCASTS
// ===================================
// Re-export everything except Employee (which conflicts with users module)

// ===================================
// 6. AVAILABILITY
// ===================================
export * from '@/modules/availability/model/availability.types';

// ===================================
// 7. PLANNING (BIDDING/SWAPPING)
// ===================================

// ===================================
// 7. TIMESHEETS
// ===================================


