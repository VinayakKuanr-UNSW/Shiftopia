import type { Database as GeneratedDatabase, Json } from './types';

/**
 * The generated Database, plus the PostgREST computed columns on `shifts`.
 *
 * `shift_pay_terms(s shifts)`, `my_shift_pay_terms(s shifts)` and
 * `is_first_aid_duty(s shifts)` are selected like columns, but both
 * `supabase gen types` and postgrest-js only recognise a computed column whose
 * parameter is unnamed (`Args: { '': Row }`). These are named `s`, so without
 * this the typed select parser turns `select('…, shift_pay_terms')` into a
 * SelectQueryError. types.ts is regenerated, so the override lives here.
 */
type ShiftComputedColumns = {
    shift_pay_terms: Json | null;
    my_shift_pay_terms: Json | null;
    is_first_aid_duty: boolean;
};

type Public = GeneratedDatabase['public'];
type Shifts = Public['Tables']['shifts'];

export type Database = Omit<GeneratedDatabase, 'public'> & {
    public: Omit<Public, 'Tables'> & {
        Tables: Omit<Public['Tables'], 'shifts'> & {
            shifts: Omit<Shifts, 'Row'> & { Row: Shifts['Row'] & ShiftComputedColumns };
        };
    };
};
