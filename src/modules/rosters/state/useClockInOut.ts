/**
 * useClockIn / useClockOut / useMarkNoShow
 *
 * Attendance mutations for the clock-in/out feature.
 * Each mutation:
 *  1. Attempts GPS capture (never blocks on failure — GPS is optional)
 *  2. Runs fraud analysis and attaches results to the action payload
 *  3. Calls the appropriate Supabase RPC
 *  4. Invalidates shift list cache so the badge re-renders
 *  5. Shows a toast on error
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { callRpc, requireUser } from '@/platform/supabase/rpc/client';

import { shiftKeys } from '../api/queryKeys';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
  captureGPS,
  analyzeGPS,
  storeClockInCapture,
  retrieveClockInCapture,
  clearClockInCapture,
} from '../utils/gps';

// ── Response schemas ────────────────────────────────────────────────────────
// Discriminated unions handle both success and business-logic error responses.
// Postgres returns { success: false, error: '...' } for business rule violations
// (not an HTTP error), so we parse both shapes and throw on failure.

const CheckInResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success:           z.literal(true),
    attendance_status: z.string(),
    actual_start:      z.string().nullable().optional(),
    distance_m:        z.number().nullable().optional(),
  }),
  z.object({
    success:    z.literal(false),
    error:      z.string(),
    distance_m: z.number().nullable().optional(),
  }),
]);

const ClockOutResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success:             z.literal(true),
    actual_end:          z.string().nullable().optional(),
    early_out:           z.boolean().optional(),
    actual_net_minutes:  z.number().nullable().optional(),
  }),
  z.object({
    success: z.literal(false),
    error:   z.string(),
  }),
]);


// ── useClockIn ──────────────────────────────────────────────────────────────

export function useClockIn() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      shiftId,
      venueLat = null,
      venueLon = null,
      preCapture = null,
    }: {
      shiftId: string;
      venueLat?: number | null;
      venueLon?: number | null;
      preCapture?: import('../utils/gps').GPSCapture | null;
    }) => {
      // 1. GPS — soft capture, never blocks the action
      //    Reuse a pre-captured position (< 30 s old) when available.
      const RECAPTURE_THRESHOLD_MS = 30_000;
      const isRecent = preCapture && (Date.now() - preCapture.capturedAt) < RECAPTURE_THRESHOLD_MS;
      const capture = isRecent ? preCapture : await captureGPS();

      // 2. Fraud analysis (pure, no network)
      const analysis = analyzeGPS(capture, venueLat, venueLon);

      // 3. RPC — proceed even if capture is null (GPS optional)
      const raw = await callRpc('check_in_shift', {
        p_shift_id: shiftId,
        p_lat:      capture?.lat  ?? null,
        p_lon:      capture?.lon  ?? null,
      }, CheckInResponseSchema);

      if (raw.success === false) {
        throw new Error(raw.error);
      }

      // 4. Store clock-in capture in sessionStorage for speed check at clock-out
      if (capture) {
        storeClockInCapture(shiftId, capture);
      }



      return { raw, analysis };
    },

    onSuccess: ({ raw, analysis }) => {
      const isLate = raw.success && raw.attendance_status === 'late';
      const flagNote = analysis.flags.length > 0
        ? ` (GPS: ${analysis.confidence})`
        : '';
      toast({
        title:       isLate ? 'Clocked In — Late' : 'Clocked In',
        description: isLate
          ? `You have been marked as late.${flagNote}`
          : `You have successfully clocked in.${flagNote}`,
      });
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
    },

    onError: (error: Error) => {
      toast({
        title:       'Clock In Failed',
        description: error.message,
        variant:     'destructive',
      });
    },
  });
}

// ── useClockOut ─────────────────────────────────────────────────────────────

export function useClockOut() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      shiftId,
      venueLat = null,
      venueLon = null,
    }: {
      shiftId: string;
      venueLat?: number | null;
      venueLon?: number | null;
    }) => {
      const user = await requireUser();

      // 1. GPS — soft capture
      const capture = await captureGPS();

      // 2. Retrieve clock-in capture for speed check
      const clockInCapture = retrieveClockInCapture(shiftId);

      // 3. Fraud analysis (includes speed check when clock-in coords are available)
      const analysis = analyzeGPS(capture, venueLat, venueLon, clockInCapture ?? null);

      // 4. RPC
      const raw = await callRpc('sm_clock_out_shift', {
        p_shift_id: shiftId,
        p_user_id:  user.id,
        p_lat:      capture?.lat ?? null,
        p_lon:      capture?.lon ?? null,
      }, ClockOutResponseSchema);

      if (raw.success === false) {
        throw new Error(raw.error);
      }

      // 5. Clear clock-in capture after successful clock-out
      clearClockInCapture(shiftId);



      return { raw, analysis };
    },

    onSuccess: ({ raw, analysis }) => {
      const isEarlyOut = raw.success && raw.early_out === true;
      const flagNote = analysis.flags.length > 0
        ? ` (GPS: ${analysis.confidence})`
        : '';
      toast({
        title:       isEarlyOut ? 'Clocked Out — Early' : 'Clocked Out',
        description: isEarlyOut
          ? `You left before your scheduled end time.${flagNote}`
          : `You have successfully clocked out.${flagNote}`,
      });
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
    },

    onError: (error: Error) => {
      toast({
        title:       'Clock Out Failed',
        description: error.message,
        variant:     'destructive',
      });
    },
  });
}

