/**
 * Small pieces the Rate Card Studio tabs share: a labelled field, the
 * server's refusal, and a money formatter.
 */

import React from 'react';
import { Label } from '@/modules/core/ui/primitives/label';

export const fieldClass = 'h-[44px] md:h-[36px] text-[13px]';
export const cellInputClass = 'h-[36px] w-[96px] text-[13px] tabular-nums';
export const money = (n: number) => '$' + n.toFixed(2);

export const Field: React.FC<{ id: string; label: string; error?: string; hint?: string; children: React.ReactNode }> = ({
  id, label, error, hint, children,
}) => (
  <div className="space-y-1.5">
    <Label htmlFor={id} className="text-[12px] font-semibold text-foreground">{label}</Label>
    {children}
    {hint && !error && <p className="text-[12px] text-muted-foreground">{hint}</p>}
    {error && <p id={id + '-error'} className="text-[12px] text-destructive">{error}</p>}
  </div>
);

export const ServerError: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
      {message}
    </p>
  ) : null;

export const nativeSelectClass =
  'h-[44px] md:h-[36px] w-full rounded-md border border-input bg-background px-3 text-[13px] text-foreground';
