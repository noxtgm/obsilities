export const CALENDAR_VIEW_TYPE = "obsilities-calendar";

export type CalendarLayout =
	"year" | "month" | "week" | "3days" | "day" | "agenda";

export const CALENDAR_LAYOUTS: CalendarLayout[] = [
	"year",
	"month",
	"week",
	"3days",
	"day",
	"agenda",
];

export const LAYOUT_LABELS: Record<CalendarLayout, string> = {
	year: "Year",
	month: "Month",
	week: "Week",
	"3days": "3 Days",
	day: "Day",
	agenda: "Agenda",
};

export const CONFIG = {
	dateProperty: "dateProperty",
	endDateProperty: "endDateProperty",
	titleProperty: "titleProperty",
	yearlyRepeat: "yearlyRepeat",
	defaultLayout: "defaultLayout",
	weekStart: "weekStart",
	defaultDuration: "defaultDuration",
} as const;

export interface CalendarEvent {
	id: string;
	path: string;
	title: string;
	start: Date;
	end: Date | null;
	allDay: boolean;
}

export interface CalendarCallbacks {
	open: (path: string, newTab: boolean) => void;
	openBackground: (path: string) => void;
	reschedule: (event: CalendarEvent, start: Date, allDay: boolean) => void;
	resize: (event: CalendarEvent, start: Date, end: Date) => void;
	create: (day: Date) => void;
	viewDay: (day: Date) => void;
	viewMonth: (day: Date) => void;
	setDragging: (active: boolean) => void;
}

export interface LayoutContext {
	events: CalendarEvent[];
	anchor: Date;
	weekStart: number;
	today: Date;
	callbacks: CalendarCallbacks;
}

export interface CalendarLayoutRenderer {
	render(ctx: LayoutContext): void;
	destroy(): void;
}
