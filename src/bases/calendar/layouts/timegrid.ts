import {
	DAY_MINUTES,
	addDays,
	addMinutes,
	atMinutes,
	formatHourLabel,
	formatTime,
	fromLocalISODate,
	minutesSinceMidnight,
	sameDay,
	sameMinute,
	spanMinutesIntoDay,
	startOfDay,
	startOfNextDay,
	startOfWeek,
	toLocalISODate,
} from "../dates";
import type { CalendarEvent, CalendarLayoutRenderer, LayoutContext } from "../types";
import {
	DragDecorations,
	allDayDropEnd,
	attachChipInteractions,
	buildChip,
	dayDelta,
	eventNodes,
	groupByDay,
	registerPointerDrag,
	renderDaySpanPreview,
	shiftEventStart,
	sortEvents,
} from "./shared";
import type { DragSpec } from "./shared";

type TimeGridZone = {
	kind: "timed" | "allday";
	col: HTMLElement;
	day: Date;
};

const HOURS = DAY_MINUTES / 60;
const HOUR_HEIGHT = 38; // px per hour, keep in sync with styles.css
const SNAP_MINUTES = 15;
const MIN_BLOCK_HEIGHT = 6;
const COMPACT_BLOCK_HEIGHT = 36;
const TINY_BLOCK_HEIGHT = 18;
const INITIAL_SCROLL_HOUR = 7;
const MIN_BLOCK_MINUTES = (MIN_BLOCK_HEIGHT / HOUR_HEIGHT) * 60;

interface DaySegment {
	event: CalendarEvent;
	startMin: number; // Minutes from this day's midnight [0, DAY_MINUTES)
	endMin: number; // Minutes from this day's midnight (0, DAY_MINUTES]
	paintedEndMin: number;
	continuesBefore: boolean;
	continuesAfter: boolean;
}

interface PlacedSegment {
	segment: DaySegment;
	lane: number;
	lanes: number;
}

function endTimeOf(event: CalendarEvent, defaultMinutes: number): number {
	return event.end
		? event.end.getTime()
		: event.start.getTime() + defaultMinutes * 60000;
}

function durationMinutes(event: CalendarEvent, defaultMinutes: number): number {
	return (endTimeOf(event, defaultMinutes) - event.start.getTime()) / 60000;
}

function paintedEnd(startMin: number, endMin: number): number {
	return Math.max(endMin, startMin + MIN_BLOCK_MINUTES);
}

function segmentsForDay(
	events: CalendarEvent[],
	day: Date,
	defaultMinutes: number,
): DaySegment[] {
	const dayStart = startOfDay(day).getTime();
	const dayEnd = startOfNextDay(day).getTime();
	const segments: DaySegment[] = [];
	for (const event of events) {
		if (event.allDay) continue;
		const start = event.start.getTime();
		const end = endTimeOf(event, defaultMinutes);
		const span = spanMinutesIntoDay(start, end, dayStart, dayEnd);
		if (!span) continue;
		segments.push({
			event,
			startMin: span.startMin,
			endMin: span.endMin,
			paintedEndMin: paintedEnd(span.startMin, span.endMin),
			continuesBefore: start < dayStart,
			continuesAfter: end > dayEnd,
		});
	}
	return segments;
}

function spansDays(segment: DaySegment): boolean {
	return segment.continuesBefore || segment.continuesAfter;
}

function laneOrder(a: DaySegment, b: DaySegment): number {
	const spanA = spansDays(a);
	const spanB = spansDays(b);
	if (spanA !== spanB) return spanA ? -1 : 1;
	if (spanA) {
		return (
			a.event.start.getTime() - b.event.start.getTime() ||
			a.event.id.localeCompare(b.event.id)
		);
	}
	return (
		a.startMin - b.startMin ||
		a.paintedEndMin - b.paintedEndMin ||
		a.event.id.localeCompare(b.event.id)
	);
}

/** Split into groups of transitively overlapping segments */
function clusterSegments(segments: DaySegment[]): DaySegment[][] {
	const sorted = segments
		.slice()
		.sort((a, b) => a.startMin - b.startMin || a.paintedEndMin - b.paintedEndMin);

	const clusters: DaySegment[][] = [];
	let cluster: DaySegment[] = [];
	let clusterMaxEnd = -Infinity;

	for (const segment of sorted) {
		if (cluster.length > 0 && segment.startMin >= clusterMaxEnd) {
			clusters.push(cluster);
			cluster = [];
			clusterMaxEnd = -Infinity;
		}
		cluster.push(segment);
		clusterMaxEnd = Math.max(clusterMaxEnd, segment.paintedEndMin);
	}
	if (cluster.length > 0) clusters.push(cluster);

	return clusters;
}

function packSegments(segments: DaySegment[]): PlacedSegment[] {
	const placed: PlacedSegment[] = [];

	for (const cluster of clusterSegments(segments)) {
		const lanes: DaySegment[][] = [];
		for (const segment of cluster.slice().sort(laneOrder)) {
			let target = lanes.find((members) =>
				members.every(
					(other) =>
						other.paintedEndMin <= segment.startMin ||
						other.startMin >= segment.paintedEndMin,
				),
			);
			if (!target) {
				target = [];
				lanes.push(target);
			}
			target.push(segment);
		}
		for (let i = 0; i < lanes.length; i++) {
			for (const segment of lanes[i] ?? []) {
				placed.push({ segment, lane: i, lanes: lanes.length });
			}
		}
	}

	return placed;
}

function nowLineOffset(now: Date): string {
	return `${(minutesSinceMidnight(now) / 60) * HOUR_HEIGHT}px`;
}

export class TimeGridLayout implements CalendarLayoutRenderer {
	private root: HTMLElement;
	private headerEl: HTMLElement;
	private alldayEl: HTMLElement;
	private bodyEl: HTMLElement;
	private decorations = new DragDecorations();
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

		if (ctx.focusEventId && this.centerOnEvent(ctx.focusEventId)) {
			this.initialized = true;
		} else if (!this.initialized) {
			this.bodyEl.scrollTop = INITIAL_SCROLL_HOUR * HOUR_HEIGHT;
			this.initialized = true;
		} else {
			this.bodyEl.scrollTop = scrollTop;
		}
	}

	private centerOnEvent(eventId: string): boolean {
		const block = eventNodes(this.bodyEl, eventId)[0];
		if (!block) return false;
		const blockRect = block.getBoundingClientRect();
		const bodyRect = this.bodyEl.getBoundingClientRect();
		const top = blockRect.top - bodyRect.top + this.bodyEl.scrollTop;
		const centered = top + blockRect.height / 2 - this.bodyEl.clientHeight / 2;
		const max = this.bodyEl.scrollHeight - this.bodyEl.clientHeight;
		this.bodyEl.scrollTop = Math.max(0, Math.min(centered, max));
		return true;
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

		this.alldayEl.createDiv({
			cls: "obsilities-calendar-timegrid-gutter-label",
			text: "All-day",
		});
		const cols = this.alldayEl.createDiv({
			cls: "obsilities-calendar-timegrid-allday-cols",
		});

		const byDay = groupByDay(ctx.events);
		for (const day of days) {
			const iso = toLocalISODate(day);
			const col = cols.createDiv({
				cls: "obsilities-calendar-allday-col",
				attr: { "data-date": iso },
			});
			const dayEvents = (byDay.get(iso) ?? [])
				.filter((ev) => ev.allDay)
				.sort(sortEvents);
			for (const event of dayEvents) {
				this.buildAllDayChip(col, event, ctx, day);
			}
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

		this.buildNowLineLead(cols, days, ctx);
	}

	private buildNowLineLead(cols: HTMLElement, days: Date[], ctx: LayoutContext): void {
		const todayIndex = days.findIndex((day) => sameDay(day, ctx.today));
		if (todayIndex <= 0) return;
		const lead = cols.createDiv({ cls: "obsilities-calendar-now-line-lead" });
		lead.style.top = nowLineOffset(ctx.today);
		lead.style.right = `${((days.length - todayIndex) / days.length) * 100}%`;
	}

	private buildDayColumn(cols: HTMLElement, day: Date, ctx: LayoutContext): void {
		const col = cols.createDiv({
			cls: "obsilities-calendar-timegrid-col",
			attr: { "data-date": toLocalISODate(day) },
		});
		if (sameDay(day, ctx.today)) col.addClass("is-today");

		for (let h = 0; h < HOURS; h++) {
			const line = col.createDiv({ cls: "obsilities-calendar-hour-line" });
			if (h === HOURS - 1) line.addClass("is-day-end");
		}

		const segments = segmentsForDay(ctx.events, day, ctx.defaultDurationMinutes);
		for (const placed of packSegments(segments)) {
			this.buildTimedBlock(col, placed, ctx, day);
		}

		if (sameDay(day, ctx.today)) {
			const line = col.createDiv({
				cls: "obsilities-calendar-now-line",
			});
			line.style.top = nowLineOffset(ctx.today);
		}
	}

	private buildTimedBlock(
		col: HTMLElement,
		placed: PlacedSegment,
		ctx: LayoutContext,
		day: Date,
	): void {
		const { segment, lane, lanes } = placed;
		const { event } = segment;
		const top = (segment.startMin / 60) * HOUR_HEIGHT;
		const height = ((segment.paintedEndMin - segment.startMin) / 60) * HOUR_HEIGHT;

		const block = col.createDiv({
			cls: "obsilities-calendar-event",
			attr: { "data-event-id": event.id },
		});
		if (segment.continuesBefore) block.addClass("is-continued-before");
		if (segment.continuesAfter) block.addClass("is-continued-after");
		if (height < COMPACT_BLOCK_HEIGHT) block.addClass("is-compact");
		if (height < TINY_BLOCK_HEIGHT) block.addClass("is-tiny");
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

		attachChipInteractions(block, event, ctx, this.makeDragSpec(event, ctx, day));

		if (!ctx.editable || !event.editable) return;
		if (!segment.continuesBefore) {
			const topHandle = block.createDiv({
				cls: "obsilities-calendar-event-resize is-top",
			});
			this.registerEdgeDrag(topHandle, event, "start", ctx);
		}
		// The end handle writes the end property, so it needs one to write to
		if (!segment.continuesAfter && event.endSource) {
			const bottomHandle = block.createDiv({
				cls: "obsilities-calendar-event-resize is-bottom",
			});
			this.registerEdgeDrag(bottomHandle, event, "end", ctx);
		}
	}

	private buildAllDayChip(
		col: HTMLElement,
		event: CalendarEvent,
		ctx: LayoutContext,
		day: Date,
	): void {
		const chip = buildChip(event, { allDay: true, isStart: false });
		col.appendChild(chip);
		attachChipInteractions(chip, event, ctx, this.makeDragSpec(event, ctx, day));
	}

	private makeDragSpec(
		event: CalendarEvent,
		ctx: LayoutContext,
		grabDay: Date,
	): DragSpec {
		let grabMinutes: number | null = null;
		return {
			onStart: (x, y) => {
				const zone = this.zoneAt(x, y);
				grabMinutes = zone?.kind === "timed" ? this.minutesAt(zone.col, y) : null;
			},
			onMove: (x, y) => {
				const zone = this.zoneAt(x, y);
				if (!zone) return;
				if (zone.kind === "timed") {
					this.decorations.setDropTarget(null);
					this.showPreview(
						this.dropStart(event, zone, y, grabDay, grabMinutes),
						event,
						ctx,
					);
				} else {
					this.decorations.setDropTarget(zone.col);
					this.showAllDayPreview(grabDay, zone.day, event);
				}
			},
			onDrop: (x, y) => {
				const zone = this.zoneAt(x, y);
				if (!zone) return false;
				const allDay = zone.kind === "allday";
				const start = this.dropStart(event, zone, y, grabDay, grabMinutes);
				if (allDay === event.allDay && sameMinute(start, event.start)) {
					return false;
				}
				ctx.callbacks.reschedule(event, start, allDay);
				return true;
			},
			onEnd: () => {
				this.decorations.clearPreview();
				this.decorations.setDropTarget(null);
			},
		};
	}

	private dropStart(
		event: CalendarEvent,
		zone: TimeGridZone,
		clientY: number,
		grabDay: Date,
		grabMinutes: number | null,
	): Date {
		const shifted = shiftEventStart(event, grabDay, zone.day);
		if (zone.kind === "allday") return shifted;
		if (grabMinutes === null) {
			const dropped = atMinutes(
				zone.day,
				this.snappedMinutes(zone.col, clientY, DAY_MINUTES - SNAP_MINUTES),
			);
			return addDays(dropped, -dayDelta(event.start, grabDay));
		}
		const delta = this.minutesAt(zone.col, clientY) - grabMinutes;
		const snapped = Math.round(delta / SNAP_MINUTES) * SNAP_MINUTES;
		return atMinutes(shifted, minutesSinceMidnight(shifted) + snapped);
	}

	private zoneAt(x: number, y: number): TimeGridZone | null {
		const el = this.root.doc.elementFromPoint(x, y);
		if (!el) return null;
		const timed = el.closest<HTMLElement>(".obsilities-calendar-timegrid-col");
		if (timed) {
			const day = fromLocalISODate(timed.dataset.date ?? "");
			if (day) return { kind: "timed", col: timed, day };
		}
		const allday = el.closest<HTMLElement>(".obsilities-calendar-allday-col");
		if (allday) {
			const day = fromLocalISODate(allday.dataset.date ?? "");
			if (day) return { kind: "allday", col: allday, day };
		}
		return null;
	}

	private showPreview(start: Date, event: CalendarEvent, ctx: LayoutContext): void {
		this.decorations.clearPreview();
		const end = this.droppedEnd(event, start, ctx);
		this.appendSpanSegments(start, end, event.title);
	}

	private droppedEnd(event: CalendarEvent, start: Date, ctx: LayoutContext): Date {
		if (event.allDay) {
			return allDayDropEnd(event, start, ctx.defaultDurationMinutes);
		}
		if (!event.end) return addMinutes(start, ctx.defaultDurationMinutes);
		return addMinutes(start, durationMinutes(event, ctx.defaultDurationMinutes));
	}

	private showResizePreview(event: CalendarEvent, start: Date, end: Date): void {
		this.decorations.clearPreview();
		this.appendSpanSegments(start, end, event.title);
	}

	private appendSpanSegments(start: Date, end: Date, title: string): void {
		const endMs = end.getTime();
		let day = startOfDay(start);
		for (let guard = 0; day.getTime() < endMs && guard < 366; guard++) {
			const dayStart = day.getTime();
			const next = startOfNextDay(day);
			const dayEnd = next.getTime();
			const col = this.timedColForDay(toLocalISODate(day));
			day = next;
			if (!col) continue; // Day not in view

			const span = spanMinutesIntoDay(start.getTime(), endMs, dayStart, dayEnd);
			if (!span) continue;
			const continuesBefore = start.getTime() < dayStart;
			this.appendPreviewSegment(col, {
				topMin: span.startMin,
				botMin: span.endMin,
				timeLabel: continuesBefore ? null : formatTime(start),
				title,
				continuesBefore,
				continuesAfter: endMs > dayEnd,
			});
		}
	}

	private appendPreviewSegment(
		col: HTMLElement,
		seg: {
			topMin: number;
			botMin: number;
			timeLabel: string | null;
			title: string;
			continuesBefore: boolean;
			continuesAfter: boolean;
		},
	): void {
		const el = createDiv({ cls: "obsilities-calendar-event is-preview" });
		if (seg.continuesBefore) el.addClass("is-continued-before");
		if (seg.continuesAfter) el.addClass("is-continued-after");

		const top = (seg.topMin / 60) * HOUR_HEIGHT;
		const height =
			((paintedEnd(seg.topMin, seg.botMin) - seg.topMin) / 60) * HOUR_HEIGHT;
		if (height < COMPACT_BLOCK_HEIGHT) el.addClass("is-compact");
		if (height < TINY_BLOCK_HEIGHT) el.addClass("is-tiny");
		el.style.top = `${top}px`;
		el.style.height = `${height}px`;
		el.style.left = "0";
		el.style.width = "100%";

		if (seg.timeLabel !== null) {
			el.createSpan({
				cls: "obsilities-calendar-event-time",
				text: seg.timeLabel,
			});
		}
		el.createSpan({
			cls: "obsilities-calendar-event-title",
			text: seg.title,
		});

		col.appendChild(el);
		this.decorations.addPreview(el);
	}

	private timedColForDay(iso: string): HTMLElement | null {
		return this.bodyEl.querySelector<HTMLElement>(
			`.obsilities-calendar-timegrid-col[data-date="${iso}"]`,
		);
	}

	private showAllDayPreview(grabDay: Date, day: Date, event: CalendarEvent): void {
		this.decorations.setPreview(
			renderDaySpanPreview(event, grabDay, day, true, (iso) =>
				this.alldayColForDay(iso),
			),
		);
	}

	private alldayColForDay(iso: string): HTMLElement | null {
		return this.alldayEl.querySelector<HTMLElement>(
			`.obsilities-calendar-allday-col[data-date="${iso}"]`,
		);
	}

	private minutesAt(col: HTMLElement, clientY: number): number {
		const offset = clientY - col.getBoundingClientRect().top;
		const minutes = (offset / HOUR_HEIGHT) * 60;
		return Math.min(Math.max(minutes, 0), DAY_MINUTES);
	}

	private snappedMinutes(
		col: HTMLElement,
		clientY: number,
		maxMinutes: number,
	): number {
		const raw = this.minutesAt(col, clientY);
		const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES;
		return Math.min(snapped, maxMinutes);
	}

	private registerEdgeDrag(
		handle: HTMLElement,
		event: CalendarEvent,
		edge: "start" | "end",
		ctx: LayoutContext,
	): void {
		handle.addEventListener("click", (e) => e.stopPropagation());

		registerPointerDrag(handle, {
			ctx,
			eventId: event.id,
			stopPropagation: true,
			drag: {
				onMove: (x, y) => {
					const res = this.edgeResizeAt(
						x,
						y,
						event,
						edge,
						ctx.defaultDurationMinutes,
					);
					if (res) this.showResizePreview(event, res.start, res.end);
				},
				onDrop: (x, y) => {
					const res = this.edgeResizeAt(
						x,
						y,
						event,
						edge,
						ctx.defaultDurationMinutes,
					);
					if (!res) return false;
					ctx.callbacks.resize(event, res.start, res.end);
					return true;
				},
				onEnd: () => this.decorations.clearPreview(),
			},
		});
	}

	private edgeResizeAt(
		clientX: number,
		clientY: number,
		event: CalendarEvent,
		edge: "start" | "end",
		defaultMinutes: number,
	): { start: Date; end: Date } | null {
		const zone = this.zoneAt(clientX, clientY);
		if (!zone || zone.kind !== "timed") return null;
		const minutes = this.snappedMinutes(zone.col, clientY, DAY_MINUTES);
		const candidate = atMinutes(zone.day, minutes).getTime();
		const minMs = SNAP_MINUTES * 60000;
		if (edge === "end") {
			const startMs = event.start.getTime();
			return {
				start: new Date(startMs),
				end: new Date(Math.max(startMs + minMs, candidate)),
			};
		}
		const endMs = endTimeOf(event, defaultMinutes);
		return {
			start: new Date(Math.min(endMs - minMs, candidate)),
			end: new Date(endMs),
		};
	}
}
