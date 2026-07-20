import { parsePropertyId } from "obsidian";
import type { App, BasesPropertyId, TFile } from "obsidian";
import { toLocalISODate, toLocalISODateTime } from "./dates";

export function isWritableProperty(propId: BasesPropertyId): boolean {
	return propId.startsWith("note.");
}

function serialize(date: Date, allDay: boolean): string {
	return allDay ? toLocalISODate(date) : toLocalISODateTime(date);
}

export interface DateWrite {
	propId: BasesPropertyId;
	date: Date;
	allDay: boolean;
}

export async function writeDates(
	app: App,
	file: TFile,
	writes: DateWrite[],
): Promise<void> {
	const writable = writes.filter((w) => isWritableProperty(w.propId));
	if (writable.length === 0) return;
	await app.fileManager.processFrontMatter(
		file,
		(frontmatter: Record<string, unknown>) => {
			for (const w of writable) {
				frontmatter[parsePropertyId(w.propId).name] = serialize(
					w.date,
					w.allDay,
				);
			}
		},
	);
}

export async function writeDate(
	app: App,
	file: TFile,
	propId: BasesPropertyId,
	date: Date,
	allDay: boolean,
): Promise<void> {
	await writeDates(app, file, [{ propId, date, allDay }]);
}

export function dateFrontmatterSetter(
	propId: BasesPropertyId,
	day: Date,
): (frontmatter: Record<string, unknown>) => void {
	const name = parsePropertyId(propId).name;
	const value = toLocalISODate(day);
	return (frontmatter) => {
		frontmatter[name] = value;
	};
}
