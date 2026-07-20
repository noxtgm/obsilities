import {
	addDays,
	addMinutes,
	formatHourLabel,
	formatTime,
	minutesSinceMidnight,
	sameDay,
	startOfDay,
	startOfWeek,
	toLocalISODate,
} from "../dates";
import type {
	CalendarEvent,
	CalendarLayoutRenderer,
	LayoutContext,
} from "../types";
import { attachChipInteractions, eventCoversDay, sortEvents } from "./shared";

const HOURS = 24;
const HOUR_HEIGHT = 44; // px per hour, keep in sync with styles.css
const DAY_MINUTES = HOURS * 60;
const COL_HEIGHT = HOURS * HOUR_HEIGHT;
const SNAP_MINUTES = 15;
const DEFAULT_EVENT_MINUTES = 60;
const MIN_BLOCK_HEIGHT = 20;
const INITIAL_SCROLL_HOUR = 7;

interface DaySegment {
	event: CalendarEvent;
	startMin: number; // Minutes from this day's midnight [0, DAY_MINUTES)
	endMin: number; // Minutes from this day's midnight (0, DAY_MINUTES]
	continuesBefore: boolean;
	continuesAfter: boolean;
}

interface PlacedSegment {
	segment: DaySegment;
	lane: number;
	lanes: number;
}

function endTimeOf(event: CalendarEvent): number {
	return event.end
		? event.end.getTime()
		: event.start.getTime() + DEFAULT_EVENT_MINUTES * 60000;
}

function segmentsForDay(events: CalendarEvent[], day: Date): DaySegment[] {
	const dayStart = startOfDay(day).getTime();
	const dayEnd = dayStart + DAY_MINUTES * 60000;
	const segments: DaySegment[] = [];
	for (const event of events) {
		if (event.allDay) continue;
		const start = event.start.getTime();
		const end = endTimeOf(event);
		if (end <= dayStart || start >= dayEnd) continue;
		segments.push({
			event,
			startMin: (Math.max(start, dayStart) - dayStart) / 60000,
			endMin: (Math.min(end, dayEnd) - dayStart) / 60000,
			continuesBefore: start < dayStart,
			continuesAfter: end > dayEnd,
		});
	}
	return segments;
}

function packSegments(segments: DaySegment[]): PlacedSegment[] {
	const sorted = segments
		.slice()
		.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

	const placed: PlacedSegment[] = [];
	let cluster: { segment: DaySegment; lane: number }[] = [];
	let laneEnds: number[] = [];
	let clusterMaxEnd = -Infinity;

	const flush = (): void => {
		const lanes = laneEnds.length;
		for (const item of cluster) {
			placed.push({ segment: item.segment, lane: item.lane, lanes });
		}
		cluster = [];
		laneEnds = [];
		clusterMaxEnd = -Infinity;
	};

	for (const segment of sorted) {
		const start = segment.startMin;
		const end = segment.endMin;
		if (cluster.length > 0 && start >= clusterMaxEnd) flush();

		let lane = -1;
		for (let i = 0; i < laneEnds.length; i++) {
			const laneEnd = laneEnds[i];
			if (laneEnd !== undefined && laneEnd <= start) {
				lane = i;
				break;
			}
		}
		if (lane === -1) {
			lane = laneEnds.length;
			laneEnds.push(end);
		} else {
			laneEnds[lane] = end;
		}

		cluster.push({ segment, lane });
		clusterMaxEnd = Math.max(clusterMaxEnd, end);
	}
	if (cluster.length > 0) flush();

	return placed;
}

export class TimeGridLayout implements CalendarLayoutRenderer {
	private root: HTMLElement;
	private headerEl: HTMLElement;
	private alldayEl: HTMLElement;
	private bodyEl: HTMLElement;
	private draggedId: string | null = null;
	private initialized = false;

	constructor(
		container: HTMLElement,
		private mode: "week" | "3days" | "day",
	) {
		this.root = container.createDiv({
			cls: `obsilities-calendar-timegrid mod-${mode}`,
		});
		this.headerEl = this.root.createDiv({
			cls: "obsilities-calendar-timegrid-header",
		});
		this.alldayEl = this.root.createDiv({
			cls: "obsilities-calendar-timegrid-allday",
		});
		this.bodyEl = this.root.createDiv({
			cls: "obsilities-calendar-timegrid-body",
		});
	}

	destroy(): void {
		this.root.remove();
	}

	private days(ctx: LayoutContext): Date[] {
		if (this.mode === "day") return [startOfDay(ctx.anchor)];
		if (this.mode === "3days") {
			const start = startOfDay(ctx.anchor);
			return [start, addDays(start, 1), addDays(start, 2)];
		}
		const start = startOfWeek(ctx.anchor, ctx.weekStart);
		const days: Date[] = [];
		for (let i = 0; i < 7; i++) days.push(addDays(start, i));
		return days;
	}

	render(ctx: LayoutContext): void {
		const scrollTop = this.bodyEl.scrollTop;
		const days = this.days(ctx);
		this.renderHeader(days, ctx);
		this.renderAllDay(days, ctx);
		this.renderBody(days, ctx);

		if (!this.initialized) {
			this.bodyEl.scrollTop = INITIAL_SCROLL_HOUR * HOUR_HEIGHT;
			this.initialized = true;
		} else {
			this.bodyEl.scrollTop = scrollTop;
		}
	}

	private renderHeader(days: Date[], ctx: LayoutContext): void {
		this.headerEl.empty();
		this.headerEl.createDiv({
			cls: "obsilities-calendar-timegrid-gutter-label",
		});
		const cols = this.headerEl.createDiv({
			cls: "obsilities-calendar-timegrid-header-cols",
		});
		for (const day of days) {
			const col = cols.createDiv({
				cls: "obsilities-calendar-timegrid-dayhead",
			});
			if (sameDay(day, ctx.today)) col.addClass("is-today");
			col.createDiv({
				cls: "obsilities-calendar-dayhead-weekday",
				text: day.toLocaleDateString(undefined, { weekday: "short" }),
			});
			const number = col.createDiv({
				cls: "obsilities-calendar-dayhead-date",
				text: String(day.getDate()),
			});
			if (this.mode !== "day") {
				number.addEventListener("click", (e) => {
					e.stopPropagation();
					ctx.callbacks.viewDay(day);
				});
			}
		}
	}

	private renderAllDay(days: Date[], ctx: LayoutContext): void {
		this.alldayEl.empty();

		const hasAllDay = ctx.events.some(
			(ev) => ev.allDay && days.some((day) => eventCoversDay(ev, day)),
		);
		this.alldayEl.style.display = hasAllDay ? "" : "none";
		if (!hasAllDay) return;

		this.alldayEl.createDiv({
			cls: "obsilities-calendar-timegrid-gutter-label",
			text: "All-day",
		});
		const cols = this.alldayEl.createDiv({
			cls: "obsilities-calendar-timegrid-allday-cols",
		});

		for (const day of days) {
			const col = cols.createDiv({
				cls: "obsilities-calendar-allday-col",
				attr: { "data-date": toLocalISODate(day) },
			});
			const dayEvents = ctx.events
				.filter((ev) => ev.allDay && eventCoversDay(ev, day))
				.sort(sortEvents);
			for (const event of dayEvents) {
				this.buildAllDayChip(
					col,
					event,
					ctx,
					sameDay(event.start, day),
				);
			}
			this.registerAllDayDropZone(col, day, ctx);
		}
	}

	private renderBody(days: Date[], ctx: LayoutContext): void {
		this.bodyEl.empty();

		const gutter = this.bodyEl.createDiv({
			cls: "obsilities-calendar-timegrid-gutter",
		});
		for (let h = 0; h < HOURS; h++) {
			const slot = gutter.createDiv({
				cls: "obsilities-calendar-hour-label",
			});
			if (h > 0) slot.setText(formatHourLabel(h));
		}

		const cols = this.bodyEl.createDiv({
			cls: "obsilities-calendar-timegrid-cols",
		});
		for (const day of days) {
			this.buildDayColumn(cols, day, ctx);
		}
	}

	private buildDayColumn(
		cols: HTMLElement,
		day: Date,
		ctx: LayoutContext,
	): void {
		const col = cols.createDiv({
			cls: "obsilities-calendar-timegrid-col",
			attr: { "data-date": toLocalISODate(day) },
		});
		if (sameDay(day, ctx.today)) col.addClass("is-today");

		for (let h = 0; h < HOURS; h++) {
			col.createDiv({ cls: "obsilities-calendar-hour-line" });
		}

		for (const placed of packSegments(segmentsForDay(ctx.events, day))) {
			this.buildTimedBlock(col, placed, day, ctx);
		}

		if (sameDay(day, ctx.today)) {
			const now = ctx.today;
			const line = col.createDiv({
				cls: "obsilities-calendar-now-line",
			});
			line.style.top = `${(minutesSinceMidnight(now) / 60) * HOUR_HEIGHT}px`;
		}

		this.registerTimedDropZone(col, day, ctx);
	}

	private buildTimedBlock(
		col: HTMLElement,
		placed: PlacedSegment,
		day: Date,
		ctx: LayoutContext,
	): void {
		const { segment, lane, lanes } = placed;
		const { event } = segment;
		const top = (segment.startMin / 60) * HOUR_HEIGHT;
		const height = Math.max(
			MIN_BLOCK_HEIGHT,
			((segment.endMin - segment.startMin) / 60) * HOUR_HEIGHT,
		);

		const block = col.createDiv({
			cls: "obsilities-calendar-event",
			attr: { "data-event-id": event.id },
		});
		if (segment.continuesBefore) block.addClass("is-continued-before");
		if (segment.continuesAfter) block.addClass("is-continued-after");
		block.style.top = `${top}px`;
		block.style.height = `${height}px`;
		block.style.left = `${(lane / lanes) * 100}%`;
		block.style.width = `${(1 / lanes) * 100}%`;

		if (!segment.continuesBefore) {
			block.createSpan({
				cls: "obsilities-calendar-event-time",
				text: formatTime(event.start),
			});
		}
		block.createSpan({
			cls: "obsilities-calendar-event-title",
			text: event.title,
		});

		if (segment.continuesBefore) {
			attachChipInteractions(
				block,
				event,
				ctx,
				() => {},
				() => {},
				false,
			);
		} else {
			attachChipInteractions(
				block,
				event,
				ctx,
				() => {
					this.draggedId = event.id;
				},
				() => {
					this.draggedId = null;
				},
			);
		}

		if (!segment.continuesAfter) {
			const handle = block.createDiv({
				cls: "obsilities-calendar-event-resize",
			});
			this.registerResize(handle, block, event, day, ctx);
		}
	}

	private buildAllDayChip(
		col: HTMLElement,
		event: CalendarEvent,
		ctx: LayoutContext,
		isStart: boolean,
	): void {
		const chip = col.createDiv({
			cls: "obsilities-calendar-chip is-allday",
			attr: { "data-event-id": event.id },
		});
		chip.createSpan({
			cls: "obsilities-calendar-chip-title",
			text: event.title,
		});
		if (isStart) {
			attachChipInteractions(
				chip,
				event,
				ctx,
				() => {
					this.draggedId = event.id;
				},
				() => {
					this.draggedId = null;
				},
			);
		} else {
			attachChipInteractions(
				chip,
				event,
				ctx,
				() => {},
				() => {},
				false,
			);
		}
	}

	private registerAllDayDropZone(
		col: HTMLElement,
		day: Date,
		ctx: LayoutContext,
	): void {
		col.addEventListener("dragover", (e) => {
			if (!this.draggedId) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			col.addClass("is-drop-target");
		});
		col.addEventListener("dragleave", () =>
			col.removeClass("is-drop-target"),
		);
		col.addEventListener("drop", (e) => {
			if (!this.draggedId) return;
			e.preventDefault();
			col.removeClass("is-drop-target");
			const event = this.takeDragged(ctx);
			if (!event) return;
			ctx.callbacks.reschedule(event, startOfDay(day), true);
		});
	}

	private registerTimedDropZone(
		col: HTMLElement,
		day: Date,
		ctx: LayoutContext,
	): void {
		col.addEventListener("dragover", (e) => {
			if (!this.draggedId) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
		});
		col.addEventListener("drop", (e) => {
			if (!this.draggedId) return;
			e.preventDefault();
			const event = this.takeDragged(ctx);
			if (!event) return;
			const minutes = this.pointerMinutes(col, e.clientY);
			const start = addMinutes(startOfDay(day), minutes);
			ctx.callbacks.reschedule(event, start, false);
		});
	}

	private pointerMinutes(col: HTMLElement, clientY: number): number {
		const rect = col.getBoundingClientRect();
		const offset = clientY - rect.top;
		const rawMinutes = (offset / HOUR_HEIGHT) * 60;
		const snapped = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;
		return Math.min(Math.max(snapped, 0), HOURS * 60 - SNAP_MINUTES);
	}

	private takeDragged(ctx: LayoutContext): CalendarEvent | null {
		const event = ctx.events.find((ev) => ev.id === this.draggedId) ?? null;
		this.draggedId = null;
		return event;
	}

	private registerResize(
		handle: HTMLElement,
		block: HTMLElement,
		event: CalendarEvent,
		day: Date,
		ctx: LayoutContext,
	): void {
		handle.addEventListener("click", (e) => e.stopPropagation());

		handle.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			block.setAttribute("draggable", "false");
			ctx.callbacks.setDragging(true);
			handle.setPointerCapture(e.pointerId);

			const startY = e.clientY;
			const startTop = block.offsetTop;
			const startHeight = block.offsetHeight;

			const clampHeight = (raw: number): number =>
				Math.min(
					COL_HEIGHT - startTop,
					Math.max(MIN_BLOCK_HEIGHT, raw),
				);

			const cleanup = (): void => {
				handle.removeEventListener("pointermove", onMove);
				handle.removeEventListener("pointerup", onUp);
				handle.removeEventListener("pointercancel", onCancel);
				block.setAttribute("draggable", "true");
				ctx.callbacks.setDragging(false);
			};

			const onMove = (move: PointerEvent): void => {
				block.style.height = `${clampHeight(
					startHeight + (move.clientY - startY),
				)}px`;
			};

			const onUp = (up: PointerEvent): void => {
				cleanup();
				const finalHeight = clampHeight(
					startHeight + (up.clientY - startY),
				);
				const rawEndMin = ((startTop + finalHeight) / HOUR_HEIGHT) * 60;
				const endMin = Math.min(
					DAY_MINUTES,
					Math.max(
						SNAP_MINUTES,
						Math.round(rawEndMin / SNAP_MINUTES) * SNAP_MINUTES,
					),
				);
				ctx.callbacks.resize(
					event,
					addMinutes(startOfDay(day), endMin),
				);
			};

			const onCancel = (): void => {
				cleanup();
				block.style.height = `${startHeight}px`;
			};

			handle.addEventListener("pointermove", onMove);
			handle.addEventListener("pointerup", onUp);
			handle.addEventListener("pointercancel", onCancel);
		});
	}
}
