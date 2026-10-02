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

export function buildInputRules(
	settings: SmartTypographySettings,
): Record<string, InputRule[]> {
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

	return inputRuleMap;
}

const IGNORE_LIST_REGEX = /frontmatter|code|math|templater|hashtag/;

interface SmartTypographyContext {
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
			if (tr.docChanged) return null;
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
			if (tr.isUserEvent("delete.backward") || tr.isUserEvent("delete.selection")) {
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
					typeof nodeName === "string" && IGNORE_LIST_REGEX.test(nodeName);
				seenPositions[pos] = !skip;
				return seenPositions[pos];
			};

			const contextCache: Record<string, string> = {};
			const readContext = (end: number, length: number): string => {
				const cacheKey = `${end}:${length}`;
				const cached = contextCache[cacheKey];
				if (cached !== undefined) return cached;
				const value = tr.newDoc.sliceString(Math.max(0, end - length), end);
				contextCache[cacheKey] = value;
				return value;
			};

			const changes: ChangeSpec[] = [];
			const reverts: ChangeSpec[] = [];
			const shifts: { pos: number; delta: number }[] = [];
			let netDelta = 0;

			const applyRule = (
				fromA: number,
				toA: number,
				fromB: number,
				insertedText: string,
			): boolean => {
				const matchedRules = inputRuleMap[insertedText];
				if (!matchedRules?.length) return false;
				if (!canPerformReplacement(fromB)) return false;

				for (const rule of matchedRules) {
					const contextLength = Math.max(3, rule.from.length);
					if (!rule.contextMatch.test(readContext(fromB, contextLength))) {
						continue;
					}

					const insert =
						typeof rule.to === "string" ? rule.to : rule.to(settings);
					const replacementLength = rule.from.length - rule.trigger.length;
					const insertionPoint = fromA - replacementLength;
					const reversionPoint = fromB - replacementLength;

					changes.push({
						from: insertionPoint,
						to: toA,
						insert,
					});
					reverts.push({
						from: reversionPoint - netDelta,
						to: reversionPoint - netDelta + insert.length,
						insert: rule.from,
					});

					const delta = rule.from.length - insert.length;
					if (delta !== 0) shifts.push({ pos: reversionPoint, delta });
					netDelta += delta;
					return true;
				}
				return false;
			};

			tr.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
				const insertedText = inserted.sliceString(0, inserted.length);
				if (applyRule(fromA, toA, fromB, insertedText)) return;
				changes.push({ from: fromA, to: toA, insert: inserted });
			});

			if (reverts.length === 0) return tr;

			const shiftPos = (pos: number): number => {
				let shifted = pos;
				for (const shift of shifts) {
					if (shift.pos < pos) shifted -= shift.delta;
				}
				return Math.max(0, shifted);
			};

			const baseSelection = tr.newSelection;
			const newSelection = shifts.length
				? EditorSelection.create(
						baseSelection.ranges.map((r) =>
							EditorSelection.range(shiftPos(r.anchor), shiftPos(r.head)),
						),
						baseSelection.mainIndex,
					)
				: baseSelection;

			const revertSpec: TransactionSpec = {
				effects: storeTransaction.of(null),
				selection: baseSelection,
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
