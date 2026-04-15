import { useEffect } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';

interface MotionNumberProps {
  value: number;
  className?: string;
}

/**
 * Smoothly ticks a numeric value from its previous state to the new one.
 * Rounds the displayed integer on every animation frame.
 */
export function MotionNumber({ value, className }: MotionNumberProps) {
  const motionValue = useMotionValue<number>(value);
  const rounded = useTransform(motionValue, (v: number) =>
    Math.round(v).toString()
  );

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration: 0.5,
      ease: [0.16, 1, 0.3, 1],
    });
    return controls.stop;
  }, [motionValue, value]);

  return <motion.span className={className}>{rounded}</motion.span>;
}
