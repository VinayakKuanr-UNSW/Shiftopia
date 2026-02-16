/**
 * Tablet Layout for Availability Page
 *
 * Thin wrapper that renders AvailabilityScreen in tablet mode.
 * All logic is handled by the AvailabilityScreen component.
 *
 * Layout: Calendar on top, Logs/Configure tabbed below
 * - TOP: Calendar (read-only slot display)
 * - BOTTOM: Tabbed view for Logs and Configure
 */

import React from 'react';
import { AvailabilityScreen } from '../ui/AvailabilityScreen';

interface AvailabilityTabletLayoutProps {
  // These props are kept for backwards compatibility but are no longer used
  // The AvailabilityScreen manages its own month state
  selectedMonth?: Date;
  onMonthChange?: (month: Date) => void;
}

export const AvailabilityTabletLayout: React.FC<AvailabilityTabletLayoutProps> = () => {
  return <AvailabilityScreen layout="tablet" />;
};

export default AvailabilityTabletLayout;
