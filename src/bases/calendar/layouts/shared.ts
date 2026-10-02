import { Keymap } from "obsidian";
import { addDays, addMinutes, formatTime, startOfDay, toLocalISODate } from "../dates";
import type { CalendarEvent, LayoutContext } from "../types";

const MAX_SPAN_DAYS = 366;
const DRAG_THRESHOLD = 4;
const MS_PER_DAY = 86_400_000;

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

function coveredDays(event: CalendarEvent): Date[] {
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

export function allDayDropEnd(
	event: CalendarEvent,
	start: Date,
	durationMinutes: number,
): Date {
	const spanDays = coveredDays(event).length;
	return addMinutes(addDays(start, spanDays - 1), durationMinutes);
}

export function dayDelta(from: Date, to: Date): number {
	return Math.round(
		(startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY,
	);
}

export function shiftEventStart(
	event: CalendarEvent,
	grabDay: Date,
	targetDay: Date,
): Date {
	return addDays(event.start, dayDelta(grabDay, targetDay));
}

export function groupByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
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
	onStart?: (clientX: number, clientY: number) => void;
	onMove: (clientX: number, clientY: number) => void;
	onDrop: (clientX: number, clientY: number) => boolean;
	onEnd: () => void;
}

const SETTLE_MS = 700;
let dragGeneration = 0;

function nextDragGeneration(): number {
	return ++dragGeneration;
}

function settleAfterDrop(
	doc: Document,
	generation: number,
	committed: boolean,
	restore: (stale: boolean) => void,
): void {
	const run = (): void => restore(generation !== dragGeneration);
	if (!committed) {
		run();
		return;
	}
	(doc.defaultView ?? window).setTimeout(run, SETTLE_MS);
}

export function eventNodes(root: HTMLElement | null, eventId: string): HTMLElement[] {
	if (!root) return [];
	return Array.from(root.querySelectorAll<HTMLElement>("[data-event-id]")).filter(
		(el) => el.dataset.eventId === eventId,
	);
}

interface PointerDragOptions {
	ctx: LayoutContext;
	eventId: string;
	drag: DragSpec;
	threshold?: number;
	stopPropagation?: boolean;
	onClick?: (e: PointerEvent) => void;
}

export function registerPointerDrag(el: HTMLElement, opts: PointerDragOptions): void {
	const { ctx, eventId, drag } = opts;
	const threshold = opts.threshold ?? 0;

	el.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		e.preventDefault();
		if (opts.stopPropagation) e.stopPropagation();

		const startX = e.clientX;
		const startY = e.clientY;
		const doc = el.doc;
		const root = el.closest<HTMLElement>(".obsilities-calendar");
		let dragging = false;
		let hidden: HTMLElement[] = [];
		let generation = 0;

		const begin = (): void => {
			drag.onStart?.(startX, startY);
			dragging = true;
			generation = nextDragGeneration();
			ctx.callbacks.setDragging(true);
			const nodes = eventNodes(root, eventId);
			hidden = nodes.length > 0 ? nodes : [el];
			for (const node of hidden) node.addClass("is-dragging");
			root?.addClass("is-dragging-active");
		};

		const end = (committed: boolean): void => {
			root?.removeClass("is-dragging-active");
			ctx.callbacks.setDragging(false);
			const nodes = hidden;
			hidden = [];
			settleAfterDrop(doc, generation, committed, (stale) => {
				for (const node of nodes) node.removeClass("is-dragging");
				if (!stale) drag.onEnd();
			});
		};

		const cleanup = (): void => {
			doc.removeEventListener("pointermove", onMove);
			doc.removeEventListener("pointerup", onUp);
			doc.removeEventListener("pointercancel", onCancel);
		};

		const onMove = (move: PointerEvent): void => {
			if (!dragging) {
				if (
					Math.abs(move.clientX - startX) < threshold &&
					Math.abs(move.clientY - startY) < threshold
				) {
					return;
				}
				begin();
			}
			drag.onMove(move.clientX, move.clientY);
		};

		const onUp = (up: PointerEvent): void => {
			cleanup();
			if (dragging) end(drag.onDrop(up.clientX, up.clientY));
			else opts.onClick?.(up);
		};

		const onCancel = (): void => {
			cleanup();
			if (dragging) end(false);
		};

		doc.addEventListener("pointermove", onMove);
		doc.addEventListener("pointerup", onUp);
		doc.addEventListener("pointercancel", onCancel);
	});
}

export function attachChipInteractions(
	chip: HTMLElement,
	event: CalendarEvent,
	ctx: LayoutContext,
	drag: DragSpec,
): void {
	chip.addEventListener("auxclick", (e) => {
		if (e.button !== 1) return;
		e.preventDefault();
		ctx.callbacks.openBackground(event.path);
	});

	if (!ctx.editable || !event.editable) {
		chip.addEventListener("click", (e) => {
			ctx.callbacks.open(event.path, !!Keymap.isModEvent(e));
		});
		return;
	}

	registerPointerDrag(chip, {
		ctx,
		eventId: event.id,
		drag,
		threshold: DRAG_THRESHOLD,
		onClick: (e) => ctx.callbacks.open(event.path, !!Keymap.isModEvent(e)),
	});
}

export class DragDecorations {
	private previewEls: HTMLElement[] = [];
	private dropTarget: HTMLElement | null = null;

	setDropTarget(el: HTMLElement | null): void {
		if (this.dropTarget === el) return;
		this.dropTarget?.removeClass("is-drop-target");
		this.dropTarget = el;
		el?.addClass("is-drop-target");
	}

	setPreview(els: HTMLElement[]): void {
		this.clearPreview();
		this.previewEls = els;
	}

	addPreview(el: HTMLElement): void {
		this.previewEls.push(el);
	}

	clearPreview(): void {
		for (const el of this.previewEls) el.remove();
		this.previewEls = [];
	}
}

interface ChipOptions {
	allDay: boolean;
	isStart: boolean;
	preview?: boolean;
}

export function buildChip(event: CalendarEvent, opts: ChipOptions): HTMLElement {
	const chip = createDiv({ cls: "obsilities-calendar-chip" });
	if (opts.preview) chip.addClass("is-preview");
	else chip.dataset.eventId = event.id;

	if (opts.allDay) {
		chip.addClass("is-allday");
	} else if (opts.isStart) {
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

export function renderDaySpanPreview(
	event: CalendarEvent,
	grabDay: Date,
	targetDay: Date,
	allDay: boolean,
	resolveContainer: (iso: string) => HTMLElement | null,
): HTMLElement[] {
	const delta = dayDelta(grabDay, targetDay);
	const chips: HTMLElement[] = [];
	coveredDays(event).forEach((covered, i) => {
		const iso = toLocalISODate(addDays(covered, delta));
		const container = resolveContainer(iso);
		if (!container) return; // Day not in the visible range
		const chip = buildChip(event, {
			allDay: allDay || event.allDay,
			isStart: i === 0,
			preview: true,
		});
		container.prepend(chip);
		chips.push(chip);
	});
	return chips;
}
