import { monthFixedLeading, sameDay, toLocalISODate } from "../dates";
import type {
	CalendarEvent,
	CalendarLayoutRenderer,
	LayoutContext,
} from "../types";
import { groupByDay } from "./shared";

export class YearLayout implements CalendarLayoutRenderer {
	private root: HTMLElement;

	constructor(container: HTMLElement) {
		this.root = container.createDiv({ cls: "obsilities-calendar-year" });
	}

	destroy(): void {
		this.root.remove();
	}

	render(ctx: LayoutContext): void {
		this.root.empty();
		const year = ctx.anchor.getFullYear();
		const eventDays = groupByDay(ctx.events);

		for (let month = 0; month < 12; month++) {
			this.buildMonth(year, month, eventDays, ctx);
		}
	}

	private buildMonth(
		year: number,
		month: number,
		eventDays: Map<string, CalendarEvent[]>,
		ctx: LayoutContext,
	): void {
		const monthDate = new Date(year, month, 1);
		const card = this.root.createDiv({
			cls: "obsilities-calendar-year-month",
		});

		const title = card.createDiv({
			cls: "obsilities-calendar-year-month-title",
			text: monthDate.toLocaleDateString(undefined, { month: "long" }),
		});
		title.addEventListener("click", (e) => {
			e.stopPropagation();
			ctx.callbacks.viewMonth(monthDate);
		});

		const grid = card.createDiv({ cls: "obsilities-calendar-year-grid" });
		for (const day of monthFixedLeading(monthDate, 2)) {
			const cell = grid.createDiv({
				cls: "obsilities-calendar-year-day",
			});
			if (day.getMonth() !== month) {
				cell.addClass("is-empty");
				continue;
			}
			if (sameDay(day, ctx.today)) cell.addClass("is-today");
			if (eventDays.has(toLocalISODate(day))) cell.addClass("has-events");
			cell.createSpan({
				cls: "obsilities-calendar-year-day-num",
				text: String(day.getDate()),
			});
			cell.createDiv({ cls: "obsilities-calendar-year-dot" });
			cell.addEventListener("click", (e) => {
				e.stopPropagation();
				ctx.callbacks.viewDay(day);
			});
		}
	}
}
