import { describe, expect, it } from 'vitest';
import {
  groupKeyOf,
  hasFixedSubgroup,
  OFFICE_SUBGROUP_NAME,
} from '../subgroupRules';

describe('groupKeyOf', () => {
  it('normalises display names and external ids alike, as the apply RPC does', () => {
    expect(groupKeyOf('Office')).toBe('office');
    expect(groupKeyOf('office')).toBe('office');
    expect(groupKeyOf(' The Cutaway ')).toBe('the_cutaway');
    expect(groupKeyOf('Convention Centre')).toBe('convention_centre');
    expect(groupKeyOf(null)).toBe('');
  });
});

describe('hasFixedSubgroup', () => {
  it('is true for Office however it is spelled, and only for Office', () => {
    expect(hasFixedSubgroup('Office')).toBe(true);
    expect(hasFixedSubgroup('office')).toBe(true);
    expect(hasFixedSubgroup('Box Office')).toBe(false);
    expect(hasFixedSubgroup('theatre')).toBe(false);
    expect(hasFixedSubgroup(undefined)).toBe(false);
  });

  it('names the one sub-group the database allows', () => {
    expect(OFFICE_SUBGROUP_NAME).toBe('Administration');
  });
});
