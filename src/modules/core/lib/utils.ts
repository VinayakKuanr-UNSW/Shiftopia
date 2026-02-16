
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(timeString: string): string {
  // Handle formats like "09:00:00" or "09:00"
  const parts = timeString.split(':');
  if (parts.length < 2) return timeString;
  
  let hours = parseInt(parts[0]);
  const minutes = parts[1];
  const ampm = hours >= 12 ? 'PM' : 'AM';
  
  hours = hours % 12;
  hours = hours ? hours : 12; // convert 0 to 12
  
  return `${hours}:${minutes} ${ampm}`;
}

export function getDepartmentColor(department: string): string {
  const lowerCaseDept = department.toLowerCase();
  if (lowerCaseDept.includes('convention')) return 'blue';
  if (lowerCaseDept.includes('exhibition')) return 'green';
  if (lowerCaseDept.includes('theatre')) return 'red';
  return 'purple'; // Default color
}

export function getHourFromTimeString(timeString: string): number {
  const parts = timeString.split(':');
  return parseInt(parts[0]);
}

export function getShiftDuration(startTime: string, endTime: string): number {
  const startHour = getHourFromTimeString(startTime);
  const endHour = getHourFromTimeString(endTime);
  return endHour - startHour;
}

export function timeToPosition(timeString: string, startHour: number = 0, endHour: number = 24): number {
  const parts = timeString.split(':');
  const hour = parseInt(parts[0]);
  const minutes = parseInt(parts[1] || '0');
  
  const timeValue = hour + (minutes / 60);
  const range = endHour - startHour;
  
  return ((timeValue - startHour) / range) * 100;
}
