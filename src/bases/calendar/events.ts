import { DateValue, NullValue, parsePropertyId } from "obsidian";
import type { App, BasesEntry, BasesPropertyId, Value } from "obsidian";
import { parseDateString } from "./dates";
import type { CalendarEvent } from "./types";
import type { ParsedDate } from "./dates";

function readEntryDate(
	app: App,
	entry: BasesEntry,
	propId: BasesPropertyId,
): ParsedDate | null {
	if (parsePropertyId(propId).type === "note") {
		const name = parsePropertyId(propId).name;
		const frontmatter = app.metadataCache.getFileCache(
			entry.file,
		)?.frontmatter;
		const fromRaw = frontmatter ? parseRawDate(frontmatter[name]) : null;
		if (fromRaw) return fromRaw;
	}
	return readValueDate(safeGetValue(entry, propId));
}

function safeGetValue(
	entry: BasesEntry,
	propId: BasesPropertyId,
): Value | null {
	try {
		return entry.getValue(propId);
	} catch {
		return null;
	}
}

function parseRawDate(raw: unknown): ParsedDate | null {
	if (raw == null) return null;
	if (Array.isArray(raw)) return raw.length > 0 ? parseRawDate(raw[0]) : null;
	if (typeof raw === "string") return parseDateString(raw);
	if (typeof raw === "number") {
		const date = new Date(raw);
		return Number.isNaN(date.getTime()) ? null : { date, allDay: false };
	}
	if (raw instanceof Date) {
		if (Number.isNaN(raw.getTime())) return null;
		const midnightUTC =
			raw.getUTCHours() === 0 &&
			raw.getUTCMinutes() === 0 &&
			raw.getUTCSeconds() === 0;
		if (midnightUTC) {
			return {
				date: new Date(
					raw.getUTCFullYear(),
					raw.getUTCMonth(),
					raw.getUTCDate(),
				),
				allDay: true,
			};
		}
		return { date: raw, allDay: false };
	}
	return null;
}

function readValueDate(value: Value | null): ParsedDate | null {
	if (value === null || value instanceof NullValue) return null;
	if (value instanceof DateValue) return parseDateString(value.toString());
	const str = value.toString().trim();
	return str ? parseDateString(str) : null;
}

function readTitle(
	entry: BasesEntry,
	titleProp: BasesPropertyId | null,
): string {
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

export interface EventBuildOptions {
	app: App;
	entries: BasesEntry[];
	dateProp: BasesPropertyId;
	endProp: BasesPropertyId | null;
	titleProp: BasesPropertyId | null;
	yearlyRepeat: boolean;
	range: { start: Date; end: Date };
}

export function buildEvents(opts: EventBuildOptions): CalendarEvent[] {
	const events: CalendarEvent[] = [];

	for (const entry of opts.entries) {
		const start = readEntryDate(opts.app, entry, opts.dateProp);
		if (!start) continue;

		let end: Date | null = null;
		let allDay = start.allDay;
		if (opts.endProp) {
			const parsedEnd = readEntryDate(opts.app, entry, opts.endProp);
			if (parsedEnd && parsedEnd.date.getTime() > start.date.getTime()) {
				end = parsedEnd.date;
				if (!parsedEnd.allDay) allDay = false;
			}
		}

		const path = entry.file.path;
		const title = readTitle(entry, opts.titleProp);
		const duration = end ? end.getTime() - start.date.getTime() : null;

		if (opts.yearlyRepeat) {
			pushYearlyOccurrences(events, {
				path,
				title,
				start: start.date,
				duration,
				allDay,
				range: opts.range,
			});
		} else {
			events.push({
				id: path,
				path,
				title,
				start: start.date,
				end,
				allDay,
			});
		}
	}

	return events;
}

interface YearlyInput {
	path: string;
	title: string;
	start: Date;
	duration: number | null;
	allDay: boolean;
	range: { start: Date; end: Date };
}

function pushYearlyOccurrences(
	events: CalendarEvent[],
	input: YearlyInput,
): void {
	const month = input.start.getMonth();
	const day = input.start.getDate();
	const hours = input.start.getHours();
	const minutes = input.start.getMinutes();
	const startYear = input.range.start.getFullYear();
	const endYear = input.range.end.getFullYear();

	for (let year = startYear; year <= endYear; year++) {
		const occurrence = new Date(year, month, day, hours, minutes);
		const time = occurrence.getTime();
		if (time < input.range.start.getTime()) continue;
		if (time > input.range.end.getTime()) continue;
		events.push({
			id: `${input.path}:${year}`,
			path: input.path,
			title: input.title,
			start: occurrence,
			end:
				input.duration != null ? new Date(time + input.duration) : null,
			allDay: input.allDay,
		});
	}
}
