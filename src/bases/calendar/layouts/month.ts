import { setIcon } from "obsidian";
import { fromLocalISODate, monthGrid, sameDay, toLocalISODate } from "../dates";
import type { CalendarEvent, CalendarLayoutRenderer, LayoutContext } from "../types";
import {
	DragDecorations,
	attachChipInteractions,
	buildChip,
	groupByDay,
	renderDaySpanPreview,
	shiftEventStart,
	sortEvents,
} from "./shared";
import type { DragSpec } from "./shared";

const MAX_CHIPS = 4;

export class MonthLayout implements CalendarLayoutRenderer {
	private root: HTMLElement;
	private decorations = new DragDecorations();

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

		for (const day of monthGrid(ctx.anchor, ctx.weekStart)) {
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
		if (ctx.creatable) {
			const addBtn = dayHeader.createDiv({
				cls: "obsilities-calendar-day-add",
				attr: { "aria-label": "New event on this day" },
			});
			setIcon(addBtn, "plus");
			addBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				ctx.callbacks.create(day);
			});
		}

		const body = cell.createDiv({ cls: "obsilities-calendar-day-events" });
		const dayEvents = (byDay.get(iso) ?? []).slice().sort(sortEvents);
		for (const event of dayEvents.slice(0, MAX_CHIPS)) {
			this.buildEventChip(body, event, ctx, day);
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

	private buildEventChip(
		body: HTMLElement,
		event: CalendarEvent,
		ctx: LayoutContext,
		day: Date,
	): void {
		const chip = buildChip(event, {
			allDay: event.allDay,
			isStart: sameDay(event.start, day),
		});
		body.appendChild(chip);

		attachChipInteractions(chip, event, ctx, this.makeDragSpec(event, ctx, day));
	}

	private makeDragSpec(
		event: CalendarEvent,
		ctx: LayoutContext,
		grabDay: Date,
	): DragSpec {
		return {
			onMove: (x, y) => {
				const at = this.dayAt(x, y);
				if (!at) return;
				this.decorations.setDropTarget(at.cell);
				this.showPreview(grabDay, at.day, event);
			},
			onDrop: (x, y) => {
				const at = this.dayAt(x, y);
				if (!at) return false;
				const start = shiftEventStart(event, grabDay, at.day);
				if (start.getTime() === event.start.getTime()) return false;
				ctx.callbacks.reschedule(event, start, event.allDay);
				return true;
			},
			onEnd: () => {
				this.decorations.clearPreview();
				this.decorations.setDropTarget(null);
			},
		};
	}

	private dayAt(x: number, y: number): { cell: HTMLElement; day: Date } | null {
		const el = this.root.doc.elementFromPoint(x, y);
		const cell = el?.closest<HTMLElement>(".obsilities-calendar-day");
		if (!cell) return null;
		const day = fromLocalISODate(cell.dataset.date ?? "");
		return day ? { cell, day } : null;
	}

	private showPreview(grabDay: Date, targetDay: Date, event: CalendarEvent): void {
		this.decorations.setPreview(
			renderDaySpanPreview(event, grabDay, targetDay, event.allDay, (iso) =>
				this.dayBody(iso),
			),
		);
	}

	private dayBody(iso: string): HTMLElement | null {
		return this.root.querySelector<HTMLElement>(
			`.obsilities-calendar-day[data-date="${iso}"] .obsilities-calendar-day-events`,
		);
	}
}
