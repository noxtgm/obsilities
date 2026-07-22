// Pure date utilities for the calendar
// All calculations are in local time (no external deps)

export function pad2(n: number): string {
	return n < 10 ? `0${n}` : `${n}`;
}

export function addDays(date: Date, days: number): Date {
	const d = new Date(date);
	d.setDate(d.getDate() + days);
	return d;
}

export function addMinutes(date: Date, minutes: number): Date {
	return new Date(date.getTime() + minutes * 60000);
}

export function startOfDay(date: Date): Date {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}

export function endOfDay(date: Date): Date {
	const d = new Date(date);
	d.setHours(23, 59, 59, 999);
	return d;
}

export function startOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, months: number): Date {
	return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export function addYears(date: Date, years: number): Date {
	return new Date(
		date.getFullYear() + years,
		date.getMonth(),
		date.getDate(),
	);
}

export function startOfYear(date: Date): Date {
	return new Date(date.getFullYear(), 0, 1);
}

export function endOfYear(date: Date): Date {
	const d = new Date(date.getFullYear(), 11, 31);
	d.setHours(23, 59, 59, 999);
	return d;
}

export function sameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

export function startOfWeek(date: Date, weekStart: number): Date {
	const d = startOfDay(date);
	const diff = (d.getDay() - weekStart + 7) % 7;
	return addDays(d, -diff);
}

export function monthFixedLeading(date: Date, leading: number): Date[] {
	const start = addDays(startOfMonth(date), -leading);
	const days: Date[] = [];
	for (let i = 0; i < 35; i++) days.push(addDays(start, i));
	return days;
}

export function minutesSinceMidnight(date: Date): number {
	return date.getHours() * 60 + date.getMinutes();
}

export function toLocalISODate(date: Date): string {
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
		date.getDate(),
	)}`;
}

export function fromLocalISODate(iso: string): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return null;
	return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function toLocalISODateTime(date: Date): string {
	return `${toLocalISODate(date)}T${pad2(date.getHours())}:${pad2(
		date.getMinutes(),
	)}`;
}

export interface ParsedDate {
	date: Date;
	allDay: boolean;
}

export function parseDateString(input: string): ParsedDate | null {
	const s = input.trim();
	if (!s) return null;

	const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (dateOnly) {
		return {
			date: new Date(
				Number(dateOnly[1]),
				Number(dateOnly[2]) - 1,
				Number(dateOnly[3]),
			),
			allDay: true,
		};
	}

	const localDT =
		/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
	if (localDT) {
		return {
			date: new Date(
				Number(localDT[1]),
				Number(localDT[2]) - 1,
				Number(localDT[3]),
				Number(localDT[4]),
				Number(localDT[5]),
				Number(localDT[6] ?? 0),
			),
			allDay: false,
		};
	}

	const parsed = new Date(s);
	if (Number.isNaN(parsed.getTime())) return null;
	return { date: parsed, allDay: !/\d{2}:\d{2}/.test(s) };
}

export function formatTime(date: Date): string {
	return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatHourLabel(hour: number): string {
	return `${pad2(hour)}:00`;
}

export function formatMonthTitle(date: Date): string {
	return date.toLocaleDateString(undefined, {
		month: "long",
		year: "numeric",
	});
}

export function formatDayTitle(date: Date): string {
	const base = date.toLocaleDateString(undefined, {
		weekday: "long",
		month: "long",
		day: "numeric",
	});
	return `${base}, ${date.getFullYear()}`;
}

export function isoWeekNumber(date: Date): number {
	const target = new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
	);
	const dayNr = (target.getDay() + 6) % 7; // Mon=0 .. Sun=6
	target.setDate(target.getDate() - dayNr + 3); // Thursday of this week
	const firstThursday = target.getTime();
	target.setMonth(0, 1); // Jan 1
	if (target.getDay() !== 4) {
		target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
	}
	return 1 + Math.round((firstThursday - target.getTime()) / 604800000);
}

// "Aug 10 - 16" (same month)
// "Aug 31 - Sept 6" (spans months)
// "Dec 29, 2025 - Jan 4, 2026" (spans years)
export function formatDateRange(start: Date, end: Date): string {
	const monthDay = (d: Date): string =>
		`${d.toLocaleDateString(undefined, { month: "short" })} ${d.getDate()}`;
	if (start.getFullYear() !== end.getFullYear()) {
		return `${monthDay(start)}, ${start.getFullYear()} - ${monthDay(
			end,
		)}, ${end.getFullYear()}`;
	}
	const endLabel =
		start.getMonth() === end.getMonth()
			? String(end.getDate())
			: monthDay(end);
	return `${monthDay(start)} - ${endLabel}, ${end.getFullYear()}`;
}

// "Aug 10 - 16, 2026 (W33)"
export function formatWeekTitle(start: Date, weekStart: number): string {
	const s = startOfWeek(start, weekStart);
	const e = addDays(s, 6);
	return `${formatDateRange(s, e)} (W${isoWeekNumber(s)})`;
}
