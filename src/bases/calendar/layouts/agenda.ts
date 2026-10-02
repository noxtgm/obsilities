import { Keymap } from "obsidian";
import { endOfMonth, formatTime, fromLocalISODate, sameDay, startOfDay } from "../dates";
import type { CalendarEvent, CalendarLayoutRenderer, LayoutContext } from "../types";
import { groupByDay, sortEvents } from "./shared";

function timeLabel(event: CalendarEvent, day: Date): string {
	if (event.allDay) return "All-day";
	if (sameDay(day, event.start)) return formatTime(event.start);
	if (event.end && sameDay(day, event.end)) return formatTime(event.end);
	return "All-day";
}

export class AgendaLayout implements CalendarLayoutRenderer {
	private root: HTMLElement;

	constructor(container: HTMLElement) {
		this.root = container.createDiv({ cls: "obsilities-calendar-agenda" });
	}

	destroy(): void {
		this.root.remove();
	}

	render(ctx: LayoutContext): void {
		this.root.empty();

		const from = Math.max(
			startOfDay(ctx.anchor).getTime(),
			startOfDay(ctx.today).getTime(),
		);
		const monthEnd = endOfMonth(ctx.anchor).getTime();
		const byDay = groupByDay(ctx.events);

		const days = Array.from(byDay.keys())
			.sort()
			.map((iso) => ({ iso, day: fromLocalISODate(iso) }))
			.filter(
				(d): d is { iso: string; day: Date } =>
					d.day !== null &&
					d.day.getTime() >= from &&
					d.day.getTime() <= monthEnd,
			);

		if (days.length === 0) {
			this.root.createDiv({
				cls: "obsilities-calendar-empty",
				text: "No upcoming events this month.",
			});
			return;
		}

		for (const { iso, day } of days) {
			const events = (byDay.get(iso) ?? []).slice().sort(sortEvents);
			this.buildDayGroup(day, events, ctx);
		}
	}

	private buildDayGroup(day: Date, events: CalendarEvent[], ctx: LayoutContext): void {
		const group = this.root.createDiv({
			cls: "obsilities-calendar-agenda-group",
		});
		if (sameDay(day, ctx.today)) group.addClass("is-today");
		group.createDiv({
			cls: "obsilities-calendar-agenda-date",
			text: day.toLocaleDateString(undefined, {
				weekday: "long",
				month: "long",
				day: "numeric",
			}),
		});

		const list = group.createDiv({
			cls: "obsilities-calendar-agenda-list",
		});
		for (const event of events) {
			this.buildRow(list, event, day, ctx);
		}
	}

	private buildRow(
		list: HTMLElement,
		event: CalendarEvent,
		day: Date,
		ctx: LayoutContext,
	): void {
		const row = list.createDiv({
			cls: "obsilities-calendar-agenda-item",
			attr: { "data-event-id": event.id },
		});
		row.createDiv({
			cls: "obsilities-calendar-agenda-time",
			text: timeLabel(event, day),
		});
		row.createDiv({
			cls: "obsilities-calendar-agenda-title",
			text: event.title,
		});
		row.addEventListener("click", (e) => {
			if (Keymap.isModEvent(e)) {
				ctx.callbacks.open(event.path, true);
				return;
			}
			ctx.callbacks.viewDay(day, event.id);
		});
		row.addEventListener("auxclick", (e) => {
			if (e.button !== 1) return;
			e.preventDefault();
			ctx.callbacks.openBackground(event.path);
		});
	}
}
