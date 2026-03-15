import { Plugin, Platform } from "obsidian";
import type { QuasarSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { QuasarSettingTab } from "./settings";
import {
	buildInputRules,
	createSmartTypographyExtension,
	type SmartTypographyState,
} from "./typography/extension";

export default class QuasarPlugin extends Plugin {
	settings: QuasarSettings = { ...DEFAULT_SETTINGS };
	private ribbonIconEl: HTMLElement | null = null;
	private ribbonSpacerEl: HTMLElement | null = null;
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

		this.app.workspace.onLayoutReady(() => {
			this.refreshSettingsButton();
			this.openGraphIfEmpty();
		});

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.openGraphIfEmpty();
			})
		);

		this.addSettingTab(new QuasarSettingTab(this.app, this));
	}

	onunload(): void {
		this.ribbonSpacerEl?.remove();
		this.ribbonIconEl?.remove();
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

	refreshSettingsButton(): void {
		this.ribbonSpacerEl?.remove();
		this.ribbonSpacerEl = null;
		this.ribbonIconEl?.remove();
		this.ribbonIconEl = null;
		if (this.settings.showSettingsButton && Platform.isDesktopApp) {
			this.addRibbonSettingsIcon();
		}
	}

	private openGraphIfEmpty(): void {
		if (!Platform.isDesktopApp) return;
		if (!this.settings.defaultGraphView) return;

		const leaves = this.app.workspace.getLeavesOfType("empty");
		if (leaves.length === 0) return;

		const rootLeaves = this.app.workspace.rootSplit
			? this.getAllLeaves(this.app.workspace.rootSplit)
			: [];
		const allEmpty = rootLeaves.length > 0 && rootLeaves.every(
			(l) => l.view?.getViewType() === "empty"
		);
		if (!allEmpty) return;

		const leaf = leaves[0];
		if (leaf) {
			void leaf.setViewState({ type: "graph", active: true });
		}
	}

	private getAllLeaves(parent: unknown): import("obsidian").WorkspaceLeaf[] {
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

	private openSettings(): void {
		(this.app as { setting?: { open: () => void } }).setting?.open();
	}

	private addRibbonSettingsIcon(): void {
		const el = this.addRibbonIcon(
			"settings",
			"Open settings",
			() => this.openSettings()
		);
		el.classList.add("quasar-ribbon-settings");
		// Keep icon inside the visible ribbon-inner; add spacer before it to push to bottom
		const ribbonInner = document.querySelector(".workspace-ribbon.mod-left .workspace-ribbon-inner") as HTMLElement | null;
		if (ribbonInner && el.parentElement === ribbonInner) {
			const spacer = document.createElement("div");
			spacer.classList.add("quasar-ribbon-spacer");
			ribbonInner.insertBefore(spacer, el);
			this.ribbonSpacerEl = spacer;
		}
		this.ribbonIconEl = el;
	}
}
