/**
 * Tablet Layout for My Broadcasts (Employee View)
 *
 * Thin wrapper that renders MyBroadcastsScreen in tablet mode.
 * All logic is handled by the MyBroadcastsScreen component.
 *
 * Layout: Adaptive layout
 * - Groups view: 2-column card grid
 * - Detail view: Channels in drawer + Message feed
 */

import React from 'react';
import { MyBroadcastsScreen } from '../ui/screens/MyBroadcastsScreen';

export const MyBroadcastsTabletLayout: React.FC = () => {
  return <MyBroadcastsScreen layout="tablet" />;
};

export default MyBroadcastsTabletLayout;
