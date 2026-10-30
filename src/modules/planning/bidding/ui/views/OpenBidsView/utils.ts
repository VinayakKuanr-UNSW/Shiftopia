// src/modules/planning/bidding/ui/views/OpenBidsView/utils.ts

import type { TimeRemaining } from './types';

/**
 * Calculate time remaining until deadline
 */
export const calculateTimeRemaining = (deadlineISO: string): TimeRemaining => {
  const deadline = new Date(deadlineISO);
  const now = new Date();
  const diffMs = deadline.getTime() - now.getTime();
  const isExpired = diffMs <= 0;

  if (isExpired) {
    return {
      years: 0,
      months: 0,
      weeks: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      isExpired: true,
    };
  }

  let remaining = diffMs;

  const years = Math.floor(remaining / (1000 * 60 * 60 * 24 * 365.25));
  remaining %= (1000 * 60 * 60 * 24 * 365.25);

  const months = Math.floor(remaining / (1000 * 60 * 60 * 24 * 30.44));
  remaining %= (1000 * 60 * 60 * 24 * 30.44);

  const weeks = Math.floor(remaining / (1000 * 60 * 60 * 24 * 7));
  remaining %= (1000 * 60 * 60 * 24 * 7);

  const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
  remaining %= (1000 * 60 * 60 * 24);

  const hours = Math.floor(remaining / (1000 * 60 * 60));
  remaining %= (1000 * 60 * 60);

  const minutes = Math.floor(remaining / (1000 * 60));
  remaining %= (1000 * 60);

  const seconds = Math.floor(remaining / 1000);

  return { years, months, weeks, days, hours, minutes, seconds, isExpired: false };
};





/**
 * Format time remaining for display (y,m,w,d,h,m,s)
 */
export const formatTimeRemaining = (timeRemaining: TimeRemaining): string => {
  if (timeRemaining.isExpired) return 'EXPIRED';

  const parts: string[] = [];
  if (timeRemaining.years > 0) parts.push(`${timeRemaining.years}y`);
  if (timeRemaining.months > 0) parts.push(`${timeRemaining.months}mo`);
  if (timeRemaining.weeks > 0) parts.push(`${timeRemaining.weeks}w`);
  if (timeRemaining.days > 0) parts.push(`${timeRemaining.days}d`);
  if (timeRemaining.hours > 0) parts.push(`${timeRemaining.hours}h`);
  if (timeRemaining.minutes > 0) parts.push(`${timeRemaining.minutes}m`);
  // Only show seconds if there are no days/weeks/months/years and we have space
  if (timeRemaining.seconds > 0 && parts.length < 3) parts.push(`${timeRemaining.seconds}s`);

  return parts.join(' ') || '0m';
};
