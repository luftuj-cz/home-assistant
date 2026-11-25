export interface Version {
  version: string;
  /** "stable", "dev", "beta"…; a version without a suffix is stable. */
  channel: string;
}

/** "1.1.3-stable" → { version: "1.1.3", channel: "stable" }. Never strip the channel when showing a version. */
export function parseVersion(raw = ""): Version {
  const match = /^v?(\d+(?:\.\d+)*)(?:-([a-z]+))?/i.exec(raw.trim());
  return { version: match ? match[1] : raw, channel: match?.[2]?.toLowerCase() ?? "stable" };
}

export interface ChangelogItem {
  /** The bold "**Area**:" prefix, when there is one. */
  area?: string;
  /** Markdown-ish text: links and `code` are kept. */
  text: string;
}

export interface ChangelogSection {
  /** Keep a Changelog section name: Added, Changed, Fixed, Removed, Deprecated, Security… */
  type: string;
  items: ChangelogItem[];
}

export interface ChangelogEntry extends Version {
  /** The heading as written ("1.1.3-stable", "Unreleased"). */
  raw: string;
  /** "YYYY-MM-DD", when given. */
  date?: string;
  unreleased: boolean;
  sections: ChangelogSection[];
}

/**
 * Keep a Changelog markdown (addon/CHANGELOG.md) → entries, newest first as in the file. Reads `## [1.1.3-stable] -
 * 2026-11-17` headings, `### Added` sections and `- **Area**: text` items; indented lines continue an item.
 */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let entry: ChangelogEntry | null = null;
  let section: ChangelogSection | null = null;
  let item: ChangelogItem | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const release = /^##\s+\[?([^\]\s]+)\]?(?:\s+-\s+(\S+))?/.exec(line);
    if (release) {
      entry = {
        ...parseVersion(release[1]),
        raw: release[1],
        date: release[2],
        unreleased: /unreleased/i.test(release[1]),
        sections: [],
      };
      entries.push(entry);
      section = null;
      item = null;
      continue;
    }
    const heading = /^###\s+(.+)/.exec(line);
    if (heading && entry) {
      section = { type: heading[1].trim(), items: [] };
      entry.sections.push(section);
      item = null;
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)/.exec(line);
    if (bullet && section) {
      const withArea = /^\*\*(.+?)\*\*:?\s*(.*)/.exec(bullet[1]);
      item = withArea ? { area: withArea[1], text: withArea[2] } : { text: bullet[1] };
      section.items.push(item);
      continue;
    }
    if (item && /^\s+\S/.test(line)) {
      item.text += ` ${line.trim()}`;
    }
  }
  return entries;
}
