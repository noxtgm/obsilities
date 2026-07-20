import { Keymap } from "obsidian";
import { addDays, startOfDay, toLocalISODate } from "../dates";
import type { CalendarEvent, LayoutContext } from "../types";

const MAX_SPAN_DAYS = 366;

export function sortEvents(a: CalendarEvent, b: CalendarEvent): number {
	if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
	const diff = a.start.getTime() - b.start.getTime();
	if (diff !== 0) return diff;
	return a.title.localeCompare(b.title);
}

function lastCoveredDay(event: CalendarEvent): Date {
	const first = startOfDay(event.start);
	let lastTime: number;
	if (event.end) {
		lastTime = event.allDay ? event.end.getTime() : event.end.getTime() - 1;
	} else {
		lastTime = event.start.getTime();
	}
	return startOfDay(new Date(Math.max(lastTime, first.getTime())));
}

export function coveredDays(event: CalendarEvent): Date[] {
	const first = startOfDay(event.start);
	const last = lastCoveredDay(event).getTime();
	const days: Date[] = [];
	for (
		let d = first;
		d.getTime() <= last && days.length < MAX_SPAN_DAYS;
		d = addDays(d, 1)
	) {
		days.push(d);
	}
	return days;
}

export function eventCoversDay(event: CalendarEvent, day: Date): boolean {
	const d = startOfDay(day).getTime();
	return (
		d >= startOfDay(event.start).getTime() &&
		d <= lastCoveredDay(event).getTime()
	);
}

export function groupByDay(
	events: CalendarEvent[],
): Map<string, CalendarEvent[]> {
	const map = new Map<string, CalendarEvent[]>();
	for (const ev of events) {
		for (const day of coveredDays(ev)) {
			const iso = toLocalISODate(day);
			const list = map.get(iso);
			if (list) list.push(ev);
			else map.set(iso, [ev]);
		}
	}
	return map;
}

export function attachChipInteractions(
	chip: HTMLElement,
	event: CalendarEvent,
	ctx: LayoutContext,
	onDragStart: () => void,
	onDragEnd: () => void,
	draggable = true,
): void {
	chip.addEventListener("click", (e) => {
		if (ctx.callbacks.isDragging()) return;
		e.stopPropagation();
		ctx.callbacks.open(event.path, !!Keymap.isModEvent(e));
	});

	chip.addEventListener("auxclick", (e) => {
		if (e.button !== 1) return;
		e.preventDefault();
		ctx.callbacks.openBackground(event.path);
	});

	if (!draggable) return;

	chip.setAttribute("draggable", "true");

	chip.addEventListener("dragstart", (e) => {
		ctx.callbacks.setDragging(true);
		onDragStart();
		e.dataTransfer?.setData("text/plain", event.path);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
		window.setTimeout(() => chip.addClass("is-dragging"), 0);
	});

	chip.addEventListener("dragend", () => {
		chip.removeClass("is-dragging");
		ctx.callbacks.setDragging(false);
		onDragEnd();
	});
}
