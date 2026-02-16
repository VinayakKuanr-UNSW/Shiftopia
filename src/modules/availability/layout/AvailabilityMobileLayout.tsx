/**
 * Mobile Layout for Availability Page
 *
 * Thin wrapper that renders AvailabilityScreen in mobile mode.
 * All logic is handled by the AvailabilityScreen component.
 *
 * Layout: Single column with bottom tab navigation
 * - Tabs: Calendar | Rules | Configure
 * - Only one pane visible at a time
 */

import React from 'react';
import { AvailabilityScreen } from '../ui/AvailabilityScreen';

interface AvailabilityMobileLayoutProps {
  // These props are kept for backwards compatibility but are no longer used
  // The AvailabilityScreen manages its own month state
  selectedMonth?: Date;
  onMonthChange?: (month: Date) => void;
}

export const AvailabilityMobileLayout: React.FC<AvailabilityMobileLayoutProps> = () => {
  return <AvailabilityScreen layout="mobile" />;
};

export default AvailabilityMobileLayout;
