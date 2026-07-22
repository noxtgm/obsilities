import { Keymap } from "obsidian";
import { addDays, formatTime, startOfDay, toLocalISODate } from "../dates";
import type { CalendarEvent, LayoutContext } from "../types";

const MAX_SPAN_DAYS = 366;
const DRAG_THRESHOLD = 4;

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

export interface DragSpec {
	onMove: (clientX: number, clientY: number) => void;
	onDrop: (clientX: number, clientY: number) => void;
	onEnd: () => void;
}

export function attachChipInteractions(
	chip: HTMLElement,
	event: CalendarEvent,
	ctx: LayoutContext,
	drag: DragSpec | null,
): void {
	chip.addEventListener("auxclick", (e) => {
		if (e.button !== 1) return;
		e.preventDefault();
		ctx.callbacks.openBackground(event.path);
	});

	if (!drag) {
		chip.addEventListener("click", (e) => {
			e.stopPropagation();
			ctx.callbacks.open(event.path, !!Keymap.isModEvent(e));
		});
		return;
	}

	const root = chip.closest<HTMLElement>(".obsilities-calendar");

	chip.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		e.preventDefault();
		const startX = e.clientX;
		const startY = e.clientY;
		const doc = chip.doc;
		let dragging = false;

		const begin = (): void => {
			dragging = true;
			ctx.callbacks.setDragging(true);
			chip.addClass("is-dragging");
			root?.addClass("is-dragging-active");
		};

		const end = (): void => {
			chip.removeClass("is-dragging");
			root?.removeClass("is-dragging-active");
			drag.onEnd();
			ctx.callbacks.setDragging(false);
		};

		const cleanup = (): void => {
			doc.removeEventListener("pointermove", onMove);
			doc.removeEventListener("pointerup", onUp);
			doc.removeEventListener("pointercancel", onCancel);
		};

		const onMove = (move: PointerEvent): void => {
			if (!dragging) {
				if (
					Math.abs(move.clientX - startX) < DRAG_THRESHOLD &&
					Math.abs(move.clientY - startY) < DRAG_THRESHOLD
				) {
					return;
				}
				begin();
			}
			drag.onMove(move.clientX, move.clientY);
		};

		const onUp = (up: PointerEvent): void => {
			cleanup();
			if (dragging) {
				drag.onDrop(up.clientX, up.clientY);
				end();
			} else {
				ctx.callbacks.open(event.path, !!Keymap.isModEvent(up));
			}
		};

		const onCancel = (): void => {
			cleanup();
			if (dragging) end();
		};

		doc.addEventListener("pointermove", onMove);
		doc.addEventListener("pointerup", onUp);
		doc.addEventListener("pointercancel", onCancel);
	});
}

export function buildPreviewChip(
	event: CalendarEvent,
	allDay: boolean,
): HTMLElement {
	const chip = createDiv({ cls: "obsilities-calendar-chip is-preview" });
	if (allDay || event.allDay) {
		chip.addClass("is-allday");
	} else {
		chip.createSpan({
			cls: "obsilities-calendar-chip-time",
			text: formatTime(event.start),
		});
	}
	chip.createSpan({
		cls: "obsilities-calendar-chip-title",
		text: event.title,
	});
	return chip;
}
