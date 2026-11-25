/** Lower case without diacritics, so "zaluzie" finds "Žaluzie". */
export function normalizeSearch(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "");
}

/** Whether `text` contains `query`, diacritics and case ignored. An empty query matches everything. */
export function matchesSearch(text: string, query: string) {
  const needle = normalizeSearch(query.trim());
  return !needle || normalizeSearch(text).includes(needle);
}

/** Wraps the first part of `text` that matches `query` (diacritics ignored) in a <mark>. */
export function Mark({ text, query }: Readonly<{ text: string; query: string }>) {
  const needle = normalizeSearch(query.trim());
  if (!needle) {
    return text;
  }
  // Map every character of the normalized text back to its index in the original.
  let normalized = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const part = normalizeSearch(text[i]);
    normalized += part;
    for (let k = 0; k < part.length; k++) {
      origin.push(i);
    }
  }
  const at = normalized.indexOf(needle);
  if (at < 0) {
    return text;
  }
  const start = origin[at];
  const end = origin[at + needle.length - 1] + 1;
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-[3px] bg-[color-mix(in_oklab,var(--warning)_28%,transparent)] px-px text-inherit">
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}
