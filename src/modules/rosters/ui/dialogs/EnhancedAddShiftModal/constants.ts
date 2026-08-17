// The drawer wizard derives its step count from STEP_META.length — the single
// source of truth lives beside the step definitions in ShiftFormDrawerContent.
// A TOTAL_STEPS constant used to live here saying 3 while the drawer rendered 5.

export const TIMEZONES = [
    { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
    { value: 'Australia/Melbourne', label: 'Melbourne (AEST/AEDT)' },
    { value: 'Australia/Brisbane', label: 'Brisbane (AEST)' },
    { value: 'Australia/Perth', label: 'Perth (AWST)' },
];
