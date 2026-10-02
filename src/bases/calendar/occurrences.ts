import type { BasesPropertyId } from "obsidian";
import { isLocalMidnight, toLocalISODateTime } from "./dates";
import { expandOccurrences } from "./recurrence";
import type { RecurrenceRule } from "./recurrence";
import type { CalendarEvent } from "./types";
import { isWritableProperty } from "./writes";

export interface PropertyEventInput {
	path: string;
	title: string;
	source: BasesPropertyId;
	endSource: BasesPropertyId | null;
	start: Date;
	rawEnd: Date | null;
	rule: RecurrenceRule | null;
	from: Date;
	to: Date;
}

export function eventsForProperty(input: PropertyEventInput): CalendarEvent[] {
	const allDay =
		isLocalMidnight(input.start) &&
		(input.rawEnd === null || isLocalMidnight(input.rawEnd));

	const usableEnd = pickEnd(input.start, input.rawEnd, allDay);

	if (!input.rule) {
		return [shape(input, input.start, input.rawEnd, usableEnd, allDay, false)];
	}

	const duration = usableEnd ? usableEnd.getTime() - input.start.getTime() : 0;
	const from = new Date(input.from.getTime() - duration);

	return expandOccurrences(input.start, input.rule, from, input.to).map((start) => {
		const rawEnd = input.rawEnd
			? new Date(start.getTime() + (input.rawEnd.getTime() - input.start.getTime()))
			: null;
		return shape(input, start, rawEnd, pickEnd(start, rawEnd, allDay), allDay, true);
	});
}

function pickEnd(start: Date, rawEnd: Date | null, allDay: boolean): Date | null {
	if (!rawEnd) return null;
	const usable = allDay
		? rawEnd.getTime() >= start.getTime()
		: rawEnd.getTime() > start.getTime();
	return usable ? rawEnd : null;
}

// A move rewrites the source date, and the end date alongside it when the event
// has one, so an event is only movable when every property it would touch is
function canWrite(input: PropertyEventInput): boolean {
	if (!isWritableProperty(input.source)) return false;
	return input.endSource === null || isWritableProperty(input.endSource);
}

function shape(
	input: PropertyEventInput,
	start: Date,
	rawEnd: Date | null,
	end: Date | null,
	allDay: boolean,
	recurring: boolean,
): CalendarEvent {
	return {
		id: `${input.path}@${input.source}@${toLocalISODateTime(start)}`,
		path: input.path,
		title: input.title,
		start,
		end,
		rawEnd,
		allDay,
		source: input.source,
		endSource: input.endSource,
		recurring,
		editable: !recurring && canWrite(input),
	};
}
