import {
	BasesView,
	Keymap,
	NullValue,
	debounce,
	parsePropertyId,
	setIcon,
} from "obsidian";
import type {
	BasesEntry,
	BasesOptions,
	BasesPropertyId,
	QueryController,
	TFile,
	Value,
} from "obsidian";

export const KANBAN_VIEW_TYPE = "obsilities-kanban";
const COLOR_PALETTE: { name: string; cssVar: string }[] = [
	{ name: "red", cssVar: "var(--color-red)" },
	{ name: "orange", cssVar: "var(--color-orange)" },
	{ name: "yellow", cssVar: "var(--color-yellow)" },
	{ name: "green", cssVar: "var(--color-green)" },
	{ name: "cyan", cssVar: "var(--color-cyan)" },
	{ name: "blue", cssVar: "var(--color-blue)" },
	{ name: "purple", cssVar: "var(--color-purple)" },
	{ name: "pink", cssVar: "var(--color-pink)" },
];

const cssVarForColor = (name: string | null): string | null =>
	COLOR_PALETTE.find((c) => c.name === name)?.cssVar ?? null;

function groupKeyFor(value: Value | null): string | null {
	if (value === null || value instanceof NullValue) return null;
	const str = value.toString().trim();
	return str === "" ? null : str;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isColumnOrders(value: unknown): value is Record<string, string[]> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every(isStringArray)
	);
}

function isColumnColors(
	value: unknown,
): value is Record<string, Record<string, string>> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every(
			(v) =>
				typeof v === "object" &&
				v !== null &&
				Object.values(v).every((c) => typeof c === "string"),
		)
	);
}

export class KanbanView extends BasesView {
	type = KANBAN_VIEW_TYPE;

	private scrollEl: HTMLElement;
	private prevScrollPosition = "";
	containerEl: HTMLElement;
	private boardEl: HTMLElement | null = null;

	private groupByProp: BasesPropertyId | null = null;
	private titleProp: BasesPropertyId | null = null;

	private entryByPath: Map<string, BasesEntry> = new Map();

	private cardFingerprints: Map<string, string> = new Map();
	private lastConfigSig = "";

	private prefsProp: BasesPropertyId | null = null;
	private columnOrder: string[] = [];
	private columnColors: Record<string, string> = {};

	private dragKind: "card" | "column" | null = null;
	private draggedCardEl: HTMLElement | null = null;
	private draggedCardPath: string | null = null;
	private draggedCardFromValue: string | null = null;
	private draggedColumnEl: HTMLElement | null = null;
	private armedColumn: HTMLElement | null = null;
	private columnDragX = 0;
	private columnDragRaf: number | null = null;

	private colorPopover: HTMLElement | null = null;
	private colorPopoverDismiss: ((e: MouseEvent) => void) | null = null;

	private readonly rerender = debounce(() => this.render(), 50, true);

	constructor(controller: QueryController, scrollEl: HTMLElement) {
		super(controller);
		this.scrollEl = scrollEl;
		this.prevScrollPosition = scrollEl.style.position;
		scrollEl.style.position = "relative";
		this.containerEl = scrollEl.createDiv({ cls: "obsilities-kanban" });
		this.containerEl.doc.addEventListener("mouseup", this.disarmColumn);
	}

	onDataUpdated(): void {
		this.rerender();
	}

	private readonly disarmColumn = (): void => {
		if (this.armedColumn) {
			this.armedColumn.setAttribute("draggable", "false");
			this.armedColumn = null;
		}
	};

	onunload(): void {
		this.containerEl.doc.removeEventListener("mouseup", this.disarmColumn);
		this.rerender.cancel();
		if (this.columnDragRaf !== null) {
			window.cancelAnimationFrame(this.columnDragRaf);
			this.columnDragRaf = null;
		}
		this.closeColorPopover();
		this.containerEl.remove();
		this.cardFingerprints.clear();
		this.entryByPath.clear();
		this.scrollEl.style.position = this.prevScrollPosition;
	}

	private loadPrefs(propertyId: BasesPropertyId): void {
		this.prefsProp = propertyId;

		const rawOrders = this.config.get("columnOrders");
		const allOrders = isColumnOrders(rawOrders) ? rawOrders : {};
		this.columnOrder = allOrders[propertyId]
			? [...allOrders[propertyId]]
			: [];

		const rawColors = this.config.get("columnColors");
		const allColors = isColumnColors(rawColors) ? rawColors : {};
		this.columnColors = allColors[propertyId]
			? { ...allColors[propertyId] }
			: {};
	}

	private persistColumnOrder(): void {
		if (!this.prefsProp) return;
		const raw = this.config.get("columnOrders");
		const all = isColumnOrders(raw) ? raw : {};
		this.config.set("columnOrders", {
			...all,
			[this.prefsProp]: this.columnOrder,
		});
	}

	private persistColumnColors(): void {
		if (!this.prefsProp) return;
		const raw = this.config.get("columnColors");
		const all = isColumnColors(raw) ? raw : {};
		this.config.set("columnColors", {
			...all,
			[this.prefsProp]: this.columnColors,
		});
	}

	private render(): void {
		try {
			this.renderBoard();
		} catch (error) {
			console.error("obsilities-kanban: render failed", error);
		}
	}

	private renderBoard(): void {
		if (this.dragKind) return;

		this.groupByProp = this.config.getAsPropertyId("groupByProperty");
		this.titleProp = this.config.getAsPropertyId("cardTitleProperty");

		if (!this.groupByProp) {
			this.showEmpty(
				"Choose a property to group by in the view options (⚙︎) to build the board.",
			);
			return;
		}

		if (this.groupByProp !== this.prefsProp) {
			this.loadPrefs(this.groupByProp);
		}

		const entries = this.data?.data ?? [];
		this.entryByPath = new Map(entries.map((e) => [e.file.path, e]));

		const grouped = this.groupEntries(entries, this.groupByProp);
		this.reconcileColumnOrder([...grouped.keys()]);
		const orderedValues = this.orderedColumnValues([...grouped.keys()]);

		if (orderedValues.length === 0) {
			this.showEmpty("No notes match this base yet.");
			return;
		}

		const order = this.config.getOrder?.() ?? [];
		const configSig = JSON.stringify([
			this.groupByProp,
			this.titleProp,
			order,
		]);
		const configChanged = configSig !== this.lastConfigSig;
		this.lastConfigSig = configSig;

		const existingBoard = this.boardEl;
		const needsFresh =
			!existingBoard ||
			!this.containerEl.contains(existingBoard) ||
			configChanged;

		let board: HTMLElement;
		if (needsFresh) {
			this.closeColorPopover();
			this.containerEl.empty();
			this.cardFingerprints.clear();
			board = this.containerEl.createDiv({
				cls: "obsilities-kanban-board",
			});
			this.boardEl = board;
			this.registerColumnDropZone(board);
		} else {
			board = existingBoard as HTMLElement;
		}

		this.patchBoard(board, orderedValues, grouped);
	}

	private showEmpty(message: string): void {
		this.closeColorPopover();
		this.containerEl.empty();
		this.boardEl = null;
		this.cardFingerprints.clear();
		this.lastConfigSig = "";
		this.containerEl.createDiv({
			cls: "obsilities-kanban-empty",
			text: message,
		});
	}

	private groupEntries(
		entries: BasesEntry[],
		propertyId: BasesPropertyId,
	): Map<string, BasesEntry[]> {
		const grouped = new Map<string, BasesEntry[]>();
		for (const entry of entries) {
			let key: string | null = null;
			try {
				key = groupKeyFor(entry.getValue(propertyId));
			} catch (error) {
				console.warn(
					"obsilities-kanban: failed to read group value",
					entry.file.path,
					error,
				);
			}
			if (key === null) continue;
			const group = grouped.get(key);
			if (group) group.push(entry);
			else grouped.set(key, [entry]);
		}
		return grouped;
	}

	private reconcileColumnOrder(liveValues: string[]): void {
		const newValues = liveValues.filter(
			(v) => !this.columnOrder.includes(v),
		);
		if (newValues.length > 0) {
			this.columnOrder =
				this.columnOrder.length === 0
					? [...newValues].sort((a, b) => a.localeCompare(b))
					: [...this.columnOrder, ...newValues];
		}
	}

	private orderedColumnValues(liveValues: string[]): string[] {
		if (this.columnOrder.length === 0) {
			return [...liveValues].sort((a, b) => a.localeCompare(b));
		}
		const extra = liveValues.filter((v) => !this.columnOrder.includes(v));
		return [...this.columnOrder, ...extra];
	}

	private patchBoard(
		board: HTMLElement,
		orderedValues: string[],
		grouped: Map<string, BasesEntry[]>,
	): void {
		const existing = new Map<string, HTMLElement>();
		board
			.querySelectorAll<HTMLElement>(".obsilities-kanban-column")
			.forEach((col) => {
				const v = col.getAttribute("data-column-value");
				if (v !== null) existing.set(v, col);
			});

		const desired = new Set(orderedValues);
		existing.forEach((col, v) => {
			if (!desired.has(v)) {
				col.remove();
				existing.delete(v);
			}
		});

		for (const value of orderedValues) {
			const columnEntries = grouped.get(value) ?? [];
			const col = existing.get(value);
			if (!col) {
				const built = this.buildColumn(value, columnEntries);
				board.appendChild(built);
				existing.set(value, built);
			} else {
				this.patchColumn(col, value, columnEntries);
			}
		}

		for (const value of orderedValues) {
			const col = existing.get(value);
			if (col) board.appendChild(col);
		}
	}

	private patchColumn(
		column: HTMLElement,
		value: string,
		entries: BasesEntry[],
	): void {
		const countEl = column.querySelector(".obsilities-kanban-column-count");
		if (countEl) countEl.textContent = String(entries.length);
		this.syncColumnRemoveButton(column, value, entries.length);
		const body = column.querySelector<HTMLElement>(
			".obsilities-kanban-column-body",
		);
		if (body) this.patchCards(body, value, entries);
	}

	private patchCards(
		body: HTMLElement,
		columnValue: string,
		entries: BasesEntry[],
	): void {
		const existing = new Map<string, HTMLElement>();
		body.querySelectorAll<HTMLElement>(".obsilities-kanban-card").forEach(
			(card) => {
				const p = card.getAttribute("data-entry-path");
				if (p !== null) existing.set(p, card);
			},
		);

		const desired = new Set(entries.map((e) => e.file.path));
		existing.forEach((card, p) => {
			if (!desired.has(p)) {
				card.remove();
				existing.delete(p);
				this.cardFingerprints.delete(p);
			}
		});

		for (const entry of entries) {
			const path = entry.file.path;
			const card = existing.get(path);
			if (!card) {
				const built = this.buildCard(entry, columnValue);
				body.appendChild(built);
				existing.set(path, built);
			} else if (
				this.cardFingerprints.get(path) !== this.cardFingerprint(entry)
			) {
				const rebuilt = this.buildCard(entry, columnValue);
				card.replaceWith(rebuilt);
				existing.set(path, rebuilt);
			}
		}

		for (const entry of entries) {
			const card = existing.get(entry.file.path);
			if (card) body.appendChild(card);
		}
	}

	private buildColumn(value: string, entries: BasesEntry[]): HTMLElement {
		const column = createDiv({
			cls: "obsilities-kanban-column",
			attr: { "data-column-value": value },
		});
		this.applyColumnColor(column, this.columnColors[value] ?? null);

		const header = column.createDiv({
			cls: "obsilities-kanban-column-header",
		});

		const handle = header.createDiv({
			cls: "obsilities-kanban-drag-handle",
			attr: { "aria-label": "Drag to reorder column" },
		});
		setIcon(handle, "grip-vertical");

		const colorBtn = header.createDiv({
			cls: "obsilities-kanban-color-btn",
			attr: { "aria-label": "Set column color" },
		});
		colorBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.openColorPicker(colorBtn, column, value);
		});

		header.createDiv({
			cls: "obsilities-kanban-column-title",
			text: value,
		});
		header.createDiv({
			cls: "obsilities-kanban-column-count",
			text: String(entries.length),
		});

		this.syncColumnRemoveButton(column, value, entries.length);

		const body = column.createDiv({
			cls: "obsilities-kanban-column-body",
		});
		for (const entry of entries) {
			body.appendChild(this.buildCard(entry, value));
		}

		this.registerCardDropZone(body);
		this.registerColumnDragHandle(handle, column, value);

		return column;
	}

	private syncColumnRemoveButton(
		column: HTMLElement,
		value: string,
		count: number,
	): void {
		const header = column.querySelector<HTMLElement>(
			".obsilities-kanban-column-header",
		);
		if (!header) return;
		const existing = header.querySelector<HTMLElement>(
			".obsilities-kanban-column-remove",
		);
		if (count === 0 && !existing) {
			const removeBtn = header.createDiv({
				cls: "obsilities-kanban-column-remove",
				attr: { "aria-label": "Remove empty column" },
			});
			setIcon(removeBtn, "x");
			removeBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this.removeColumn(value);
			});
		} else if (count > 0 && existing) {
			existing.remove();
		}
	}

	private removeColumn(value: string): void {
		this.columnOrder = this.columnOrder.filter((v) => v !== value);
		this.persistColumnOrder();
		this.render();
	}

	private applyColumnColor(
		column: HTMLElement,
		colorName: string | null,
	): void {
		const cssVar = cssVarForColor(colorName);
		if (cssVar) {
			column.style.setProperty("--obsilities-kanban-accent", cssVar);
			column.setAttribute("data-column-color", colorName ?? "");
		} else {
			column.style.removeProperty("--obsilities-kanban-accent");
			column.removeAttribute("data-column-color");
		}
	}

	private buildCard(entry: BasesEntry, columnValue: string): HTMLElement {
		const card = createDiv({
			cls: "obsilities-kanban-card",
			attr: {
				"data-entry-path": entry.file.path,
				draggable: "true",
			},
		});

		card.createDiv({
			cls: "obsilities-kanban-card-title",
			text: this.cardTitle(entry),
		});

		const order = this.config.getOrder?.() ?? [];
		for (const propId of order) {
			if (propId === this.groupByProp || propId === this.titleProp) {
				continue;
			}
			const text = this.propertyText(entry, propId);
			if (!text) continue;

			const row = card.createDiv({
				cls: "obsilities-kanban-card-property",
			});
			row.createSpan({
				cls: "obsilities-kanban-card-property-label",
				text: this.config.getDisplayName(propId),
			});
			row.createSpan({
				cls: "obsilities-kanban-card-property-value",
				text,
			});
		}

		this.registerCardBehavior(card, entry.file.path, columnValue);
		this.cardFingerprints.set(entry.file.path, this.cardFingerprint(entry));
		return card;
	}

	private propertyText(entry: BasesEntry, propId: BasesPropertyId): string {
		let value: Value | null = null;
		try {
			value = entry.getValue(propId);
		} catch {
			return "";
		}
		if (!value || !value.isTruthy()) return "";
		return value.toString().trim();
	}

	private cardTitle(entry: BasesEntry): string {
		if (this.titleProp) {
			const text = this.propertyText(entry, this.titleProp);
			if (text) return text;
		}
		return entry.file.basename;
	}

	private cardFingerprint(entry: BasesEntry): string {
		const parts: string[] = [this.cardTitle(entry)];
		const order = this.config.getOrder?.() ?? [];
		for (const propId of order) {
			if (propId === this.groupByProp || propId === this.titleProp) {
				continue;
			}
			parts.push(this.propertyText(entry, propId));
		}
		return parts.join(" ");
	}

	private registerCardBehavior(
		card: HTMLElement,
		path: string,
		columnValue: string,
	): void {
		card.addEventListener("click", (e) => {
			if (this.dragKind) return;
			void this.app.workspace.openLinkText(
				path,
				"",
				Keymap.isModEvent(e),
			);
		});

		card.addEventListener("auxclick", (e) => {
			if (e.button !== 1) return;
			e.preventDefault();
			const file = this.entryByPath.get(path)?.file;
			if (file) this.openInBackground(file);
		});

		card.addEventListener("dragstart", (e) => {
			e.stopPropagation();
			this.dragKind = "card";
			this.draggedCardEl = card;
			this.draggedCardPath = path;
			this.draggedCardFromValue = columnValue;
			e.dataTransfer?.setData("text/plain", path);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
			window.setTimeout(() => card.classList.add("is-dragging"), 0);
		});

		card.addEventListener("dragend", () => {
			card.classList.remove("is-dragging");
			void this.finishCardDrag(card);
		});
	}

	private openInBackground(file: TFile): void {
		const previous = this.app.workspace.getMostRecentLeaf();
		const leaf = this.app.workspace.getLeaf("tab");
		void leaf.openFile(file, { active: false });
		if (previous && previous !== leaf) {
			this.app.workspace.setActiveLeaf(previous, { focus: false });
		}
	}

	private registerCardDropZone(body: HTMLElement): void {
		body.addEventListener("dragover", (e) => {
			if (this.dragKind !== "card" || !this.draggedCardEl) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			const dragged = this.draggedCardEl;
			const after = this.cardAfterPoint(body, e.clientY);
			if (dragged.parentElement === body) {
				if (after == null) {
					if (dragged !== body.lastElementChild)
						body.appendChild(dragged);
				} else if (after !== dragged.nextElementSibling) {
					body.insertBefore(dragged, after);
				}
			} else if (after == null) {
				body.appendChild(dragged);
			} else {
				body.insertBefore(dragged, after);
			}
		});

		body.addEventListener("drop", (e) => {
			if (this.dragKind !== "card") return;
			e.preventDefault();
		});
	}

	private cardAfterPoint(body: HTMLElement, y: number): HTMLElement | null {
		const cards = Array.from(
			body.querySelectorAll<HTMLElement>(
				".obsilities-kanban-card:not(.is-dragging)",
			),
		);
		for (const card of cards) {
			const rect = card.getBoundingClientRect();
			if (y < rect.top + rect.height / 2) return card;
		}
		return null;
	}

	private async finishCardDrag(card: HTMLElement): Promise<void> {
		const path = this.draggedCardPath;
		const fromValue = this.draggedCardFromValue;
		this.dragKind = null;
		this.draggedCardEl = null;
		this.draggedCardPath = null;
		this.draggedCardFromValue = null;

		if (!path || !this.prefsProp) return;

		const columnEl = card.closest<HTMLElement>(".obsilities-kanban-column");
		const toValue = columnEl?.getAttribute("data-column-value") ?? null;

		if (
			!toValue ||
			toValue === fromValue ||
			!this.prefsProp.startsWith("note.")
		) {
			window.requestAnimationFrame(() => this.render());
			return;
		}

		const entry = this.entryByPath.get(path);
		if (!entry) return;

		const propertyName = parsePropertyId(this.prefsProp).name;
		try {
			await this.app.fileManager.processFrontMatter(
				entry.file,
				(frontmatter: Record<string, unknown>) => {
					frontmatter[propertyName] = toValue;
				},
			);
		} catch (error) {
			console.error(
				"obsilities-kanban: failed to update frontmatter",
				error,
			);
			this.render();
		}
	}

	private registerColumnDragHandle(
		handle: HTMLElement,
		column: HTMLElement,
		value: string,
	): void {
		handle.addEventListener("mousedown", () => {
			this.armedColumn = column;
			column.setAttribute("draggable", "true");
		});

		column.addEventListener("dragstart", (e) => {
			this.dragKind = "column";
			this.draggedColumnEl = column;
			if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
			e.dataTransfer?.setData("text/plain", "");
			window.setTimeout(() => column.classList.add("is-dragging"), 0);
		});

		column.addEventListener("dragend", () => {
			column.classList.remove("is-dragging");
			this.disarmColumn();
			this.finishColumnDrag();
		});
	}

	private registerColumnDropZone(board: HTMLElement): void {
		board.addEventListener("dragover", (e) => {
			if (this.dragKind !== "column") return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			this.columnDragX = e.clientX;
			if (this.columnDragRaf === null) {
				this.columnDragRaf = window.requestAnimationFrame(() => {
					this.columnDragRaf = null;
					this.reorderColumnsDuringDrag(board);
				});
			}
		});
	}

	private reorderColumnsDuringDrag(board: HTMLElement): void {
		const dragged = this.draggedColumnEl;
		if (!dragged || this.dragKind !== "column") return;

		const before = this.columnBeforeElementAt(board, this.columnDragX);
		if (before === dragged.nextElementSibling) return;
		if (before === null && dragged === board.lastElementChild) return;

		this.animateColumnShift(board, () => {
			if (before === null) board.appendChild(dragged);
			else board.insertBefore(dragged, before);
		});
	}

	private animateColumnShift(board: HTMLElement, move: () => void): void {
		const columns = Array.from(
			board.querySelectorAll<HTMLElement>(".obsilities-kanban-column"),
		).filter((c) => c !== this.draggedColumnEl);

		const first = new Map(
			columns.map((c) => [c, c.getBoundingClientRect().left]),
		);
		move();

		for (const column of columns) {
			const dx =
				(first.get(column) ?? 0) - column.getBoundingClientRect().left;
			if (!dx) continue;
			column.classList.add("is-shifting");
			column.style.transition = "none";
			column.style.transform = `translateX(${dx}px)`;
			window.requestAnimationFrame(() => {
				column.style.transition = "transform 160ms ease";
				column.style.transform = "";
				window.setTimeout(() => {
					column.style.transition = "";
					column.style.transform = "";
					column.classList.remove("is-shifting");
				}, 180);
			});
		}
	}

	private columnBeforeElementAt(
		board: HTMLElement,
		x: number,
	): HTMLElement | null {
		const columns = Array.from(
			board.querySelectorAll<HTMLElement>(".obsilities-kanban-column"),
		);
		for (const column of columns) {
			if (column === this.draggedColumnEl) continue;
			const rect = column.getBoundingClientRect();
			if (x < rect.left + rect.width / 2) return column;
		}
		return null;
	}

	private finishColumnDrag(): void {
		if (this.columnDragRaf !== null) {
			window.cancelAnimationFrame(this.columnDragRaf);
			this.columnDragRaf = null;
		}
		this.dragKind = null;
		this.draggedColumnEl = null;
		if (!this.boardEl) return;

		const order = Array.from(
			this.boardEl.querySelectorAll<HTMLElement>(
				".obsilities-kanban-column",
			),
		)
			.map((col) => col.getAttribute("data-column-value"))
			.filter((v): v is string => v !== null);

		if (order.length === 0) return;
		this.columnOrder = order;
		this.persistColumnOrder();
	}

	private openColorPicker(
		anchor: HTMLElement,
		column: HTMLElement,
		columnValue: string,
	): void {
		this.closeColorPopover();

		const popover = this.containerEl.doc.createElement("div");
		popover.className = "obsilities-kanban-color-popover";
		const current = column.getAttribute("data-column-color") || null;

		const makeSwatch = (
			colorName: string | null,
			cssVar: string | null,
		): HTMLElement => {
			const swatch = popover.createDiv({
				cls: "obsilities-kanban-color-swatch",
			});
			if (cssVar) swatch.style.background = cssVar;
			else swatch.classList.add("obsilities-kanban-color-none");
			if (current === colorName) swatch.classList.add("is-active");
			swatch.addEventListener("click", () => {
				this.setColumnColor(column, columnValue, colorName);
				this.closeColorPopover();
			});
			return swatch;
		};

		makeSwatch(null, null);
		for (const color of COLOR_PALETTE) {
			makeSwatch(color.name, color.cssVar);
		}

		const rect = anchor.getBoundingClientRect();
		popover.style.top = `${rect.bottom + 4}px`;
		popover.style.left = `${rect.left}px`;
		this.containerEl.doc.body.appendChild(popover);
		this.colorPopover = popover;

		this.colorPopoverDismiss = (e: MouseEvent) => {
			if (
				e.target instanceof Node &&
				!popover.contains(e.target) &&
				e.target !== anchor
			) {
				this.closeColorPopover();
			}
		};
		this.containerEl.doc.addEventListener(
			"click",
			this.colorPopoverDismiss,
		);
	}

	private setColumnColor(
		column: HTMLElement,
		columnValue: string,
		colorName: string | null,
	): void {
		this.applyColumnColor(column, colorName);
		if (colorName) this.columnColors[columnValue] = colorName;
		else delete this.columnColors[columnValue];
		this.persistColumnColors();
	}

	private closeColorPopover(): void {
		if (this.colorPopoverDismiss) {
			this.containerEl.doc.removeEventListener(
				"click",
				this.colorPopoverDismiss,
			);
			this.colorPopoverDismiss = null;
		}
		this.colorPopover?.remove();
		this.colorPopover = null;
	}

	static getViewOptions(this: void): BasesOptions[] {
		return [
			{
				displayName: "Group by",
				type: "property",
				key: "groupByProperty",
				placeholder: "Select a note property",
				filter: (prop: BasesPropertyId) => prop.startsWith("note."),
			},
			{
				displayName: "Card title",
				type: "property",
				key: "cardTitleProperty",
				placeholder: "Default: file name",
			},
		];
	}
}
