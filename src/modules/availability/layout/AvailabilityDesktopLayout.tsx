/**
 * Desktop Layout for Availability Page
 *
 * Thin wrapper that renders AvailabilityScreen in desktop mode.
 * All logic is handled by the AvailabilityScreen component.
 *
 * Layout: Three panes side-by-side
 * - LEFT: Calendar (read-only slot display)
 * - MIDDLE: Logs (rule list with edit/delete)
 * - RIGHT: Configure (form for create/edit)
 */

import React from 'react';
import { AvailabilityScreen } from '../ui/AvailabilityScreen';

interface AvailabilityDesktopLayoutProps {
  // These props are kept for backwards compatibility but are no longer used
  // The AvailabilityScreen manages its own month state
  selectedMonth?: Date;
  onMonthChange?: (month: Date) => void;
}

export const AvailabilityDesktopLayout: React.FC<AvailabilityDesktopLayoutProps> = () => {
  return <AvailabilityScreen layout="desktop" />;
};

export default AvailabilityDesktopLayout;
