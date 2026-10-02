import { BasesView, TFile, debounce, setIcon } from "obsidian";
import type {
	BasesAllOptions,
	BasesOptions,
	BasesPropertyId,
	BasesViewConfig,
	QueryController,
} from "obsidian";
import {
	addDays,
	addMinutes,
	addMonths,
	addYears,
	endOfMonth,
	monthGrid,
	startOfNextDay,
	formatMonthSpan,
	formatMonthTitle,
	formatWeekTitle,
	sameDay,
	startOfDay,
	startOfMonth,
	startOfWeek,
	weekSuffix,
} from "./dates";
import { buildEvents } from "./events";
import { AgendaLayout } from "./layouts/agenda";
import { MonthLayout } from "./layouts/month";
import { allDayDropEnd } from "./layouts/shared";
import { TimeGridLayout } from "./layouts/timegrid";
import { YearLayout } from "./layouts/year";
import {
	CALENDAR_LAYOUTS,
	CALENDAR_VIEW_TYPE,
	CONFIG,
	LAYOUT_LABELS,
	LAYOUT_LADDER,
	datePropertyKey,
} from "./types";
import type {
	CalendarCallbacks,
	CalendarEvent,
	CalendarLayout,
	CalendarLayoutRenderer,
	DateSource,
	LayoutContext,
} from "./types";
import { dateFrontmatterSetter, isWritableProperty, writeDates } from "./writes";
import type { DateWrite } from "./writes";

const EMPTY_SLOT_RUN = 10;

const ACCENT_COLOR = "accent";
const NOW_COLORS: Record<string, string> = {
	[ACCENT_COLOR]: "var(--interactive-accent)",
	red: "var(--color-red)",
	orange: "var(--color-orange)",
	yellow: "var(--color-yellow)",
	green: "var(--color-green)",
	cyan: "var(--color-cyan)",
	blue: "var(--color-blue)",
	purple: "var(--color-purple)",
	pink: "var(--color-pink)",
};
const NOW_COLOR_LABELS: Record<string, string> = Object.fromEntries(
	Object.keys(NOW_COLORS).map((name) => [
		name,
		name === ACCENT_COLOR
			? "Obsidian accent"
			: name.charAt(0).toUpperCase() + name.slice(1),
	]),
);

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
	private defaultDurationMinutes = 60;
	private stateInitialized = false;

	private renderer: CalendarLayoutRenderer | null = null;
	private rendererLayout: CalendarLayout | null = null;
	private dragging = false;
	private renderPending = false;
	private focusEventId: string | null = null;

	private titleProp: BasesPropertyId | null = null;
	private dateSources: DateSource[] = [];
	private primaryProp: BasesPropertyId | null = null;
	private endProp: BasesPropertyId | null = null;
	private recurrenceProp: BasesPropertyId | null = null;

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
		this.prevBtn?.setAttribute("aria-disabled", prevDisabled ? "true" : "false");
		for (const [layout, btn] of this.layoutButtons) {
			btn.toggleClass("is-active", layout === this.layout);
		}
	}

	// Agenda is forward-only, never page earlier than the current month
	private isPrevDisabled(): boolean {
		if (this.layout !== "agenda") return false;
		return startOfMonth(this.anchor).getTime() <= startOfMonth(new Date()).getTime();
	}

	private renderTitle(): void {
		const el = this.toolbarTitleEl;
		if (!el) return;
		el.empty();
		const months = this.titleMonths();
		for (const part of this.titleText().split(/(\d{4}|\(W\d+(?:-W\d+)?\))/)) {
			if (!part) continue;
			if (/^\d{4}$/.test(part)) {
				this.appendYearPart(el, part);
			} else if (part.startsWith("(W")) {
				this.appendWeekPart(el, part);
			} else {
				this.appendMonthPart(el, part, months);
			}
		}
	}

	private titleMonths(): Date[] {
		if (this.layout === "year") return [];
		const [start, end] = this.titleSpan();
		const first = startOfMonth(start);
		const last = startOfMonth(end);
		return first.getTime() === last.getTime() ? [first] : [first, last];
	}

	private titleSpan(): [Date, Date] {
		if (this.isDaySpanLayout()) return this.daySpan();
		if (this.layout === "week") {
			const start = startOfWeek(this.anchor, this.weekStart);
			return [start, addDays(start, 6)];
		}
		return [this.anchor, this.anchor];
	}

	private appendMonthPart(el: HTMLElement, part: string, months: Date[]): void {
		part.split(" - ").forEach((chunk, index) => {
			if (index > 0) el.appendText(" - ");
			const label = chunk.trim();
			if (!label) {
				el.appendText(chunk);
				return;
			}
			const offset = chunk.indexOf(label);
			if (offset > 0) el.appendText(chunk.slice(0, offset));
			this.appendMonthLabel(el, label, months.shift());
			el.appendText(chunk.slice(offset + label.length));
		});
	}

	private appendMonthLabel(el: HTMLElement, label: string, month?: Date): void {
		const span = el.createSpan({
			cls: "obsilities-calendar-title-month",
			text: label,
		});
		if (this.layout === "month") {
			span.toggleClass("is-current", this.showsToday(new Date()));
			return;
		}
		if (!month) return;
		span.addClass("is-clickable");
		span.setAttribute("aria-label", "Show this month");
		span.addEventListener("click", (e) => {
			e.stopPropagation();
			this.goToMonth(month);
		});
	}

	private appendYearPart(el: HTMLElement, part: string): void {
		const span = el.createSpan({
			cls: "obsilities-calendar-title-year",
			text: part,
		});
		if (this.layout === "year") {
			span.toggleClass("is-current", this.showsToday(new Date()));
			return;
		}
		span.addClass("is-clickable");
		span.setAttribute("aria-label", "Show this year");
		const year = Number(part);
		span.addEventListener("click", (e) => {
			e.stopPropagation();
			this.goToYear(year);
		});
	}

	private appendWeekPart(el: HTMLElement, part: string): void {
		const targets = this.isDaySpanLayout() ? this.daySpan() : [];
		el.appendText("(W");
		part.slice(2, -1)
			.split("-W")
			.forEach((number, index) => {
				if (index > 0) el.appendText("-W");
				const target = targets[index];
				if (!target) {
					if (this.layout === "week" && this.showsToday(new Date())) {
						el.createSpan({
							cls: "obsilities-calendar-title-week is-current",
							text: number,
						});
					} else {
						el.appendText(number);
					}
					return;
				}
				const span = el.createSpan({
					cls: "obsilities-calendar-title-week is-clickable",
					text: number,
				});
				span.setAttribute("aria-label", "Show this week");
				span.addEventListener("click", (e) => {
					e.stopPropagation();
					this.goToWeek(target);
				});
			});
		el.appendText(")");
	}

	private goToWeek(date: Date): void {
		this.layout = "week";
		this.anchor = startOfDay(date);
		this.render();
	}

	private goToMonth(date: Date): void {
		this.layout = "month";
		this.anchor = startOfMonth(date);
		this.render();
	}

	private goToYear(year: number): void {
		this.layout = "year";
		this.anchor = new Date(year, this.anchor.getMonth(), 1);
		this.render();
	}

	private titleText(): string {
		if (this.isDaySpanLayout()) {
			const [start, end] = this.daySpan();
			return `${formatMonthSpan(start, end)} ${weekSuffix(start, end)}`;
		}
		switch (this.layout) {
			case "year":
				return String(this.anchor.getFullYear());
			case "week":
				return formatWeekTitle(this.anchor, this.weekStart);
			default:
				return formatMonthTitle(this.anchor);
		}
	}

	private isDaySpanLayout(): boolean {
		return this.layout === "day" || this.layout === "3days";
	}

	private daySpan(): [Date, Date] {
		const start = startOfDay(this.anchor);
		return [start, this.layout === "3days" ? addDays(start, 2) : start];
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
		const today = startOfDay(new Date());
		if (this.showsToday(today)) {
			const next = this.nextLayout();
			if (!next) return;
			this.layout = next;
		}
		this.anchor = today;
		this.render();
	}

	private showsToday(today: Date): boolean {
		switch (this.layout) {
			case "year":
				return this.anchor.getFullYear() === today.getFullYear();
			case "month":
			case "agenda":
				return (
					startOfMonth(this.anchor).getTime() === startOfMonth(today).getTime()
				);
			case "week":
				return (
					startOfWeek(this.anchor, this.weekStart).getTime() ===
					startOfWeek(today, this.weekStart).getTime()
				);
			default:
				return sameDay(this.anchor, today);
		}
	}

	private nextLayout(): CalendarLayout | null {
		const rung = LAYOUT_LADDER.indexOf(this.layout);
		if (rung < 0) return null;
		return LAYOUT_LADDER[rung + 1] ?? null;
	}

	private setLayout(layout: CalendarLayout): void {
		if (layout === this.layout) return;
		this.layout = layout;
		this.render();
	}

	private initStateFromConfig(): void {
		if (this.stateInitialized) return;
		this.stateInitialized = true;

		this.layout = this.coerceLayout(this.config.get(CONFIG.defaultLayout)) ?? "month";
	}

	private applyNowColor(): void {
		const raw = this.config.get(CONFIG.nowColor);
		this.containerEl.style.setProperty(
			"--obsilities-cal-now",
			(typeof raw === "string" ? NOW_COLORS[raw] : null) ??
				"var(--interactive-accent)",
		);
	}

	private coerceLayout(value: unknown): CalendarLayout | null {
		return typeof value === "string" && (CALENDAR_LAYOUTS as string[]).includes(value)
			? (value as CalendarLayout)
			: null;
	}

	private readNumberConfig(
		key: string,
		fallback: number,
		min: number,
		max: number,
	): number {
		const raw = this.config.get(key);
		const n =
			typeof raw === "number"
				? raw
				: typeof raw === "string"
					? Number.parseInt(raw, 10)
					: NaN;
		return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
	}

	private render(): void {
		if (this.dragging) {
			this.renderPending = true;
			return;
		}
		this.renderPending = false;
		this.initStateFromConfig();
		this.applyNowColor();

		this.titleProp = this.config.getAsPropertyId(CONFIG.titleProperty);
		this.primaryProp = this.config.getAsPropertyId(datePropertyKey(0));
		this.endProp = this.config.getAsPropertyId(CONFIG.endDateProperty);
		this.dateSources = readDateSources(this.config);
		if (this.dateSources.length === 0) {
			this.showEmpty("Choose a date property in the view options (⚙︎).");
			return;
		}
		this.recurrenceProp = this.config.getAsPropertyId(CONFIG.recurrenceProperty);
		this.weekStart = this.readNumberConfig(CONFIG.weekStart, 1, 0, 6);
		this.defaultDurationMinutes = this.readNumberConfig(
			CONFIG.defaultDuration,
			60,
			1,
			Number.MAX_SAFE_INTEGER,
		);

		const [from, to] = this.visibleRange();
		const events = buildEvents({
			app: this.app,
			entries: this.data?.data ?? [],
			titleProp: this.titleProp,
			dateSources: this.dateSources,
			recurrenceProp: this.recurrenceProp,
			from,
			to,
		});

		this.ensureRenderer();
		this.updateToolbar();

		const ctx: LayoutContext = {
			events,
			anchor: this.anchor,
			weekStart: this.weekStart,
			defaultDurationMinutes: this.defaultDurationMinutes,
			today: new Date(),
			editable: this.canEdit(),
			creatable: this.canCreate(),
			focusEventId: this.focusEventId,
			callbacks: this.callbacks(),
		};
		try {
			this.renderer?.render(ctx);
		} catch (error) {
			console.error("obsilities-calendar: render failed", error);
		}
		this.focusEventId = null;
	}

	private visibleRange(): [Date, Date] {
		const endOf = (day: Date): Date => new Date(startOfNextDay(day).getTime() - 1);

		switch (this.layout) {
			case "year": {
				const year = this.anchor.getFullYear();
				return [new Date(year, 0, 1), endOf(new Date(year, 11, 31))];
			}
			case "month": {
				const days = monthGrid(this.anchor, this.weekStart);
				const first = days[0] ?? startOfMonth(this.anchor);
				const last = days[days.length - 1] ?? endOfMonth(this.anchor);
				return [startOfDay(first), endOf(last)];
			}
			case "week": {
				const start = startOfWeek(this.anchor, this.weekStart);
				return [start, endOf(addDays(start, 6))];
			}
			case "3days": {
				const start = startOfDay(this.anchor);
				return [start, endOf(addDays(start, 2))];
			}
			case "agenda": {
				const start = new Date(
					Math.max(
						startOfDay(this.anchor).getTime(),
						startOfDay(new Date()).getTime(),
					),
				);
				return [start, endOfMonth(this.anchor)];
			}
			default: {
				const start = startOfDay(this.anchor);
				return [start, endOf(start)];
			}
		}
	}

	private canEdit(): boolean {
		return this.dateSources.some((source) => isWritableProperty(source.propId));
	}

	private canCreate(): boolean {
		return this.primaryProp !== null && isWritableProperty(this.primaryProp);
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

	private callbacks(): CalendarCallbacks {
		return {
			open: (path, newTab) => {
				void this.app.workspace.openLinkText(path, "", newTab);
			},
			openBackground: (path) => {
				const file = this.fileForPath(path);
				if (!file) return;
				const previous = this.app.workspace.getMostRecentLeaf();
				const leaf = this.app.workspace.getLeaf("tab");
				void leaf.openFile(file, { active: false });
				if (previous && previous !== leaf) {
					this.app.workspace.setActiveLeaf(previous, { focus: false });
				}
			},
			reschedule: (event, start, allDay) => {
				void this.reschedule(event, start, allDay);
			},
			resize: (event, start, end) => {
				void this.resize(event, start, end);
			},
			create: (day) => {
				void this.create(day);
			},
			viewDay: (day, focusEventId) => {
				this.layout = "day";
				this.anchor = startOfDay(day);
				this.focusEventId = focusEventId ?? null;
				this.render();
			},
			viewMonth: (day) => {
				this.layout = "month";
				this.anchor = startOfMonth(day);
				this.render();
			},
			setDragging: (active) => {
				this.dragging = active;
				if (!active && this.renderPending) this.rerender();
			},
		};
	}

	private fileForPath(path: string): TFile | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	private async reschedule(
		event: CalendarEvent,
		start: Date,
		allDay: boolean,
	): Promise<void> {
		if (!event.editable) return;
		if (!isWritableProperty(event.source)) return;
		const file = this.fileForPath(event.path);
		if (!file) return;

		const snap = (date: Date): Date => (allDay ? startOfDay(date) : date);

		const writes: DateWrite[] = [{ propId: event.source, date: snap(start) }];
		if (event.endSource && isWritableProperty(event.endSource)) {
			const end = this.rescheduledEnd(event, start, allDay);
			if (end) {
				writes.push({ propId: event.endSource, date: snap(end) });
			}
		}

		try {
			await writeDates(this.app, file, writes);
		} catch (error) {
			console.error("obsilities-calendar: reschedule failed", error);
			this.render();
		}
	}

	private rescheduledEnd(
		event: CalendarEvent,
		start: Date,
		allDay: boolean,
	): Date | null {
		if (!allDay && event.allDay) {
			return allDayDropEnd(event, start, this.defaultDurationMinutes);
		}
		if (!allDay && !event.end) {
			return addMinutes(start, this.defaultDurationMinutes);
		}
		if (event.rawEnd) {
			const delta = start.getTime() - event.start.getTime();
			return new Date(event.rawEnd.getTime() + delta);
		}
		return null;
	}

	private async resize(event: CalendarEvent, start: Date, end: Date): Promise<void> {
		if (!event.editable) return;
		const file = this.fileForPath(event.path);
		if (!file) return;

		const writes: DateWrite[] = [];
		if (isWritableProperty(event.source)) {
			writes.push({ propId: event.source, date: start });
		}
		if (event.endSource && isWritableProperty(event.endSource)) {
			writes.push({ propId: event.endSource, date: end });
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
		const primary = this.primaryProp;
		if (!primary || !isWritableProperty(primary)) return;
		const start = startOfDay(day);
		const writes: DateWrite[] = [{ propId: primary, date: start }];
		if (this.endProp && isWritableProperty(this.endProp)) {
			writes.push({ propId: this.endProp, date: start });
		}
		try {
			await this.createFileForView(undefined, dateFrontmatterSetter(writes));
		} catch (error) {
			console.error("obsilities-calendar: create failed", error);
		}
	}

	static getViewOptions(this: void, config: BasesViewConfig): BasesAllOptions[] {
		const dateFilter = (prop: BasesPropertyId): boolean =>
			prop.startsWith("note.") || prop.startsWith("file.");

		const dateSlots: BasesOptions[] = [];
		const configured = scanDateSlots(config).length;
		for (let slot = 0; slot <= configured; slot++) {
			dateSlots.push({
				displayName: slot === 0 ? "Start date property" : `Date property ${slot}`,
				type: "property",
				key: datePropertyKey(slot),
				placeholder: "Select a date&time property",
				filter: dateFilter,
			});
			if (slot === 0) {
				dateSlots.push({
					displayName: "End date property",
					type: "property",
					key: CONFIG.endDateProperty,
					placeholder: "Select a date&time property",
					filter: dateFilter,
				});
			}
		}

		return [
			{
				displayName: "Event title",
				type: "property",
				key: CONFIG.titleProperty,
				placeholder: "Default: file name",
			},
			...dateSlots,
			{
				displayName: "Recurrency property",
				type: "property",
				key: CONFIG.recurrenceProperty,
				placeholder: "Optional: daily, weekly, yearly…",
			},
			{
				displayName: "First day of the week",
				type: "dropdown",
				key: CONFIG.weekStart,
				default: "1",
				options: { "1": "Monday", "0": "Sunday" },
			},
			{
				displayName: "Default view",
				type: "dropdown",
				key: CONFIG.defaultLayout,
				default: "month",
				options: LAYOUT_LABELS,
			},
			{
				displayName: "Default event duration",
				type: "dropdown",
				key: CONFIG.defaultDuration,
				default: "60",
				options: {
					"15": "15 minutes",
					"30": "30 minutes",
					"45": "45 minutes",
					"60": "1 hour",
					"90": "1.5 hours",
					"120": "2 hours",
				},
			},
			{
				displayName: "Today highlight color",
				type: "dropdown",
				key: CONFIG.nowColor,
				default: ACCENT_COLOR,
				options: NOW_COLOR_LABELS,
			},
		];
	}
}

function scanDateSlots(config: BasesViewConfig): (BasesPropertyId | null)[] {
	const slots: (BasesPropertyId | null)[] = [];
	let empties = 0;
	for (let slot = 0; empties < EMPTY_SLOT_RUN; slot++) {
		const prop = config.getAsPropertyId(datePropertyKey(slot));
		empties = prop ? 0 : empties + 1;
		slots.push(prop);
	}
	while (slots.length > 0 && !slots[slots.length - 1]) slots.pop();
	return slots;
}

function readDateSources(config: BasesViewConfig): DateSource[] {
	const endPropId = config.getAsPropertyId(CONFIG.endDateProperty);
	const sources: DateSource[] = [];
	const seen: BasesPropertyId[] = [];
	scanDateSlots(config).forEach((propId, slot) => {
		if (!propId || seen.includes(propId)) return;
		seen.push(propId);
		sources.push({ propId, endPropId: slot === 0 ? endPropId : null });
	});
	return sources;
}
