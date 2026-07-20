import { Keymap } from "obsidian";
import { formatTime, sameDay, startOfDay, toLocalISODate } from "../dates";
import type {
	CalendarEvent,
	CalendarLayoutRenderer,
	LayoutContext,
} from "../types";
import { coveredDays, sortEvents } from "./shared";

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

		const from = startOfDay(ctx.anchor).getTime();
		const groups = new Map<
			string,
			{ day: Date; events: CalendarEvent[] }
		>();
		for (const event of ctx.events) {
			for (const day of coveredDays(event)) {
				if (day.getTime() < from) continue;
				const iso = toLocalISODate(day);
				const group = groups.get(iso);
				if (group) group.events.push(event);
				else groups.set(iso, { day, events: [event] });
			}
		}

		if (groups.size === 0) {
			this.root.createDiv({
				cls: "obsilities-calendar-empty",
				text: "No upcoming events.",
			});
			return;
		}

		for (const key of Array.from(groups.keys()).sort()) {
			const group = groups.get(key);
			if (!group) continue;
			group.events.sort(sortEvents);
			this.buildDayGroup(group.day, group.events, ctx);
		}
	}

	private buildDayGroup(
		day: Date,
		events: CalendarEvent[],
		ctx: LayoutContext,
	): void {
		const group = this.root.createDiv({
			cls: "obsilities-calendar-agenda-group",
		});
		const header = group.createDiv({
			cls: "obsilities-calendar-agenda-date",
			text: day.toLocaleDateString(undefined, {
				weekday: "long",
				month: "short",
				day: "numeric",
			}),
		});
		if (sameDay(day, ctx.today)) header.addClass("is-today");

		const list = group.createDiv({
			cls: "obsilities-calendar-agenda-list",
		});
		for (const event of events) {
			this.buildRow(list, event, ctx);
		}
	}

	private buildRow(
		list: HTMLElement,
		event: CalendarEvent,
		ctx: LayoutContext,
	): void {
		const row = list.createDiv({
			cls: "obsilities-calendar-agenda-item",
			attr: { "data-event-id": event.id },
		});
		row.createDiv({
			cls: "obsilities-calendar-agenda-time",
			text: event.allDay ? "All-day" : formatTime(event.start),
		});
		row.createDiv({
			cls: "obsilities-calendar-agenda-title",
			text: event.title,
		});
		row.addEventListener("click", (e) => {
			ctx.callbacks.open(event.path, !!Keymap.isModEvent(e));
		});
		row.addEventListener("auxclick", (e) => {
			if (e.button !== 1) return;
			e.preventDefault();
			ctx.callbacks.openBackground(event.path);
		});
	}
}
