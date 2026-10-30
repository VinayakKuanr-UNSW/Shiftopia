
/**
 * Availability window for UI display (simplified)
 */
export interface AvailabilityWindow {
    start: string; // "HH:MM"
    end: string;   // "HH:MM"
}

/**
 * Employee availability for UI components
 * Compatible with existing AvailabilityBar component
 */
export interface EmployeeAvailability {
    employeeId: string;
    date: string;
    availableWindows: AvailabilityWindow[];
    unavailableWindows: AvailabilityWindow[];
    isFullyAvailable: boolean;
    isFullyUnavailable: boolean;
    hasData: boolean;
}
