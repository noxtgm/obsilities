import { BasesView, TFile, debounce, setIcon } from "obsidian";
import type { BasesOptions, BasesPropertyId, QueryController } from "obsidian";
import {
	addDays,
	addMonths,
	addYears,
	endOfDay,
	endOfMonth,
	endOfYear,
	formatDateRange,
	formatDayTitle,
	formatMonthTitle,
	formatWeekTitle,
	monthFixedLeading,
	startOfDay,
	startOfMonth,
	startOfWeek,
	startOfYear,
} from "./dates";
import { buildEvents } from "./events";
import { AgendaLayout } from "./layouts/agenda";
import { MonthLayout } from "./layouts/month";
import { TimeGridLayout } from "./layouts/timegrid";
import { YearLayout } from "./layouts/year";
import {
	CALENDAR_LAYOUTS,
	CALENDAR_VIEW_TYPE,
	CONFIG,
	LAYOUT_LABELS,
} from "./types";
import type {
	CalendarCallbacks,
	CalendarEvent,
	CalendarLayout,
	CalendarLayoutRenderer,
	LayoutContext,
} from "./types";
import {
	dateFrontmatterSetter,
	isWritableProperty,
	writeDates,
} from "./writes";
import type { DateWrite } from "./writes";

export class CalendarView extends BasesView {
	type = CALENDAR_VIEW_TYPE;

	containerEl: HTMLElement;
	private scrollEl: HTMLElement;
	private prevScrollPosition: string;
	private bodyEl: HTMLElement;
	private toolbarTitleEl: HTMLElement | null = null;
	private prevBtn: HTMLElement | null = null;
	private layoutButtons: Map<CalendarLayout, HTMLElement> = new Map();

	private layout: CalendarLayout = "month";
	private anchor: Date = startOfDay(new Date());
	private weekStart = 1; // Monday by default
	private stateInitialized = false;

	private renderer: CalendarLayoutRenderer | null = null;
	private rendererLayout: CalendarLayout | null = null;
	private dragging = false;

	private dateProp: BasesPropertyId | null = null;
	private endProp: BasesPropertyId | null = null;
	private titleProp: BasesPropertyId | null = null;

	private readonly rerender = debounce(() => this.render(), 50, true);

	constructor(controller: QueryController, scrollEl: HTMLElement) {
		super(controller);
		this.scrollEl = scrollEl;
		this.prevScrollPosition = scrollEl.style.position;
		scrollEl.style.position = "relative";
		this.containerEl = scrollEl.createDiv({ cls: "obsilities-calendar" });
		this.buildToolbar();
		this.bodyEl = this.containerEl.createDiv({
			cls: "obsilities-calendar-body",
		});
	}

	onDataUpdated(): void {
		this.rerender();
	}

	onunload(): void {
		this.rerender.cancel();
		this.renderer?.destroy();
		this.renderer = null;
		this.containerEl.remove();
		this.scrollEl.style.position = this.prevScrollPosition;
	}

	private buildToolbar(): void {
		const bar = this.containerEl.createDiv({
			cls: "obsilities-calendar-toolbar",
		});

		const nav = bar.createDiv({ cls: "obsilities-calendar-nav" });
		const today = nav.createEl("button", {
			cls: "obsilities-calendar-today",
			text: "Today",
		});
		today.addEventListener("click", () => this.goToday());

		const prev = nav.createDiv({
			cls: "obsilities-calendar-nav-btn clickable-icon",
			attr: { "aria-label": "Previous" },
		});
		setIcon(prev, "chevron-left");
		prev.addEventListener("click", () => this.step(-1));
		this.prevBtn = prev;

		const next = nav.createDiv({
			cls: "obsilities-calendar-nav-btn clickable-icon",
			attr: { "aria-label": "Next" },
		});
		setIcon(next, "chevron-right");
		next.addEventListener("click", () => this.step(1));

		this.toolbarTitleEl = bar.createDiv({
			cls: "obsilities-calendar-title",
		});

		const switcher = bar.createDiv({
			cls: "obsilities-calendar-switcher",
		});
		for (const layout of CALENDAR_LAYOUTS) {
			const btn = switcher.createEl("button", {
				cls: "obsilities-calendar-switch-btn",
				text: LAYOUT_LABELS[layout],
			});
			btn.addEventListener("click", () => this.setLayout(layout));
			this.layoutButtons.set(layout, btn);
		}
	}

	private updateToolbar(): void {
		this.renderTitle();
		const prevDisabled = this.isPrevDisabled();
		this.prevBtn?.toggleClass("is-disabled", prevDisabled);
		this.prevBtn?.setAttribute(
			"aria-disabled",
			prevDisabled ? "true" : "false",
		);
		for (const [layout, btn] of this.layoutButtons) {
			btn.toggleClass("is-active", layout === this.layout);
		}
	}

	// Agenda is forward-only: never page earlier than the current month.
	private isPrevDisabled(): boolean {
		if (this.layout !== "agenda") return false;
		return (
			startOfMonth(this.anchor).getTime() <=
			startOfMonth(new Date()).getTime()
		);
	}

	private renderTitle(): void {
		const el = this.toolbarTitleEl;
		if (!el) return;
		el.empty();
		for (const part of this.titleText().split(/(\d{4})/)) {
			if (!part) continue;
			if (/^\d{4}$/.test(part)) {
				const span = el.createSpan({
					cls: "obsilities-calendar-title-year",
					text: part,
				});
				if (this.layout !== "year") {
					span.addClass("is-clickable");
					span.setAttribute("aria-label", "Show this year");
					const year = Number(part);
					span.addEventListener("click", (e) => {
						e.stopPropagation();
						this.goToYear(year);
					});
				}
			} else {
				el.appendText(part);
			}
		}
	}

	private goToYear(year: number): void {
		this.layout = "year";
		this.anchor = new Date(year, this.anchor.getMonth(), 1);
		this.render();
	}

	private titleText(): string {
		switch (this.layout) {
			case "year":
				return String(this.anchor.getFullYear());
			case "week":
				return formatWeekTitle(this.anchor, this.weekStart);
			case "3days": {
				const start = startOfDay(this.anchor);
				return formatDateRange(start, addDays(start, 2));
			}
			case "day":
				return formatDayTitle(this.anchor);
			default:
				return formatMonthTitle(this.anchor);
		}
	}

	private step(direction: number): void {
		if (direction < 0 && this.isPrevDisabled()) return;
		switch (this.layout) {
			case "year":
				this.anchor = addYears(this.anchor, direction);
				break;
			case "month":
			case "agenda":
				this.anchor = addMonths(this.anchor, direction);
				break;
			case "3days":
				this.anchor = addDays(this.anchor, 3 * direction);
				break;
			case "day":
				this.anchor = addDays(this.anchor, direction);
				break;
			default:
				this.anchor = addDays(this.anchor, 7 * direction);
				break;
		}
		this.render();
	}

	private goToday(): void {
		this.anchor = startOfDay(new Date());
		this.render();
	}

	private setLayout(layout: CalendarLayout): void {
		if (layout === this.layout) return;
		this.layout = layout;
		this.render();
	}

	private initStateFromConfig(): void {
		if (this.stateInitialized) return;
		this.stateInitialized = true;

		this.layout =
			this.coerceLayout(this.config.get(CONFIG.defaultLayout)) ?? "month";
	}

	private coerceLayout(value: unknown): CalendarLayout | null {
		return typeof value === "string" &&
			(CALENDAR_LAYOUTS as string[]).includes(value)
			? (value as CalendarLayout)
			: null;
	}

	private readWeekStart(): number {
		const raw = this.config.get(CONFIG.weekStart);
		const n =
			typeof raw === "number"
				? raw
				: typeof raw === "string"
					? Number.parseInt(raw, 10)
					: NaN;
		return Number.isFinite(n) && n >= 0 && n <= 6 ? n : 1;
	}

	private render(): void {
		if (this.dragging) return;
		this.initStateFromConfig();

		this.dateProp = this.config.getAsPropertyId(CONFIG.dateProperty);
		if (!this.dateProp) {
			this.showEmpty(
				"Choose a date property in the view options (⚙︎) to plot notes on the calendar.",
			);
			return;
		}
		this.endProp = this.config.getAsPropertyId(CONFIG.endDateProperty);
		this.titleProp = this.config.getAsPropertyId(CONFIG.titleProperty);
		this.weekStart = this.readWeekStart();

		const events = buildEvents({
			app: this.app,
			entries: this.data?.data ?? [],
			dateProp: this.dateProp,
			endProp: this.endProp,
			titleProp: this.titleProp,
			yearlyRepeat: this.config.get(CONFIG.yearlyRepeat) === true,
			range: this.visibleRange(),
		});

		this.ensureRenderer();
		this.updateToolbar();

		const ctx: LayoutContext = {
			events,
			anchor: this.anchor,
			weekStart: this.weekStart,
			today: new Date(),
			callbacks: this.callbacks(),
		};
		try {
			this.renderer?.render(ctx);
		} catch (error) {
			console.error("obsilities-calendar: render failed", error);
		}
	}

	private showEmpty(message: string): void {
		this.renderer?.destroy();
		this.renderer = null;
		this.rendererLayout = null;
		this.bodyEl.empty();
		this.bodyEl.createDiv({
			cls: "obsilities-calendar-empty",
			text: message,
		});
		this.updateToolbar();
	}

	private ensureRenderer(): void {
		if (this.renderer && this.rendererLayout === this.layout) return;
		this.renderer?.destroy();
		this.bodyEl.empty();
		this.renderer = this.createRenderer(this.layout);
		this.rendererLayout = this.layout;
	}

	private createRenderer(layout: CalendarLayout): CalendarLayoutRenderer {
		switch (layout) {
			case "year":
				return new YearLayout(this.bodyEl);
			case "week":
				return new TimeGridLayout(this.bodyEl, "week");
			case "3days":
				return new TimeGridLayout(this.bodyEl, "3days");
			case "day":
				return new TimeGridLayout(this.bodyEl, "day");
			case "agenda":
				return new AgendaLayout(this.bodyEl);
			default:
				return new MonthLayout(this.bodyEl);
		}
	}

	private visibleRange(): { start: Date; end: Date } {
		switch (this.layout) {
			case "year":
				return {
					start: startOfYear(this.anchor),
					end: endOfYear(this.anchor),
				};
			case "week": {
				const start = startOfWeek(this.anchor, this.weekStart);
				return { start, end: endOfDay(addDays(start, 6)) };
			}
			case "3days": {
				const start = startOfDay(this.anchor);
				return { start, end: endOfDay(addDays(start, 2)) };
			}
			case "day":
				return {
					start: startOfDay(this.anchor),
					end: endOfDay(this.anchor),
				};
			case "agenda":
				return {
					start: startOfDay(this.anchor),
					end: endOfMonth(this.anchor),
				};
			default: {
				const days = monthFixedLeading(this.anchor, 2);
				const first = days[0] ?? startOfMonth(this.anchor);
				const last = days[days.length - 1] ?? first;
				return { start: startOfDay(first), end: endOfDay(last) };
			}
		}
	}

	private callbacks(): CalendarCallbacks {
		return {
			open: (path, newTab) => {
				void this.app.workspace.openLinkText(path, "", newTab);
			},
			openBackground: (path) => this.openInBackground(path),
			reschedule: (event, start, allDay) => {
				void this.reschedule(event, start, allDay);
			},
			resize: (event, start, end) => {
				void this.resize(event, start, end);
			},
			create: (day) => {
				void this.create(day);
			},
			viewDay: (day) => {
				this.layout = "day";
				this.anchor = startOfDay(day);
				this.render();
			},
			viewMonth: (day) => {
				this.layout = "month";
				this.anchor = startOfMonth(day);
				this.render();
			},
			setDragging: (active) => {
				this.dragging = active;
			},
		};
	}

	private fileForPath(path: string): TFile | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	private openInBackground(path: string): void {
		const file = this.fileForPath(path);
		if (!file) return;
		const previous = this.app.workspace.getMostRecentLeaf();
		const leaf = this.app.workspace.getLeaf("tab");
		void leaf.openFile(file, { active: false });
		if (previous && previous !== leaf) {
			this.app.workspace.setActiveLeaf(previous, { focus: false });
		}
	}

	private async reschedule(
		event: CalendarEvent,
		start: Date,
		allDay: boolean,
	): Promise<void> {
		if (!this.dateProp || !isWritableProperty(this.dateProp)) return;
		const file = this.fileForPath(event.path);
		if (!file) return;

		const writes: DateWrite[] = [
			{ propId: this.dateProp, date: start, allDay },
		];
		if (this.endProp && isWritableProperty(this.endProp) && event.end) {
			const delta = start.getTime() - event.start.getTime();
			writes.push({
				propId: this.endProp,
				date: new Date(event.end.getTime() + delta),
				allDay,
			});
		}

		try {
			await writeDates(this.app, file, writes);
		} catch (error) {
			console.error("obsilities-calendar: reschedule failed", error);
			this.render();
		}
	}

	private async resize(
		event: CalendarEvent,
		start: Date,
		end: Date,
	): Promise<void> {
		const file = this.fileForPath(event.path);
		if (!file) return;

		const writes: DateWrite[] = [];
		if (this.dateProp && isWritableProperty(this.dateProp)) {
			writes.push({ propId: this.dateProp, date: start, allDay: false });
		}
		if (this.endProp && isWritableProperty(this.endProp)) {
			writes.push({ propId: this.endProp, date: end, allDay: false });
		}
		if (writes.length === 0) {
			this.render();
			return;
		}

		try {
			await writeDates(this.app, file, writes);
		} catch (error) {
			console.error("obsilities-calendar: resize failed", error);
			this.render();
		}
	}

	private async create(day: Date): Promise<void> {
		if (!this.dateProp || !isWritableProperty(this.dateProp)) return;
		try {
			await this.createFileForView(
				undefined,
				dateFrontmatterSetter(this.dateProp, day),
			);
		} catch (error) {
			console.error("obsilities-calendar: create failed", error);
		}
	}

	static getViewOptions(this: void): BasesOptions[] {
		const dateFilter = (prop: BasesPropertyId): boolean =>
			prop.startsWith("note.") || prop.startsWith("file.");
		return [
			{
				displayName: "Date property",
				type: "property",
				key: CONFIG.dateProperty,
				placeholder: "Select a date property",
				filter: dateFilter,
			},
			{
				displayName: "End date property",
				type: "property",
				key: CONFIG.endDateProperty,
				placeholder: "Optional — spans / timed events",
				filter: dateFilter,
			},
			{
				displayName: "Event title",
				type: "property",
				key: CONFIG.titleProperty,
				placeholder: "Default: file name",
			},
			{
				displayName: "Repeat yearly",
				type: "toggle",
				key: CONFIG.yearlyRepeat,
				default: false,
			},
			{
				displayName: "Default layout",
				type: "dropdown",
				key: CONFIG.defaultLayout,
				default: "month",
				options: {
					month: "Month",
					week: "Week",
					day: "Day",
					agenda: "Agenda",
				},
			},
			{
				displayName: "Week starts on",
				type: "dropdown",
				key: CONFIG.weekStart,
				default: "1",
				options: { "1": "Monday", "0": "Sunday" },
			},
		];
	}
}
