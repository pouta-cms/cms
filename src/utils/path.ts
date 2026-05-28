/**
 * Parses a date string into components (year, month, day) in a timezone-safe manner.
 * Returns null if the string is invalid or malformed.
 */
function parseDateStringToComponents(dateStr: string | undefined): { year: string; month: string; day: string } | null {
  if (!dateStr) return null;
  
  // Timezone-safe matching for YYYY-MM-DD formats
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return {
      year: match[1],
      month: match[2],
      day: match[3],
    };
  }
  
  // Standard JS Date parsing fallback
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return {
      year: String(d.getFullYear()),
      month: String(d.getMonth() + 1).padStart(2, '0'),
      day: String(d.getDate()).padStart(2, '0'),
    };
  }
  
  return null;
}

/**
 * Resolves dynamic tokens ({slug}, {year}, {month}, {day}) in writePath configurations.
 * Prioritizes custom metadata date, falls back to creation date, and defaults to current date.
 */
export const resolveWritePath = (
  writePath: string | undefined,
  slug: string,
  metadata: Record<string, any>,
  createdAt?: string
): string => {
  if (!writePath) return '';

  let components = null;

  // 1. Try to parse metadata.date first
  if (metadata && metadata.date) {
    components = parseDateStringToComponents(String(metadata.date));
  }

  // 2. If metadata.date is missing or invalid, try to parse createdAt
  if (!components && createdAt) {
    components = parseDateStringToComponents(String(createdAt));
  }

  // 3. If both are missing or invalid, fallback to current date (today)
  if (!components) {
    const d = new Date();
    components = {
      year: String(d.getFullYear()),
      month: String(d.getMonth() + 1).padStart(2, '0'),
      day: String(d.getDate()).padStart(2, '0'),
    };
  }

  const { year, month, day } = components;

  return writePath
    .split('{slug}').join(slug)
    .split('{year}').join(year)
    .split('{month}').join(month)
    .split('{day}').join(day);
};
