import { Plugin, Platform, setIcon, Menu, TFolder, debounce } from "obsidian";
import { DEFAULT_SETTINGS, DEFAULT_SMART_TYPOGRAPHY } from "./types";
import { KANBAN_VIEW_TYPE, KanbanView } from "./bases/kanban";
import { CALENDAR_VIEW_TYPE } from "./bases/calendar/types";
import { CalendarView } from "./bases/calendar/view";
import { ObsilitiesSettingTab } from "./settings";
import {
	buildInputRules,
	createSmartTypographyExtension,
	type SmartTypographyState,
} from "./typography/extension";

import type {
	BasesOptions,
	BasesView,
	QueryController,
	WorkspaceLeaf,
} from "obsidian";
import type { ObsilitiesSettings } from "./types";

interface AppInternals {
	setting?: { open: () => void };
}

interface BasesViewRegistration {
	name: string;
	icon: string;
	factory: (
		controller: QueryController,
		containerEl: HTMLElement,
	) => BasesView;
	options: (this: void) => BasesOptions[];
}

type BasesCapablePlugin = Plugin & {
	registerBasesView?: (
		viewId: string,
		registration: BasesViewRegistration,
	) => boolean;
};

export default class ObsilitiesPlugin extends Plugin {
	settings: ObsilitiesSettings = { ...DEFAULT_SETTINGS };
	private headerContainer: HTMLElement | null = null;
	private separatorEl: HTMLElement | null = null;
	private sidebarTabsContainer: HTMLElement | null = null;
	private ribbonObserver: MutationObserver | null = null;
	private sidebarObserver: MutationObserver | null = null;
	private sidebarTabsObserver: MutationObserver | null = null;
	private leftSplitObserver: MutationObserver | null = null;
	private headerResizeObserver: ResizeObserver | null = null;
	private initialLayoutRaf: number | null = null;
	private initialLayoutTimeout: number | null = null;
	private draggedEl: HTMLElement | null = null;
	private ribbonCloneMap: WeakMap<HTMLElement, HTMLElement> = new WeakMap();
	private folderColorStyleEl: HTMLStyleElement | null = null;
	private smartTypographyState: SmartTypographyState = {
		inputRules: [],
		inputRuleMap: {},
	};

	private get appInternals(): AppInternals {
		return this.app as unknown as AppInternals;
	}

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerKanbanBasesView();
		this.registerCalendarBasesView();

		this.buildSmartTypographyRules();
		this.registerEditorExtension(
			createSmartTypographyExtension({
				getSettings: () => this.settings.smartTypography,
				getInputRuleMap: () => this.smartTypographyState.inputRuleMap,
			}),
		);

		this.addRibbonIcon("settings", "Open settings", () => {
			this.appInternals.setting?.open();
		});

		this.applyBodyClasses();

		this.app.workspace.onLayoutReady(() => {
			if (Platform.isDesktopApp) {
				this.injectHeaderButtons();
			}
			this.openGraphIfEmpty();
			this.updateFolderColors();
		});

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.openGraphIfEmpty();
			}),
		);

		// Rebuild folder colors when the top-level folder set may have changed
		// updateFolderColors() no-ops when the sorted top-level names are unchanged
		const scheduleFolderColors = debounce(
			() => this.updateFolderColors(),
			300,
			true,
		);
		this.registerEvent(this.app.vault.on("create", scheduleFolderColors));
		this.registerEvent(this.app.vault.on("delete", scheduleFolderColors));
		this.registerEvent(this.app.vault.on("rename", scheduleFolderColors));

		this.addSettingTab(new ObsilitiesSettingTab(this.app, this));
	}

	onunload(): void {
		this.cleanupHeaderButtons();
		this.folderColorStyleEl?.remove();
		this.folderColorStyleEl = null;
		document.body.style.removeProperty("--file-line-width");
		document.body.classList.remove(
			"obsilities-hide-scrollbars",
			"obsilities-hide-new-tab",
			"obsilities-hide-tab-list",
			"obsilities-hide-vault-profile",
			"obsilities-hide-properties-header",
			"obsilities-hide-external-links",
			"obsilities-file-icons",
			"obsilities-folder-colors",
		);
	}

	private registerKanbanBasesView(): void {
		const register = (this as BasesCapablePlugin).registerBasesView;
		if (typeof register !== "function") return;
		register.call(this, KANBAN_VIEW_TYPE, {
			name: "Kanban",
			icon: "square-kanban",
			factory: (controller, containerEl) =>
				new KanbanView(controller, containerEl),
			options: KanbanView.getViewOptions,
		});
	}

	private registerCalendarBasesView(): void {
		const register = (this as BasesCapablePlugin).registerBasesView;
		if (typeof register !== "function") return;
		register.call(this, CALENDAR_VIEW_TYPE, {
			name: "Calendar",
			icon: "calendar",
			factory: (controller, containerEl) =>
				new CalendarView(controller, containerEl),
			options: CalendarView.getViewOptions,
		});
	}

	applyBodyClasses(): void {
		document.body.style.setProperty(
			"--file-line-width",
			`${this.settings.readableLineWidth}px`,
		);
		document.body.classList.toggle(
			"obsilities-hide-scrollbars",
			this.settings.hideScrollbars,
		);
		document.body.classList.toggle(
			"obsilities-hide-new-tab",
			this.settings.hideNewTabButton,
		);
		document.body.classList.toggle(
			"obsilities-hide-tab-list",
			this.settings.hideTabList,
		);
		document.body.classList.toggle(
			"obsilities-hide-vault-profile",
			this.settings.hideVaultProfile,
		);
		document.body.classList.toggle(
			"obsilities-hide-properties-header",
			this.settings.hidePropertiesHeader,
		);
		document.body.classList.toggle(
			"obsilities-hide-external-links",
			this.settings.hideExternalLinks,
		);
		document.body.classList.toggle(
			"obsilities-file-icons",
			this.settings.fileExplorerIcons,
		);
		document.body.classList.toggle(
			"obsilities-folder-colors",
			this.settings.folderColors,
		);
	}

	// Give each top-level folder a hue drawn from a narrow gradient
	updateFolderColors(): void {
		if (!this.settings.folderColors) {
			this.folderColorStyleEl?.remove();
			this.folderColorStyleEl = null;
			return;
		}

		const folders = this.app.vault
			.getRoot()
			.children.filter(
				(child): child is TFolder => child instanceof TFolder,
			)
			.sort((a, b) => a.name.localeCompare(b.name));

		const HUE_START = 210;
		const HUE_SPAN = 140;
		const count = folders.length;
		const rules = folders.map((folder, i) => {
			const hue =
				count > 1
					? Math.round(HUE_START + (HUE_SPAN / (count - 1)) * i)
					: HUE_START;
			const path = folder.name
				.replace(/\\/g, "\\\\")
				.replace(/"/g, '\\"');
			return (
				`body.obsilities-folder-colors .nav-folder-title[data-path="${path}"],\n` +
				`body.obsilities-folder-colors .nav-folder-title[data-path^="${path}/"],\n` +
				`body.obsilities-folder-colors .nav-file-title[data-path^="${path}/"] {\n` +
				`\t--obsilities-folder-hue: ${hue};\n}`
			);
		});

		const css = rules.join("\n\n");
		if (
			this.folderColorStyleEl &&
			this.folderColorStyleEl.textContent === css
		) {
			return;
		}
		if (!this.folderColorStyleEl) {
			this.folderColorStyleEl = document.createElement("style");
			this.folderColorStyleEl.id = "obsilities-folder-colors";
			document.head.appendChild(this.folderColorStyleEl);
		}
		this.folderColorStyleEl.textContent = css;
	}

	buildSmartTypographyRules(): void {
		this.smartTypographyState = buildInputRules(
			this.settings.smartTypography,
		);
	}

	async loadSettings(): Promise<void> {
		const saved =
			(await this.loadData()) as Partial<ObsilitiesSettings> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...saved,
			smartTypography: {
				...DEFAULT_SMART_TYPOGRAPHY,
				...saved?.smartTypography,
			},
		};
	}

	async saveSettings(): Promise<void> {
		this.buildSmartTypographyRules();
		await this.saveData(this.settings);
	}

	private injectHeaderButtons(): void {
		const ribbon = document.querySelector(".workspace-ribbon.mod-left");
		const workspace = document.querySelector(".workspace");
		if (!ribbon || !workspace) return;

		// Hide the ribbon entirely via body class (styling lives in styles.css)
		document.body.classList.add("obsilities-active");

		// Create container in the top bar
		this.headerContainer = createDiv({ cls: "obsilities-header-buttons" });

		// Add sidebar toggle button
		const toggleBtn = createDiv({
			cls: "obsilities-toggle-btn clickable-icon",
			attr: { "aria-label": "Toggle left sidebar" },
		});
		setIcon(toggleBtn, "sidebar-left");
		toggleBtn.addEventListener("click", () => {
			this.app.workspace.leftSplit.toggle();
		});
		this.headerContainer.appendChild(toggleBtn);

		// Container for cloned sidebar tab headers (right after toggle)
		this.sidebarTabsContainer = createDiv({
			cls: "obsilities-sidebar-tabs",
		});
		this.headerContainer.appendChild(this.sidebarTabsContainer);

		// Separator between sidebar tabs and ribbon buttons
		this.separatorEl = createDiv({ cls: "obsilities-separator" });
		this.headerContainer.appendChild(this.separatorEl);

		// Trailing separator appended now so ribbon buttons can always insert before it
		const trailingSep = createDiv({ cls: "obsilities-separator-trailing" });
		this.headerContainer.appendChild(trailingSep);

		// Clone ribbon action buttons (clones proxy clicks to originals)
		const actions = ribbon.querySelector(".side-dock-actions");
		if (actions) {
			const clones: HTMLElement[] = [];
			for (const btn of Array.from(actions.children) as HTMLElement[]) {
				clones.push(this.cloneButton(btn));
			}
			this.sortButtonsByOrder(clones);
			for (const clone of clones) {
				trailingSep.before(clone);
			}

			this.ribbonObserver = new MutationObserver((mutations) => {
				for (const m of mutations) {
					for (const node of Array.from(m.addedNodes)) {
						if (node instanceof HTMLElement) {
							trailingSep.before(this.cloneButton(node));
						}
					}
					for (const node of Array.from(m.removedNodes)) {
						if (node instanceof HTMLElement) {
							// Drop the clone mirroring the removed action
							this.ribbonCloneMap.get(node)?.remove();
							this.ribbonCloneMap.delete(node);
						}
					}
				}
				this.applyButtonVisibility();
			});
			this.ribbonObserver.observe(actions, { childList: true });
		}

		this.applyButtonVisibility();

		// Right-click context menu
		this.headerContainer.addEventListener("contextmenu", (e) => {
			this.showButtonToggleMenu(e);
		});

		// Drag-and-drop handlers on the container
		this.headerContainer.addEventListener("dragover", (e) => {
			e.preventDefault();
			if (!this.draggedEl) return;
			const target = this.getDragTarget(e);
			if (target && target !== this.draggedEl) {
				const rect = target.getBoundingClientRect();
				const midX = rect.left + rect.width / 2;
				if (e.clientX < midX) {
					target.before(this.draggedEl);
				} else {
					target.after(this.draggedEl);
				}
			}
		});

		this.headerContainer.addEventListener("drop", (e) => {
			e.preventDefault();
			this.draggedEl?.classList.remove("obsilities-dragging");
			this.draggedEl = null;
			this.saveButtonOrder();
		});

		// Insert into workspace
		workspace.appendChild(this.headerContainer);

		// Clone sidebar tab headers and watch for changes
		this.syncSidebarTabs();
		const sidebarTabInner = document.querySelector(
			".mod-left-split .workspace-tab-header-container-inner",
		);
		if (sidebarTabInner) {
			this.sidebarTabsObserver = new MutationObserver(() => {
				this.syncSidebarTabs();
			});
			this.sidebarTabsObserver.observe(sidebarTabInner, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["class"],
			});
		}

		// Track header width and update padding
		this.headerResizeObserver = new ResizeObserver(() => {
			this.updateLayout();
		});
		this.headerResizeObserver.observe(this.headerContainer);

		// Watch left split style changes (width update lags behind class change)
		const leftSplit = document.querySelector(".mod-left-split");
		if (leftSplit) {
			this.leftSplitObserver = new MutationObserver(() => {
				this.updateLayout();
			});
			this.leftSplitObserver.observe(leftSplit, {
				attributes: true,
				attributeFilter: ["style"],
			});
		}

		// Watch sidebar state for layout updates
		this.sidebarObserver = new MutationObserver(() => {
			this.updateLayout();
		});
		this.sidebarObserver.observe(workspace, {
			attributes: true,
			attributeFilter: ["class"],
		});

		// Initial layout
		this.initialLayoutRaf = window.requestAnimationFrame(() => {
			this.initialLayoutRaf = null;
			this.updateLayout();
		});
		this.initialLayoutTimeout = window.setTimeout(() => {
			this.initialLayoutTimeout = null;
			this.updateLayout();
		}, 100);
	}

	private syncSidebarTabs(): void {
		if (!this.sidebarTabsContainer) return;

		const originalInner = document.querySelector(
			".mod-left-split .workspace-tab-header-container-inner",
		);
		if (!originalInner) return;

		// Clear existing clones
		this.sidebarTabsContainer.empty();

		// Create a simple icon button for each tab header
		for (const original of Array.from(
			originalInner.children,
		) as HTMLElement[]) {
			const icon = original.querySelector(
				".workspace-tab-header-inner-icon",
			);
			if (!icon) continue;

			const btn = createDiv({
				cls: "obsilities-sidebar-tab clickable-icon",
				attr: {
					"aria-label": original.getAttribute("aria-label") || "",
				},
			});
			for (const child of Array.from(icon.childNodes)) {
				btn.appendChild(child.cloneNode(true));
			}
			if (original.classList.contains("is-active")) {
				btn.classList.add("is-active");
			}
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				original.click();
			});
			this.sidebarTabsContainer.appendChild(btn);
		}

		this.updateLayout();
	}

	private cloneButton(original: HTMLElement): HTMLElement {
		const clone = original.cloneNode(true) as HTMLElement;
		clone.classList.add("obsilities-header-btn");
		clone.setAttribute("draggable", "true");
		this.ribbonCloneMap.set(original, clone);
		clone.addEventListener("click", (e) => {
			e.stopPropagation();
			original.click();
		});
		clone.addEventListener("dragstart", (e) => {
			this.draggedEl = clone;
			clone.classList.add("obsilities-dragging");
			e.dataTransfer?.setData("text/plain", "");
		});
		clone.addEventListener("dragend", () => {
			clone.classList.remove("obsilities-dragging");
			this.draggedEl = null;
		});
		return clone;
	}

	private getDragTarget(e: DragEvent): HTMLElement | null {
		const els = this.headerContainer?.querySelectorAll(
			".obsilities-header-btn",
		);
		if (!els) return null;
		for (const el of Array.from(els) as HTMLElement[]) {
			const rect = el.getBoundingClientRect();
			if (
				e.clientX >= rect.left &&
				e.clientX <= rect.right &&
				e.clientY >= rect.top &&
				e.clientY <= rect.bottom
			) {
				return el;
			}
		}
		return null;
	}

	private getButtonKey(btn: Element): string {
		const svg = btn.querySelector("svg");
		if (svg) {
			for (const cls of Array.from(svg.classList)) {
				if (cls.startsWith("lucide-")) return cls;
			}
		}
		return btn.getAttribute("aria-label") || "";
	}

	private sortButtonsByOrder(buttons: HTMLElement[]): void {
		const order = this.settings.headerButtonOrder;
		if (!order.length) return;
		buttons.sort((a, b) => {
			const aIdx = order.indexOf(this.getButtonKey(a));
			const bIdx = order.indexOf(this.getButtonKey(b));
			if (aIdx === -1 && bIdx === -1) return 0;
			if (aIdx === -1) return 1;
			if (bIdx === -1) return -1;
			return aIdx - bIdx;
		});
	}

	private saveButtonOrder(): void {
		const buttons = this.headerContainer?.querySelectorAll(
			".obsilities-header-btn",
		);
		if (!buttons) return;
		this.settings.headerButtonOrder = Array.from(buttons).map((btn) =>
			this.getButtonKey(btn),
		);
		void this.saveSettings();
	}

	private showButtonToggleMenu(e: MouseEvent): void {
		e.preventDefault();
		const menu = new Menu();
		const buttons = this.headerContainer?.querySelectorAll(
			".obsilities-header-btn",
		);
		if (!buttons?.length) return;

		for (const btn of Array.from(buttons)) {
			const key = this.getButtonKey(btn);
			const label = btn.getAttribute("aria-label") || "Unknown";
			const isHidden = this.settings.hiddenHeaderButtons[key] ?? false;
			menu.addItem((item) => {
				item.setTitle(label)
					.setChecked(!isHidden)
					.onClick(async () => {
						this.settings.hiddenHeaderButtons[key] = !isHidden;
						await this.saveSettings();
						this.applyButtonVisibility();
					});
			});
		}

		menu.showAtMouseEvent(e);
	}

	applyButtonVisibility(): void {
		const buttons = this.headerContainer?.querySelectorAll(
			".obsilities-header-btn",
		);
		if (!buttons) return;
		for (const btn of Array.from(buttons)) {
			const key = this.getButtonKey(btn);
			const isHidden = this.settings.hiddenHeaderButtons[key] ?? false;
			btn.classList.toggle("obsilities-button-hidden", isHidden);
		}
	}

	private updateLayout(): void {
		if (!this.headerContainer) return;

		const headerWidth = this.headerContainer.getBoundingClientRect().width;

		document.documentElement.style.setProperty(
			"--obsilities-header-width",
			`${headerWidth}px`,
		);

		const isSidebarOpen = document.querySelector(
			".workspace.is-left-sidedock-open",
		);

		if (isSidebarOpen) {
			const leftSplit = document.querySelector(
				".mod-left-split",
			) as HTMLElement | null;
			const splitWidth = leftSplit
				? parseFloat(leftSplit.style.width) || 0
				: 0;
			const rootExtra = Math.max(0, headerWidth - splitWidth);
			document.documentElement.style.setProperty(
				"--obsilities-root-extra",
				`${rootExtra}px`,
			);
		} else {
			document.documentElement.style.setProperty(
				"--obsilities-root-extra",
				`${headerWidth}px`,
			);
		}
	}

	private cleanupHeaderButtons(): void {
		this.ribbonObserver?.disconnect();
		this.ribbonObserver = null;
		this.sidebarObserver?.disconnect();
		this.sidebarObserver = null;
		this.sidebarTabsObserver?.disconnect();
		this.sidebarTabsObserver = null;
		this.leftSplitObserver?.disconnect();
		this.leftSplitObserver = null;
		this.headerResizeObserver?.disconnect();
		this.headerResizeObserver = null;
		if (this.initialLayoutRaf !== null) {
			window.cancelAnimationFrame(this.initialLayoutRaf);
			this.initialLayoutRaf = null;
		}
		if (this.initialLayoutTimeout !== null) {
			window.clearTimeout(this.initialLayoutTimeout);
			this.initialLayoutTimeout = null;
		}

		document.body.classList.remove("obsilities-active");
		this.headerContainer?.remove();
		this.headerContainer = null;
		this.separatorEl = null;
		this.sidebarTabsContainer = null;
		document.documentElement.style.removeProperty(
			"--obsilities-header-width",
		);
		document.documentElement.style.removeProperty(
			"--obsilities-root-extra",
		);
	}

	private openGraphIfEmpty(): void {
		if (!Platform.isDesktopApp) return;
		if (!this.settings.defaultGraphView) return;

		const rootLeaves: WorkspaceLeaf[] = [];
		this.app.workspace.iterateRootLeaves((leaf) => {
			rootLeaves.push(leaf);
		});
		if (rootLeaves.length === 0) return;

		const allEmpty = rootLeaves.every(
			(leaf) => leaf.view?.getViewType() === "empty",
		);
		if (!allEmpty) return;

		const first = rootLeaves[0];
		if (first) void first.setViewState({ type: "graph", active: true });
	}
}
