import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveWritePath } from '../../src/utils/path';

describe('resolveWritePath and internal helper functions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isLeapYear & getDaysInMonth & parseDateStringToComponents', () => {
    it('correctly resolves write path with empty writePath string', () => {
      expect(resolveWritePath('', 'test-slug', {})).toBe('');
      expect(resolveWritePath(undefined, 'test-slug', {})).toBe('');
    });

    it('correctly parses metadata.date in YYYY-MM-DD format', () => {
      const metadata = { date: '2024-02-29' }; // leap year
      const path = resolveWritePath('/blog/{year}/{month}/{day}/{slug}', 'hello-world', metadata);
      expect(path).toBe('/blog/2024/02/29/hello-world');
    });

    it('correctly parses metadata.date in fallback standard Date format', () => {
      // 'May 15, 2024 UTC' does not match the YYYY-MM-DD regex, so it triggers the standard JS Date fallback
      // using UTC time to ensure it is timezone independent.
      const metadata = { date: 'May 15, 2024 UTC' };
      const path = resolveWritePath('/blog/{year}/{month}/{day}/{slug}', 'hello-world', metadata);
      expect(path).toBe('/blog/2024/05/15/hello-world');
    });

    it('correctly falls back to createdAt if metadata.date is invalid or missing', () => {
      const metadata = { date: 'invalid-date' };
      const createdAt = '2023-11-23';
      const path = resolveWritePath('/blog/{year}/{month}/{day}/{slug}', 'hello-world', metadata, createdAt);
      expect(path).toBe('/blog/2023/11/23/hello-world');
    });

    it('correctly falls back to today if metadata.date and createdAt are invalid or missing', () => {
      const mockDate = new Date('2026-05-29T10:00:00Z');
      vi.setSystemTime(mockDate);

      const path = resolveWritePath('/blog/{year}/{month}/{day}/{slug}', 'hello-world', {});
      expect(path).toBe('/blog/2026/05/29/hello-world');
    });

    it('handles non-leap year February dates in parseDateStringToComponents', () => {
      const path = resolveWritePath('/{year}-{month}-{day}', 'slug', { date: '2023-02-28' });
      expect(path).toBe('/2023-02-28');
    });

    it('handles non-leap year century (1900 is not leap) to verify isLeapYear division by 100/400 logic', () => {
      // 1900-02-29 is invalid because 1900 is not a leap year.
      // YYYY-MM-DD regex parses it, but the day validation check fails since getDaysInMonth(1900, 2) is 28.
      // So it falls back to Date parsing. JS engine parses '1900-02-29' by rolling over to '1900-03-01' in UTC.
      const path = resolveWritePath('/{year}-{month}-{day}', 'slug', { date: '1900-02-29' });
      expect(path).toBe('/1900-03-01');
    });

    it('handles leap year century (2000 is leap) to verify isLeapYear division by 400 logic', () => {
      // 2000-02-29 is valid because 2000 is a leap year.
      const path = resolveWritePath('/{year}-{month}-{day}', 'slug', { date: '2000-02-29' });
      expect(path).toBe('/2000-02-29');
    });

    it('handles totally invalid date string returning today', () => {
      const mockDate = new Date('2026-05-29T10:00:00Z');
      vi.setSystemTime(mockDate);

      const path = resolveWritePath('/{year}-{month}-{day}', 'slug', { date: 'totally-invalid-garbage' });
      expect(path).toBe('/2026-05-29');
    });

    it('handles falsy dateStr by returning null in parseDateStringToComponents', () => {
      const mockDate = new Date('2026-05-29T10:00:00Z');
      vi.setSystemTime(mockDate);
      const customCreatedAt = { toString: () => '' } as any;
      const path = resolveWritePath('/{year}-{month}-{day}', 'slug', {}, customCreatedAt);
      expect(path).toBe('/2026-05-29');
    });
  });
});
