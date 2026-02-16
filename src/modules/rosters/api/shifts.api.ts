import { shiftsCommands } from './shifts.commands';
import { shiftsQueries } from './shifts.queries';

// Re-export domain types
export * from '../domain/shift.entity';

// Re-export DTOs
export * from './shifts.dto';

// Re-export services for direct usage if needed
export { shiftsCommands } from './shifts.commands';
export { shiftsQueries } from './shifts.queries';

// Combined API for backward compatibility with existing code
export const shiftsApi = {
    ...shiftsCommands,
    ...shiftsQueries,
};
