import {
	EditorSelection,
	EditorState,
	StateEffect,
	StateField,
	type ChangeSpec,
	type TransactionSpec,
} from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { Tree } from "@lezer/common";
import type { SmartTypographySettings } from "../types";
import type { InputRule } from "./inputRules";
import {
	arrowRules,
	comparisonRules,
	dashRules,
	dashRulesSansEnDash,
	ellipsisRules,
	fractionRules,
	guillemetRules,
	smartQuoteRules,
} from "./inputRules";

export interface SmartTypographyState {
	inputRules: InputRule[];
	inputRuleMap: Record<string, InputRule[]>;
}

export function buildInputRules(
	settings: SmartTypographySettings,
): SmartTypographyState {
	const inputRules: InputRule[] = [];

	if (settings.emDash) {
		if (settings.skipEnDash) {
			inputRules.push(...dashRulesSansEnDash);
		} else {
			inputRules.push(...dashRules);
		}
	}

	if (settings.ellipsis) {
		inputRules.push(...ellipsisRules);
	}

	if (settings.fractions) {
		inputRules.push(...fractionRules);
	}

	if (settings.comparisons) {
		inputRules.push(...comparisonRules);
	}

	if (settings.guillemets) {
		inputRules.push(...guillemetRules);
	}

	if (settings.arrows) {
		inputRules.push(...arrowRules);
	}

	if (settings.curlyQuotes) {
		inputRules.push(...smartQuoteRules);
	}

	const inputRuleMap: Record<string, InputRule[]> = {};
	for (const rule of inputRules) {
		const key = rule.trigger;
		if (!inputRuleMap[key]) inputRuleMap[key] = [];
		inputRuleMap[key].push(rule);
	}

	return { inputRules, inputRuleMap };
}

const IGNORE_LIST_REGEX = /frontmatter|code|math|templater|hashtag/;

export interface SmartTypographyContext {
	getSettings: () => SmartTypographySettings;
	getInputRuleMap: () => Record<string, InputRule[]>;
}

export function createSmartTypographyExtension(
	context: SmartTypographyContext,
): Extension {
	const storeTransaction = StateEffect.define<TransactionSpec | null>();

	const prevTransactionState = StateField.define<TransactionSpec | null>({
		create() {
			return null;
		},
		update(oldVal, tr) {
			for (const e of tr.effects) {
				if (e.is(storeTransaction)) {
					return e.value as TransactionSpec | null;
				}
			}
			if (
				!oldVal ||
				tr.isUserEvent("input") ||
				tr.isUserEvent("delete.forward") ||
				tr.isUserEvent("delete.cut") ||
				tr.isUserEvent("move") ||
				tr.isUserEvent("select") ||
				tr.isUserEvent("undo")
			) {
				return null;
			}
			return oldVal;
		},
	});

	return [
		prevTransactionState,
		EditorState.transactionFilter.of((tr) => {
			if (
				tr.isUserEvent("delete.backward") ||
				tr.isUserEvent("delete.selection")
			) {
				const revert = tr.startState.field(prevTransactionState, false);
				if (revert) return revert;
				return tr;
			}

			if (!tr.isUserEvent("input.type") || !tr.docChanged) {
				return tr;
			}

			const settings = context.getSettings();
			const inputRuleMap = context.getInputRuleMap();

			let tree: Tree | null = null;
			const seenPositions: Record<number, boolean> = {};

			const canPerformReplacement = (pos: number) => {
				if (seenPositions[pos] !== undefined) {
					return seenPositions[pos];
				}
				if (!tree) tree = syntaxTree(tr.state);
				const nodeName = tree.resolveInner(pos, 1).type.name;
				const skip =
					typeof nodeName === "string" &&
					IGNORE_LIST_REGEX.test(nodeName);
				seenPositions[pos] = !skip;
				return seenPositions[pos];
			};

			const changes: ChangeSpec[] = [];
			const reverts: ChangeSpec[] = [];
			const registerChange = (change: ChangeSpec, revert: ChangeSpec) => {
				changes.push(change);
				reverts.push(revert);
			};

			const contextCache: Record<number, string> = {};
			let newSelection: EditorSelection =
				tr.selection ?? tr.startState.selection;

			tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
				const insertedText = inserted.sliceString(0, inserted.length);
				const matchedRules = inputRuleMap[insertedText];
				if (!matchedRules) return;

				for (const rule of matchedRules) {
					if (!canPerformReplacement(fromA)) return;

					if (contextCache[fromB] === undefined) {
						contextCache[fromB] = tr.newDoc.sliceString(
							Math.max(0, fromB - 3),
							fromB,
						);
					}
					const contextStr = contextCache[fromB];
					if (!rule.contextMatch.test(contextStr)) continue;

					const insert =
						typeof rule.to === "string"
							? rule.to
							: rule.to(settings);
					const replacementLength =
						rule.from.length - rule.trigger.length;
					const insertionPoint = fromA - replacementLength;
					const reversionPoint = fromB - replacementLength;

					registerChange(
						{
							from: insertionPoint,
							to: insertionPoint + replacementLength,
							insert,
						},
						{
							from: reversionPoint,
							to: reversionPoint + insert.length,
							insert: rule.from,
						},
					);

					const selectionAdjustment =
						rule.from.length - insert.length;
					const updated = EditorSelection.create(
						newSelection.ranges.map((r) =>
							EditorSelection.range(
								r.anchor - selectionAdjustment,
								r.head - selectionAdjustment,
							),
						),
					);
					if (updated) newSelection = updated;
					return;
				}
			});

			if (changes.length === 0) return tr;

			const revertSpec: TransactionSpec = {
				effects: storeTransaction.of(null),
				selection: tr.selection,
				scrollIntoView: tr.scrollIntoView ?? false,
				changes: reverts,
			};
			return {
				effects: storeTransaction.of(revertSpec),
				selection: newSelection,
				scrollIntoView: tr.scrollIntoView,
				changes,
			};
		}),
	];
}
