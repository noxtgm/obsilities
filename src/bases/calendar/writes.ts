import { parsePropertyId } from "obsidian";
import type { App, BasesPropertyId, TFile } from "obsidian";
import { toLocalISODateTime } from "./dates";

export function isWritableProperty(propId: BasesPropertyId): boolean {
	return propId.startsWith("note.");
}

export interface DateWrite {
	propId: BasesPropertyId;
	date: Date;
}

export function dateFrontmatterSetter(
	writes: DateWrite[],
): (frontmatter: Record<string, unknown>) => void {
	return (frontmatter) => {
		for (const w of writes) {
			frontmatter[parsePropertyId(w.propId).name] = toLocalISODateTime(w.date);
		}
	};
}

export async function writeDates(
	app: App,
	file: TFile,
	writes: DateWrite[],
): Promise<void> {
	if (writes.length === 0) return;
	await app.fileManager.processFrontMatter(file, dateFrontmatterSetter(writes));
}
