import { DateValue, NullValue, parsePropertyId } from "obsidian";
import type { App, BasesEntry, BasesPropertyId, Value } from "obsidian";
import { parseDateString } from "./dates";
import { eventsForProperty } from "./occurrences";
import { parseRule } from "./recurrence";
import type { CalendarEvent, DateSource } from "./types";

function readTitle(entry: BasesEntry, titleProp: BasesPropertyId | null): string {
	if (titleProp) {
		try {
			const value = entry.getValue(titleProp);
			if (value && value.isTruthy()) {
				const str = value.toString().trim();
				if (str) return str;
			}
		} catch {
			// Fall through to file name
		}
	}
	return entry.file.basename;
}

type ParsedPropertyId = ReturnType<typeof parsePropertyId>;

function readEntryRaw(
	entry: BasesEntry,
	propId: BasesPropertyId,
	parsed: ParsedPropertyId,
	frontmatter: Record<string, unknown> | undefined,
): unknown {
	if (parsed.type === "note" && frontmatter) {
		const raw = frontmatter[parsed.name];
		if (raw != null) return raw;
	}
	const value = safeGetValue(entry, propId);
	if (value === null || value instanceof NullValue) return null;
	return value.toString();
}

function readEntryDate(
	entry: BasesEntry,
	propId: BasesPropertyId,
	parsed: ParsedPropertyId,
	frontmatter: Record<string, unknown> | undefined,
): Date | null {
	if (parsed.type === "note" && frontmatter) {
		const fromRaw = parseRawDate(frontmatter[parsed.name]);
		if (fromRaw) return fromRaw;
	}
	return readValueDate(safeGetValue(entry, propId));
}

function safeGetValue(entry: BasesEntry, propId: BasesPropertyId): Value | null {
	try {
		return entry.getValue(propId);
	} catch {
		return null;
	}
}

function parseRawDate(raw: unknown): Date | null {
	if (raw == null) return null;
	if (Array.isArray(raw)) return raw.length > 0 ? parseRawDate(raw[0]) : null;
	if (typeof raw === "string") return parseDateString(raw);
	if (typeof raw === "number") {
		const date = new Date(raw);
		return Number.isNaN(date.getTime()) ? null : date;
	}
	if (raw instanceof Date) {
		if (Number.isNaN(raw.getTime())) return null;
		const midnightUTC =
			raw.getUTCHours() === 0 &&
			raw.getUTCMinutes() === 0 &&
			raw.getUTCSeconds() === 0;
		if (midnightUTC) {
			return new Date(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate());
		}
		return raw;
	}
	return null;
}

function readValueDate(value: Value | null): Date | null {
	if (value === null || value instanceof NullValue) return null;
	if (value instanceof DateValue) return parseDateString(value.toString());
	const str = value.toString().trim();
	return str ? parseDateString(str) : null;
}

interface EventBuildOptions {
	app: App;
	entries: BasesEntry[];
	titleProp: BasesPropertyId | null;
	dateSources: DateSource[];
	recurrenceProp: BasesPropertyId | null;
	from: Date;
	to: Date;
}

export function buildEvents(opts: EventBuildOptions): CalendarEvent[] {
	const events: CalendarEvent[] = [];
	const sources = opts.dateSources.map((source) => ({
		source,
		startParsed: parsePropertyId(source.propId),
		endParsed: source.endPropId ? parsePropertyId(source.endPropId) : null,
	}));
	const recurParsed = opts.recurrenceProp ? parsePropertyId(opts.recurrenceProp) : null;
	const needsFrontmatter =
		recurParsed?.type === "note" ||
		sources.some(
			({ startParsed, endParsed }) =>
				startParsed.type === "note" || endParsed?.type === "note",
		);

	for (const entry of opts.entries) {
		const frontmatter = needsFrontmatter
			? opts.app.metadataCache.getFileCache(entry.file)?.frontmatter
			: undefined;

		const rule =
			opts.recurrenceProp && recurParsed
				? parseRule(
						readEntryRaw(
							entry,
							opts.recurrenceProp,
							recurParsed,
							frontmatter,
						),
					)
				: null;

		const title = readTitle(entry, opts.titleProp);
		const path = entry.file.path;

		for (const { source, startParsed, endParsed } of sources) {
			const start = readEntryDate(entry, source.propId, startParsed, frontmatter);
			if (!start) continue;

			const rawEnd =
				source.endPropId && endParsed
					? readEntryDate(entry, source.endPropId, endParsed, frontmatter)
					: null;

			events.push(
				...eventsForProperty({
					path,
					title,
					source: source.propId,
					endSource: source.endPropId,
					start,
					rawEnd,
					rule,
					from: opts.from,
					to: opts.to,
				}),
			);
		}
	}

	return events;
}
