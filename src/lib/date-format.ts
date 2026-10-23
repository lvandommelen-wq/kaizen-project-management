type DateValue = string | null | undefined;

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export function formatCalendarDate(value: DateValue) {
  const parsed = parseDateValue(value);
  if (!parsed) return "Not set";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(parsed);
}

export function formatTimestamp(value: DateValue) {
  const parsed = parseDateValue(value);
  if (!parsed) return "Not set";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(parsed);
}

function parseDateValue(value: DateValue) {
  const normalized = value?.trim();
  if (!normalized) return null;

  if (dateOnlyPattern.test(normalized)) {
    const parsed = new Date(`${normalized}T00:00:00Z`);
    return Number.isNaN(parsed.getTime())
      || parsed.toISOString().slice(0, 10) !== normalized
      ? null
      : parsed;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
