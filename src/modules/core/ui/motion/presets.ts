// Shared framer-motion animation presets for personal pages.
// Import from this file rather than defining variants inline.

import type { Variants } from 'framer-motion';

// Page-level container: staggers children as they enter
export const pageVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

// Individual item inside a staggered page container
export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { ease: [0.16, 1, 0.3, 1], duration: 0.4 },
  },
};

// Cards/rows that are interactive (hover lift, tap scale).
// Spread directly onto a motion element as props.
export const cardInteractive = {
  whileHover: { y: -2, transition: { duration: 0.15 } },
  whileTap: { scale: 0.98, transition: { duration: 0.1 } },
} as const;

// Tab/segment crossfade. Use with <AnimatePresence mode="wait">.
export const tabTransition = {
  initial: { opacity: 0, y: 4 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { ease: [0.16, 1, 0.3, 1], duration: 0.25 },
  },
  exit: { opacity: 0, y: -4, transition: { duration: 0.15 } },
} as const;

// List item with spring physics (works well with layoutId reorders).
export const listItemSpring = {
  layout: true,
  initial: { opacity: 0, scale: 0.96 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring', stiffness: 280, damping: 26 },
  },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.15 } },
} as const;

// Drawer/modal inner body fade-in.
export const drawerContentVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { ease: [0.16, 1, 0.3, 1], duration: 0.3 },
  },
};
