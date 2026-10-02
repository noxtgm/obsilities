import { addDays } from "./dates";

export type RecurrenceRule =
	| "daily"
	| "weekly"
	| "monthly-date"
	| "monthly-weekday"
	| "monthly-last-weekday"
	| "yearly";

const RULES: readonly RecurrenceRule[] = [
	"daily",
	"weekly",
	"monthly-date",
	"monthly-weekday",
	"monthly-last-weekday",
	"yearly",
];

export function parseRule(raw: unknown): RecurrenceRule | null {
	if (Array.isArray(raw)) return raw.length > 0 ? parseRule(raw[0]) : null;
	if (typeof raw !== "string") return null;
	const name = raw.trim().toLowerCase();
	return RULES.find((rule) => rule === name) ?? null;
}

export const MAX_OCCURRENCES = 400;

export function expandOccurrences(
	anchor: Date,
	rule: RecurrenceRule,
	rangeStart: Date,
	rangeEnd: Date,
): Date[] {
	const from = new Date(Math.max(rangeStart.getTime(), anchor.getTime()));
	if (from.getTime() > rangeEnd.getTime()) return [];

	if (rule === "daily") return expandStepped(anchor, from, rangeEnd, 1);
	if (rule === "weekly") return expandStepped(anchor, from, rangeEnd, 7);
	if (rule === "monthly-date") {
		return eachMonth(from, rangeEnd, (year, month) =>
			dateAt(anchor, year, month, anchor.getDate()),
		);
	}
	if (rule === "monthly-weekday") {
		const ordinal = Math.floor((anchor.getDate() - 1) / 7) + 1;
		return eachMonth(from, rangeEnd, (year, month) =>
			nthWeekday(anchor, year, month, anchor.getDay(), ordinal),
		);
	}
	if (rule === "monthly-last-weekday") {
		return eachMonth(from, rangeEnd, (year, month) =>
			lastWeekday(anchor, year, month, anchor.getDay()),
		);
	}
	if (rule !== "yearly") return [];

	const occurrences: Date[] = [];
	for (let year = from.getFullYear(); year <= rangeEnd.getFullYear(); year++) {
		const at = dateAt(anchor, year, anchor.getMonth(), anchor.getDate());
		if (at && inRange(at, from, rangeEnd)) occurrences.push(at);
	}
	return occurrences;
}

function expandStepped(anchor: Date, from: Date, rangeEnd: Date, step: number): Date[] {
	const occurrences: Date[] = [];
	const seed = dateAt(anchor, from.getFullYear(), from.getMonth(), from.getDate());
	if (!seed) return occurrences;

	let cursor =
		step === 7 ? addDays(seed, (anchor.getDay() - seed.getDay() + 7) % 7) : seed;
	while (
		cursor.getTime() <= rangeEnd.getTime() &&
		occurrences.length < MAX_OCCURRENCES
	) {
		if (cursor.getTime() >= from.getTime()) occurrences.push(new Date(cursor));
		cursor = addDays(cursor, step);
	}
	return occurrences;
}

function dateAt(anchor: Date, year: number, month: number, day: number): Date | null {
	const at = new Date(anchor);
	at.setFullYear(year, month, day);
	const rolled =
		at.getFullYear() !== year || at.getMonth() !== month || at.getDate() !== day;
	return rolled ? null : at;
}

function eachMonth(
	from: Date,
	rangeEnd: Date,
	dayOfMonth: (year: number, month: number) => Date | null,
): Date[] {
	const occurrences: Date[] = [];
	const last = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1).getTime();
	let cursor = new Date(from.getFullYear(), from.getMonth(), 1);

	while (cursor.getTime() <= last) {
		const at = dayOfMonth(cursor.getFullYear(), cursor.getMonth());
		if (at && inRange(at, from, rangeEnd)) occurrences.push(at);
		cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
	}
	return occurrences;
}

function nthWeekday(
	anchor: Date,
	year: number,
	month: number,
	weekday: number,
	ordinal: number,
): Date | null {
	const offset = (weekday - new Date(year, month, 1).getDay() + 7) % 7;
	return dateAt(anchor, year, month, 1 + offset + (ordinal - 1) * 7);
}

function lastWeekday(
	anchor: Date,
	year: number,
	month: number,
	weekday: number,
): Date | null {
	const endOfMonth = new Date(year, month + 1, 0);
	const back = (endOfMonth.getDay() - weekday + 7) % 7;
	return dateAt(anchor, year, month, endOfMonth.getDate() - back);
}

function inRange(date: Date, start: Date, end: Date): boolean {
	return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}
