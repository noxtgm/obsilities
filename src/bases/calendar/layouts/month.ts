import { setIcon } from "obsidian";
import {
	formatTime,
	fromLocalISODate,
	monthFixedLeading,
	sameDay,
	toLocalISODate,
} from "../dates";
import type {
	CalendarEvent,
	CalendarLayoutRenderer,
	LayoutContext,
} from "../types";
import {
	attachChipInteractions,
	buildPreviewChip,
	groupByDay,
	sortEvents,
} from "./shared";
import type { DragSpec } from "./shared";

const MAX_CHIPS = 4;

export class MonthLayout implements CalendarLayoutRenderer {
	private root: HTMLElement;
	private preview: HTMLElement | null = null;
	private dropTarget: HTMLElement | null = null;

	constructor(container: HTMLElement) {
		this.root = container.createDiv({ cls: "obsilities-calendar-month" });
	}

	destroy(): void {
		this.root.remove();
	}

	render(ctx: LayoutContext): void {
		this.root.empty();

		const grid = this.root.createDiv({ cls: "obsilities-calendar-grid" });
		const byDay = groupByDay(ctx.events);
		const monthIndex = ctx.anchor.getMonth();

		for (const day of monthFixedLeading(ctx.anchor, 2)) {
			this.buildDayCell(grid, day, monthIndex, ctx, byDay);
		}
	}

	private buildDayCell(
		grid: HTMLElement,
		day: Date,
		monthIndex: number,
		ctx: LayoutContext,
		byDay: Map<string, CalendarEvent[]>,
	): void {
		const iso = toLocalISODate(day);
		const cell = grid.createDiv({
			cls: "obsilities-calendar-day",
			attr: { "data-date": iso },
		});
		if (day.getMonth() !== monthIndex) cell.addClass("is-outside");
		if (sameDay(day, ctx.today)) cell.addClass("is-today");

		const dayHeader = cell.createDiv({
			cls: "obsilities-calendar-day-header",
		});
		const number = dayHeader.createSpan({
			cls: "obsilities-calendar-day-number",
			text: String(day.getDate()),
		});
		number.addEventListener("click", (e) => {
			e.stopPropagation();
			ctx.callbacks.viewDay(day);
		});
		const addBtn = dayHeader.createDiv({
			cls: "obsilities-calendar-day-add",
			attr: { "aria-label": "New event on this day" },
		});
		setIcon(addBtn, "plus");
		addBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			ctx.callbacks.create(day);
		});

		const body = cell.createDiv({ cls: "obsilities-calendar-day-events" });
		const dayEvents = (byDay.get(iso) ?? []).slice().sort(sortEvents);
		for (const event of dayEvents.slice(0, MAX_CHIPS)) {
			this.buildChip(body, event, ctx, sameDay(event.start, day));
		}
		if (dayEvents.length > MAX_CHIPS) {
			const more = body.createDiv({
				cls: "obsilities-calendar-more",
				text: `+${dayEvents.length - MAX_CHIPS} more`,
			});
			more.addEventListener("click", (e) => {
				e.stopPropagation();
				ctx.callbacks.viewDay(day);
			});
		}
	}

	private buildChip(
		body: HTMLElement,
		event: CalendarEvent,
		ctx: LayoutContext,
		isStart: boolean,
	): void {
		const chip = body.createDiv({
			cls: "obsilities-calendar-chip",
			attr: { "data-event-id": event.id },
		});
		if (event.allDay) chip.addClass("is-allday");
		else if (isStart) {
			chip.createSpan({
				cls: "obsilities-calendar-chip-time",
				text: formatTime(event.start),
			});
		}
		chip.createSpan({
			cls: "obsilities-calendar-chip-title",
			text: event.title,
		});

		attachChipInteractions(
			chip,
			event,
			ctx,
			isStart ? this.makeDragSpec(event, ctx) : null,
		);
	}

	private makeDragSpec(event: CalendarEvent, ctx: LayoutContext): DragSpec {
		return {
			onMove: (x, y) => {
				const cell = this.cellAt(x, y);
				this.setDropTarget(cell);
				const day = cell && fromLocalISODate(cell.dataset.date ?? "");
				if (!day || sameDay(day, event.start)) {
					this.clearPreview();
					return;
				}
				const body = cell.querySelector<HTMLElement>(
					".obsilities-calendar-day-events",
				);
				if (body) this.showPreview(body, event);
			},
			onDrop: (x, y) => {
				const cell = this.cellAt(x, y);
				const day = cell && fromLocalISODate(cell.dataset.date ?? "");
				if (!day) return;
				const start = new Date(day);
				if (!event.allDay) {
					start.setHours(
						event.start.getHours(),
						event.start.getMinutes(),
						0,
						0,
					);
				}
				if (sameDay(start, event.start)) return;
				ctx.callbacks.reschedule(event, start, event.allDay);
			},
			onEnd: () => {
				this.clearPreview();
				this.setDropTarget(null);
			},
		};
	}

	private cellAt(x: number, y: number): HTMLElement | null {
		const el = this.root.doc.elementFromPoint(x, y);
		return el
			? el.closest<HTMLElement>(".obsilities-calendar-day")
			: null;
	}

	private setDropTarget(cell: HTMLElement | null): void {
		if (this.dropTarget === cell) return;
		this.dropTarget?.removeClass("is-drop-target");
		this.dropTarget = cell;
		cell?.addClass("is-drop-target");
	}

	private showPreview(body: HTMLElement, event: CalendarEvent): void {
		let preview = this.preview;
		if (!preview || !preview.isConnected) {
			preview = buildPreviewChip(event, event.allDay);
			this.preview = preview;
		}
		if (preview.parentElement !== body) body.prepend(preview);
	}

	private clearPreview(): void {
		this.preview?.remove();
		this.preview = null;
	}
}
