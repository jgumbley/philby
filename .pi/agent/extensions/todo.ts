import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface Todo {
	id: number;
	text: string;
	done: boolean;
}

interface TodoDetails {
	action: "list" | "add" | "toggle" | "clear";
	todos: Todo[];
	nextId: number;
	error?: string;
}

const TodoParams = Type.Object({
	action: StringEnum(["list", "add", "toggle", "clear"] as const),
	text: Type.Optional(Type.String({ description: "Todo text for add" })),
	id: Type.Optional(Type.Number({ description: "Todo id for toggle" })),
});

class TodoListComponent {
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private todos: Todo[],
		private theme: Theme,
		private onClose: () => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onClose();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const lines: string[] = [];
		const done = this.todos.filter((todo) => todo.done).length;
		const total = this.todos.length;
		const title = this.theme.fg("accent", " todos ");

		lines.push("");
		lines.push(truncateToWidth(this.theme.fg("borderMuted", "---") + title, width));
		lines.push("");

		if (total === 0) {
			lines.push(truncateToWidth(`  ${this.theme.fg("dim", "No todos")}`, width));
		} else {
			lines.push(truncateToWidth(`  ${this.theme.fg("muted", `${done}/${total} complete`)}`, width));
			lines.push("");
			for (const todo of this.todos) {
				const check = todo.done ? this.theme.fg("success", "[x]") : this.theme.fg("dim", "[ ]");
				const id = this.theme.fg("accent", `#${todo.id}`);
				const text = todo.done ? this.theme.fg("dim", todo.text) : this.theme.fg("text", todo.text);
				lines.push(truncateToWidth(`  ${check} ${id} ${text}`, width));
			}
		}

		lines.push("");
		lines.push(truncateToWidth(`  ${this.theme.fg("dim", "Esc closes")}`, width));
		lines.push("");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

export default function (pi: ExtensionAPI) {
	let todos: Todo[] = [];
	let nextId = 1;

	const reconstructState = (ctx: ExtensionContext) => {
		todos = [];
		nextId = 1;

		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const message = entry.message;
			if (message.role !== "toolResult" || message.toolName !== "todo") continue;

			const details = message.details as TodoDetails | undefined;
			if (!details) continue;
			todos = details.todos;
			nextId = details.nextId;
		}
	};

	pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

	pi.registerTool({
		name: "todo",
		label: "todo",
		description: "Manage the current session todo list. Actions: list, add, toggle, clear.",
		parameters: TodoParams,

		async execute(_toolCallId, params) {
			switch (params.action) {
				case "list":
					return {
						content: [{ type: "text" as const, text: todos.length ? formatTodos(todos) : "No todos" }],
						details: { action: "list", todos: [...todos], nextId } as TodoDetails,
					};

				case "add": {
					if (!params.text) {
						return errorResult("add", "text required", todos, nextId);
					}
					const todo = { id: nextId++, text: params.text, done: false };
					todos.push(todo);
					return {
						content: [{ type: "text" as const, text: `Added #${todo.id}: ${todo.text}` }],
						details: { action: "add", todos: [...todos], nextId } as TodoDetails,
					};
				}

				case "toggle": {
					if (params.id === undefined) {
						return errorResult("toggle", "id required", todos, nextId);
					}
					const todo = todos.find((item) => item.id === params.id);
					if (!todo) {
						return errorResult("toggle", `#${params.id} not found`, todos, nextId);
					}
					todo.done = !todo.done;
					return {
						content: [{ type: "text" as const, text: `Todo #${todo.id} ${todo.done ? "done" : "open"}` }],
						details: { action: "toggle", todos: [...todos], nextId } as TodoDetails,
					};
				}

				case "clear": {
					const count = todos.length;
					todos = [];
					nextId = 1;
					return {
						content: [{ type: "text" as const, text: `Cleared ${count} todos` }],
						details: { action: "clear", todos: [], nextId } as TodoDetails,
					};
				}
			}
		},

		renderCall(args, theme) {
			let text = `${theme.fg("toolTitle", theme.bold("todo"))} ${theme.fg("muted", args.action)}`;
			if (args.text) text += ` ${theme.fg("dim", JSON.stringify(args.text))}`;
			if (args.id !== undefined) text += ` ${theme.fg("accent", `#${args.id}`)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as TodoDetails | undefined;
			if (!details) return new Text("", 0, 0);
			if (details.error) return new Text(theme.fg("error", details.error), 0, 0);

			if (details.action === "clear") {
				return new Text(theme.fg("success", "cleared"), 0, 0);
			}
			if (details.action === "add") {
				const added = details.todos[details.todos.length - 1];
				return new Text(added ? `${theme.fg("success", "added")} ${theme.fg("accent", `#${added.id}`)}` : "", 0, 0);
			}
			if (details.action === "toggle") {
				return new Text(theme.fg("success", "updated"), 0, 0);
			}

			if (details.todos.length === 0) return new Text(theme.fg("dim", "No todos"), 0, 0);
			const display = expanded ? details.todos : details.todos.slice(0, 5);
			let text = theme.fg("muted", `${details.todos.length} todo(s)`);
			for (const todo of display) {
				const check = todo.done ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]");
				const itemText = todo.done ? theme.fg("dim", todo.text) : theme.fg("muted", todo.text);
				text += `\n${check} ${theme.fg("accent", `#${todo.id}`)} ${itemText}`;
			}
			if (!expanded && details.todos.length > display.length) {
				text += `\n${theme.fg("dim", `... ${details.todos.length - display.length} more`)}`;
			}
			return new Text(text, 0, 0);
		},
	});

	pi.registerCommand("todos", {
		description: "Show todos for the current branch",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/todos requires interactive mode", "error");
				return;
			}
			await ctx.ui.custom<void>((_tui, theme, _kb, done) => new TodoListComponent(todos, theme, () => done()));
		},
	});
}

function formatTodos(todos: Todo[]): string {
	return todos.map((todo) => `[${todo.done ? "x" : " "}] #${todo.id}: ${todo.text}`).join("\n");
}

function errorResult(action: TodoDetails["action"], error: string, todos: Todo[], nextId: number) {
	return {
		content: [{ type: "text" as const, text: `Error: ${error}` }],
		details: { action, todos: [...todos], nextId, error } as TodoDetails,
	};
}
