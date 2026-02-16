/**
 * Mobile Layout for My Broadcasts (Employee View)
 *
 * Thin wrapper that renders MyBroadcastsScreen in mobile mode.
 * All logic is handled by the MyBroadcastsScreen component.
 *
 * Layout: Single column with stacked navigation
 * - Groups view: Single column card list
 * - Detail view: Full-screen channel/message view
 * - Bottom sheet for channel selection
 */

import React from 'react';
import { MyBroadcastsScreen } from '../ui/screens/MyBroadcastsScreen';

export const MyBroadcastsMobileLayout: React.FC = () => {
  return <MyBroadcastsScreen layout="mobile" />;
};

export default MyBroadcastsMobileLayout;
