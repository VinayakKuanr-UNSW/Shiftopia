import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createAvailabilityFromForm } from '../availability.service';
import { createAvailabilityException } from '../exceptions.api';
import * as contractBasisApi from '../contract-basis.api';
import * as availabilityApi from '../availability.api';
import { supabase } from '@/platform/supabase/client';

vi.mock('../contract-basis.api', () => ({
  fetchScopedContractBasis: vi.fn(),
}));

vi.mock('../availability.api', () => ({
  getCurrentProfileId: vi.fn().mockResolvedValue('user-123'),
  createAvailabilityRule: vi.fn(),
  deleteAvailabilityRule: vi.fn(),
  deleteAvailabilityRulesInRange: vi.fn(),
  getAvailabilityRules: vi.fn(),
}));

vi.mock('@/platform/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('Full-Time Availability Guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects createAvailabilityFromForm for Full-Time employees', async () => {
    vi.mocked(contractBasisApi.fetchScopedContractBasis).mockResolvedValue({
      contractType: 'FT',
      isFullTime: true,
      contractedWeeklyHours: 38,
      employmentStatus: 'Full-Time',
      envelope: { spanStart: null, spanEnd: null, days: null, isConfigured: false },
      availabilityMode: 'OPT_OUT',
      roleIds: [],
      isError: false,
    });

    await expect(
      createAvailabilityFromForm('ft-user-id', {
        start_date: new Date('2026-05-15'),
        end_date: new Date('2026-05-15'),
        start_time: '09:00',
        end_time: '17:00',
        repeat_type: 'none',
      })
    ).rejects.toThrow(
      'Availability is contract based for Full Time employees. Use Leave Management for unavailability.'
    );

    expect(availabilityApi.createAvailabilityRule).not.toHaveBeenCalled();
  });

  it('permits createAvailabilityFromForm for Casual employees', async () => {
    vi.mocked(contractBasisApi.fetchScopedContractBasis).mockResolvedValue({
      contractType: 'CASUAL',
      isFullTime: false,
      contractedWeeklyHours: undefined,
      employmentStatus: 'Casual',
      envelope: { spanStart: null, spanEnd: null, days: null, isConfigured: false },
      availabilityMode: 'OPT_IN',
      roleIds: [],
      isError: false,
    });

    vi.mocked(availabilityApi.createAvailabilityRule).mockResolvedValue({
      id: 'rule-1',
      profile_id: 'casual-user-id',
      start_date: '2026-05-15',
      start_time: '09:00:00',
      end_time: '17:00:00',
      repeat_type: 'none',
      repeat_days: null,
      repeat_end_date: null,
      created_at: '2026-05-15T00:00:00Z',
      updated_at: '2026-05-15T00:00:00Z',
    });

    const result = await createAvailabilityFromForm('casual-user-id', {
      start_date: new Date('2026-05-15'),
      end_date: new Date('2026-05-15'),
      start_time: '09:00',
      end_time: '17:00',
      repeat_type: 'none',
    });

    expect(result.id).toBe('rule-1');
    expect(availabilityApi.createAvailabilityRule).toHaveBeenCalled();
  });

  it('rejects createAvailabilityException for Full-Time employees', async () => {
    vi.mocked(contractBasisApi.fetchScopedContractBasis).mockResolvedValue({
      contractType: 'FT',
      isFullTime: true,
      contractedWeeklyHours: 38,
      employmentStatus: 'Full-Time',
      envelope: { spanStart: null, spanEnd: null, days: null, isConfigured: false },
      availabilityMode: 'OPT_OUT',
      roleIds: [],
      isError: false,
    });

    await expect(
      createAvailabilityException('ft-user-id', {
        exceptionDate: '2026-05-15',
        startTime: '09:00',
        endTime: '17:00',
        severity: 'SOFT',
      })
    ).rejects.toThrow(
      'Availability is contract based for Full Time employees. Use Leave Management for unavailability.'
    );
  });
});
