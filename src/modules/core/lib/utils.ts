
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}


export function getDepartmentColor(department: string): string {
  const lowerCaseDept = department.toLowerCase();
  if (lowerCaseDept.includes('convention')) return 'blue';
  if (lowerCaseDept.includes('exhibition')) return 'green';
  if (lowerCaseDept.includes('theatre')) return 'red';
  return 'purple'; // Default color
}



