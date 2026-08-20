/**
 * Display-only product/topic name formatting.
 * Internal data and QB lookup may still use "NDS" — do not use for matching or persistence.
 */
export function formatProductDisplayName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .replace(/\bOne-NDS\b/gi, "One-SDL")
    .replace(/\bONE NDS\b/gi, "ONE SDL")
    .replace(/\bOne NDS\b/gi, "One SDL")
    .replace(/\bNDS\b/g, "SDL");
}

/** Format topic titles that mirror product names; leave question category prefixes unchanged. */
export function formatTopicTitleForDisplay(title: string | null | undefined): string {
  if (!title) return "";
  const trimmed = title.trim();
  if (/^\[[^\]]+\]/.test(trimmed)) return title;
  return formatProductDisplayName(title);
}
