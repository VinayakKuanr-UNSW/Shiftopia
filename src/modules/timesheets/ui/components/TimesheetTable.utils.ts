/**
 * Formats decimal hours as H:MM or H.hh
 */
export const formatHours = (hours: number): string => {
    if (isNaN(hours)) return '0.00';
    return hours.toFixed(2);
};

/**
 * Formats differential with +/- prefix
 */
export const formatDifferential = (hours: number): string => {
    if (isNaN(hours) || hours === 0) return '0.00';
    const prefix = hours > 0 ? '+' : '';
    return `${prefix}${hours.toFixed(2)}`;
};

/**
 * Calculates hours between two HH:mm strings, handling overnight shifts
 */
export const calculateHoursBetween = (startStr?: string, endStr?: string): number => {
    if (!startStr || !endStr) return 0;

    try {
        const [startH, startM] = startStr.split(':').map(Number);
        const [endH, endM] = endStr.split(':').map(Number);

        let startMinutes = startH * 60 + startM;
        let endMinutes = endH * 60 + endM;

        // Handle overnight shift (end time before start time)
        if (endMinutes < startMinutes) {
            endMinutes += 24 * 60;
        }

        return (endMinutes - startMinutes) / 60;
    } catch (e) {
        return 0;
    }
};
