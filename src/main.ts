import { Plugin, Platform, setIcon, Menu } from "obsidian";
import type { ObsilitiesSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { ObsilitiesSettingTab } from "./settings";
import {
	buildInputRules,
	createSmartTypographyExtension,
	type SmartTypographyState,
} from "./typography/extension";

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
	private trailingSepEl: HTMLElement | null = null;
	private dynamicStyleEl: HTMLStyleElement | null = null;
	private draggedEl: HTMLElement | null = null;
	private smartTypographyState: SmartTypographyState = {
		inputRules: [],
		inputRuleMap: {},
	};

	async onload(): Promise<void> {
		await this.loadSettings();

		this.buildSmartTypographyRules();
		this.registerEditorExtension(
			createSmartTypographyExtension({
				getSettings: () => this.settings.smartTypography,
				getInputRuleMap: () => this.smartTypographyState.inputRuleMap,
			})
		);

		this.addRibbonIcon("settings", "Open settings", () => {
			(
				this.app as { setting?: { open: () => void } }
			).setting?.open();
		});

		this.app.workspace.onLayoutReady(() => {
			if (Platform.isDesktopApp) {
				this.injectHeaderButtons();
			}
			this.openGraphIfEmpty();
		});

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.openGraphIfEmpty();
			})
		);

		this.addSettingTab(new ObsilitiesSettingTab(this.app, this));
	}

	onunload(): void {
		this.cleanupHeaderButtons();
	}

	buildSmartTypographyRules(): void {
		this.smartTypographyState = buildInputRules(
			this.settings.smartTypography
		);
	}

	async loadSettings(): Promise<void> {
		this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
	}

	async saveSettings(): Promise<void> {
		this.buildSmartTypographyRules();
		await this.saveData(this.settings);
	}

	private injectHeaderButtons(): void {
		const ribbon = document.querySelector(".workspace-ribbon.mod-left");
		const workspace = document.querySelector(".workspace");
		if (!ribbon || !workspace) return;

		// Hide the ribbon entirely via body class
		document.body.classList.add("obsilities-active");

		// Inject overrides — high specificity to beat theme rules
		this.dynamicStyleEl = document.createElement("style");
		this.dynamicStyleEl.textContent = `
			body.obsilities-active.obsilities-active .workspace .workspace-split .workspace-tabs .workspace-tab-container.workspace-tab-container.workspace-tab-container.workspace-tab-container {
				border-bottom-left-radius: 0 !important;
				border-bottom-right-radius: 0 !important;
			}
		`;
		document.head.appendChild(this.dynamicStyleEl);

		// Create container in the top bar
		this.headerContainer = createDiv({ cls: "obsilities-header-buttons" });

		// Add sidebar toggle button
		const toggleBtn = createDiv({
			cls: "obsilities-toggle-btn clickable-icon",
			attr: { "aria-label": "Toggle left sidebar" },
		});
		setIcon(toggleBtn, "sidebar-left");
		toggleBtn.addEventListener("click", () => {
			(
				this.app as unknown as {
					commands: { executeCommandById: (id: string) => void };
				}
			).commands.executeCommandById("app:toggle-left-sidebar");
		});
		this.headerContainer.appendChild(toggleBtn);

		// Container for cloned sidebar tab headers (right after toggle)
		this.sidebarTabsContainer = createDiv({ cls: "obsilities-sidebar-tabs" });
		this.headerContainer.appendChild(this.sidebarTabsContainer);

		// Separator between sidebar tabs and ribbon buttons
		this.separatorEl = createDiv({ cls: "obsilities-separator" });
		this.headerContainer.appendChild(this.separatorEl);

		// Clone ribbon action buttons (clones proxy clicks to originals)
		const actions = ribbon.querySelector(".side-dock-actions");
		if (actions) {
			const clones: HTMLElement[] = [];
			for (const btn of Array.from(actions.children) as HTMLElement[]) {
				clones.push(this.cloneButton(btn));
			}
			this.sortButtonsByOrder(clones);
			for (const clone of clones) {
				this.headerContainer.appendChild(clone);
			}

			this.ribbonObserver = new MutationObserver((mutations) => {
				for (const m of mutations) {
					for (const node of Array.from(m.addedNodes)) {
						if (node instanceof HTMLElement) {
							// Insert before trailing separator
							this.trailingSepEl!.before(
								this.cloneButton(node)
							);
							this.applyButtonVisibility();
						}
					}
				}
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

		// Trailing separator between ribbon buttons and tabs
		this.trailingSepEl = createDiv({ cls: "obsilities-separator-trailing" });
		this.headerContainer.appendChild(this.trailingSepEl);

		// Insert into workspace
		workspace.appendChild(this.headerContainer);

		// Clone sidebar tab headers and watch for changes
		this.syncSidebarTabs();
		const sidebarTabInner = document.querySelector(
			".mod-left-split .workspace-tab-header-container-inner"
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
		requestAnimationFrame(() => this.updateLayout());
		setTimeout(() => this.updateLayout(), 100);
	}

	private syncSidebarTabs(): void {
		if (!this.sidebarTabsContainer) return;

		const originalInner = document.querySelector(
			".mod-left-split .workspace-tab-header-container-inner"
		);
		if (!originalInner) return;

		// Clear existing clones
		this.sidebarTabsContainer.empty();

		// Create a simple icon button for each tab header
		for (const original of Array.from(
			originalInner.children
		) as HTMLElement[]) {
			const icon = original.querySelector(
				".workspace-tab-header-inner-icon"
			);
			if (!icon) continue;

			const btn = createDiv({
				cls: "obsilities-sidebar-tab clickable-icon",
				attr: {
					"aria-label":
						original.getAttribute("aria-label") || "",
				},
			});
			btn.innerHTML = icon.innerHTML;
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
			".obsilities-header-btn"
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

	private sortButtonsByOrder(buttons: HTMLElement[]): void {
		const order = this.settings.headerButtonOrder;
		if (!order.length) return;
		buttons.sort((a, b) => {
			const aLabel = a.getAttribute("aria-label") || "";
			const bLabel = b.getAttribute("aria-label") || "";
			const aIdx = order.indexOf(aLabel);
			const bIdx = order.indexOf(bLabel);
			if (aIdx === -1 && bIdx === -1) return 0;
			if (aIdx === -1) return 1;
			if (bIdx === -1) return -1;
			return aIdx - bIdx;
		});
	}

	private saveButtonOrder(): void {
		const buttons = this.headerContainer?.querySelectorAll(
			".obsilities-header-btn"
		);
		if (!buttons) return;
		this.settings.headerButtonOrder = Array.from(buttons).map(
			(btn) => btn.getAttribute("aria-label") || ""
		);
		void this.saveSettings();
	}

	private showButtonToggleMenu(e: MouseEvent): void {
		e.preventDefault();
		const menu = new Menu();
		const buttons =
			this.headerContainer?.querySelectorAll(".obsilities-header-btn");
		if (!buttons?.length) return;

		for (const btn of Array.from(buttons)) {
			const label = btn.getAttribute("aria-label") || "Unknown";
			const isHidden =
				this.settings.hiddenHeaderButtons[label] ?? false;
			menu.addItem((item) => {
				item.setTitle(label)
					.setChecked(!isHidden)
					.onClick(async () => {
						this.settings.hiddenHeaderButtons[label] = !isHidden;
						await this.saveSettings();
						this.applyButtonVisibility();
					});
			});
		}

		menu.showAtMouseEvent(e);
	}

	applyButtonVisibility(): void {
		const buttons =
			this.headerContainer?.querySelectorAll(".obsilities-header-btn");
		if (!buttons) return;
		for (const btn of Array.from(buttons)) {
			const label = btn.getAttribute("aria-label") || "";
			const isHidden =
				this.settings.hiddenHeaderButtons[label] ?? false;
			btn.classList.toggle("obsilities-button-hidden", isHidden);
		}
	}

	private updateLayout(): void {
		if (!this.headerContainer) return;

		const headerWidth =
			this.headerContainer.getBoundingClientRect().width;

		document.documentElement.style.setProperty(
			"--obsilities-header-width",
			`${headerWidth}px`
		);

		const isSidebarOpen = document.querySelector(
			".workspace.is-left-sidedock-open"
		);

		if (isSidebarOpen) {
			const leftSplit = document.querySelector(
				".mod-left-split"
			) as HTMLElement | null;
			const splitWidth = leftSplit
				? parseFloat(leftSplit.style.width) || 0
				: 0;
			const rootExtra = Math.max(0, headerWidth - splitWidth);
			document.documentElement.style.setProperty(
				"--obsilities-root-extra",
				`${rootExtra}px`
			);
		} else {
			document.documentElement.style.setProperty(
				"--obsilities-root-extra",
				`${headerWidth}px`
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

		document.body.classList.remove("obsilities-active");
		this.dynamicStyleEl?.remove();
		this.dynamicStyleEl = null;
		this.headerContainer?.remove();
		this.headerContainer = null;
		this.separatorEl = null;
		this.trailingSepEl = null;
		this.sidebarTabsContainer = null;
		document.documentElement.style.removeProperty("--obsilities-header-width");
		document.documentElement.style.removeProperty("--obsilities-root-extra");
	}

	private openGraphIfEmpty(): void {
		if (!Platform.isDesktopApp) return;
		if (!this.settings.defaultGraphView) return;

		const leaves = this.app.workspace.getLeavesOfType("empty");
		if (leaves.length === 0) return;

		const rootLeaves = this.app.workspace.rootSplit
			? this.getAllLeaves(this.app.workspace.rootSplit)
			: [];
		const allEmpty =
			rootLeaves.length > 0 &&
			rootLeaves.every((l) => l.view?.getViewType() === "empty");
		if (!allEmpty) return;

		const leaf = leaves[0];
		if (leaf) {
			void leaf.setViewState({ type: "graph", active: true });
		}
	}

	private getAllLeaves(
		parent: unknown
	): import("obsidian").WorkspaceLeaf[] {
		const leaves: import("obsidian").WorkspaceLeaf[] = [];
		const container = parent as { children?: unknown[] };
		if (!container.children) return leaves;
		for (const child of container.children) {
			if ((child as { view?: unknown }).view) {
				leaves.push(child as import("obsidian").WorkspaceLeaf);
			} else {
				leaves.push(...this.getAllLeaves(child));
			}
		}
		return leaves;
	}
}
