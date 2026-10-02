import type { BasesPropertyId } from "obsidian";

export const CALENDAR_VIEW_TYPE = "obsilities-calendar";

export type CalendarLayout = "year" | "month" | "week" | "3days" | "day" | "agenda";

export const LAYOUT_LABELS: Record<CalendarLayout, string> = {
	year: "Year",
	month: "Month",
	week: "Week",
	"3days": "3 Days",
	day: "Day",
	agenda: "Agenda",
};

export const CALENDAR_LAYOUTS = Object.keys(LAYOUT_LABELS) as CalendarLayout[];

export const LAYOUT_LADDER: CalendarLayout[] = ["day", "3days", "week", "month", "year"];

export const CONFIG = {
	titleProperty: "titleProperty",
	dateProperty: "dateProperty",
	endDateProperty: "endDateProperty",
	weekStart: "weekStart",
	defaultLayout: "defaultLayout",
	defaultDuration: "defaultDuration",
	nowColor: "nowColor",
	recurrenceProperty: "recurrenceProperty",
} as const;

export function datePropertyKey(slot: number): string {
	return slot === 0 ? CONFIG.dateProperty : `${CONFIG.dateProperty}${slot + 1}`;
}

export interface DateSource {
	propId: BasesPropertyId;
	endPropId: BasesPropertyId | null;
}

export interface CalendarEvent {
	id: string;
	path: string;
	title: string;
	start: Date;
	end: Date | null;
	rawEnd: Date | null;
	allDay: boolean;
	source: BasesPropertyId;
	endSource: BasesPropertyId | null;
	recurring: boolean;
	editable: boolean;
}

export interface CalendarCallbacks {
	open: (path: string, newTab: boolean) => void;
	openBackground: (path: string) => void;
	reschedule: (event: CalendarEvent, start: Date, allDay: boolean) => void;
	resize: (event: CalendarEvent, start: Date, end: Date) => void;
	create: (day: Date) => void;
	viewDay: (day: Date, focusEventId?: string) => void;
	viewMonth: (day: Date) => void;
	setDragging: (active: boolean) => void;
}

export interface LayoutContext {
	events: CalendarEvent[];
	anchor: Date;
	weekStart: number;
	defaultDurationMinutes: number;
	today: Date;
	editable: boolean;
	creatable: boolean;
	focusEventId: string | null;
	callbacks: CalendarCallbacks;
}

export interface CalendarLayoutRenderer {
	render(ctx: LayoutContext): void;
	destroy(): void;
}
