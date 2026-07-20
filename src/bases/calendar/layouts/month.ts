import { setIcon } from "obsidian";
import {
	formatTime,
	monthFixedLeading,
	sameDay,
	toLocalISODate,
} from "../dates";
import type {
	CalendarEvent,
	CalendarLayoutRenderer,
	LayoutContext,
} from "../types";
import { attachChipInteractions, groupByDay, sortEvents } from "./shared";

const MAX_CHIPS = 4;

export class MonthLayout implements CalendarLayoutRenderer {
	private root: HTMLElement;
	private draggedId: string | null = null;

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
			attr: { "aria-label": "New note on this day" },
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

		this.registerDropZone(cell, day, ctx);
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

	private registerDropZone(
		cell: HTMLElement,
		day: Date,
		ctx: LayoutContext,
	): void {
		cell.addEventListener("dragover", (e) => {
			if (!this.draggedId) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			cell.addClass("is-drop-target");
		});
		cell.addEventListener("dragleave", () => {
			cell.removeClass("is-drop-target");
		});
		cell.addEventListener("drop", (e) => {
			if (!this.draggedId) return;
			e.preventDefault();
			cell.removeClass("is-drop-target");
			const event = ctx.events.find((ev) => ev.id === this.draggedId);
			this.draggedId = null;
			if (!event) return;

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
		});
	}
}
