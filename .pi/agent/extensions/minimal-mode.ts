import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { basename } from "node:path";

type BuiltInToolName = "read" | "bash" | "edit" | "write" | "find" | "grep" | "ls";

interface CurrentModel {
	id?: string;
	name?: string;
	provider?: string;
}

let currentModelLabel: string | undefined;

function shortenPath(path: string): string {
	const home = homedir();
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function createBuiltInTools(cwd: string) {
	return {
		read: createReadTool(cwd),
		bash: createBashTool(cwd),
		edit: createEditTool(cwd),
		write: createWriteTool(cwd),
		find: createFindTool(cwd),
		grep: createGrepTool(cwd),
		ls: createLsTool(cwd),
	};
}

const toolCache = new Map<string, ReturnType<typeof createBuiltInTools>>();

function getBuiltInTools(cwd: string) {
	let tools = toolCache.get(cwd);
	if (!tools) {
		tools = createBuiltInTools(cwd);
		toolCache.set(cwd, tools);
	}
	return tools;
}

function repoName(cwd: string | undefined): string {
	return basename(cwd || process.cwd()) || ".";
}

function formatModelLabel(model: CurrentModel | undefined): string | undefined {
	if (!model) return undefined;
	const label = model.name || (model.provider && model.id ? `${model.provider}/${model.id}` : model.id);
	return label?.replace(/^OpenRouter\s+/u, "");
}

function formatMakeContext(repo: string, modelLabel: string | undefined): string {
	return modelLabel ? `${repo}, ${modelLabel}` : repo;
}

function shellWords(command: string): string[] {
	return command.match(/(?:[^\s'"\\]+|"(?:\\.|[^"\\])*"|'[^']*')+/g) ?? [];
}

function cleanShellWord(word: string): string {
	if ((word.startsWith("\"") && word.endsWith("\"")) || (word.startsWith("'") && word.endsWith("'"))) {
		return word.slice(1, -1);
	}
	return word.replace(/[;|&]+$/u, "");
}

interface MakeSummary {
	target: string;
	repo?: string;
}

function extractMakeSummary(command: string | undefined): MakeSummary | undefined {
	if (!command) return undefined;
	const words = shellWords(command).map(cleanShellWord);
	const makeIndex = words.findIndex((word) => word === "make" || word.endsWith("/make") || word === "$(MAKE)");
	if (makeIndex === -1) return undefined;

	let repo: string | undefined;
	for (let i = 0; i < makeIndex - 1; i++) {
		if (words[i] === "cd") {
			repo = basename(words[i + 1]) || repo;
		}
	}

	for (let i = makeIndex + 1; i < words.length; i++) {
		const word = words[i];
		if (!word || word.includes("=")) continue;
		if (word === "--") continue;
		if (word === "-f" || word === "--file" || word === "--makefile" || word === "-C" || word === "--directory") {
			if ((word === "-C" || word === "--directory") && words[i + 1]) {
				repo = basename(words[i + 1]) || repo;
			}
			i++;
			continue;
		}
		if (word.startsWith("-f") && word.length > 2) continue;
		if (word.startsWith("-C") && word.length > 2) {
			repo = basename(word.slice(2)) || repo;
			continue;
		}
		if (word.startsWith("-")) continue;
		return { target: word, repo };
	}

	return { target: "run", repo };
}

function formatToolCall(
	name: BuiltInToolName,
	args: Record<string, any>,
	theme: any,
	cwd?: string,
	modelLabel?: string,
): string {
	const title = (text: string) => theme.fg("toolTitle", theme.bold(text));
	const path = (value: string | undefined, fallback = ".") => theme.fg("accent", shortenPath(value || fallback));
	const dim = (value: string) => theme.fg("dim", value);

	switch (name) {
		case "bash": {
			const make = extractMakeSummary(args.command);
			if (make) {
				const context = formatMakeContext(make.repo || repoName(cwd), modelLabel);
				return `${theme.fg("accent", make.target)} ${dim(`(${context})`)}`;
			}
			return `${title("$")} ${theme.fg("accent", args.command || "...")}${args.timeout ? dim(` (${args.timeout}s)`) : ""}`;
		}
		case "read": {
			let suffix = "";
			if (args.offset !== undefined || args.limit !== undefined) {
				const start = args.offset ?? 1;
				const end = args.limit !== undefined ? start + args.limit - 1 : "";
				suffix = theme.fg("warning", `:${start}${end ? `-${end}` : ""}`);
			}
			return `${title("read")} ${path(args.path, "")}${suffix}`;
		}
		case "write": {
			const lines = typeof args.content === "string" ? args.content.split("\n").length : 0;
			return `${title("write")} ${path(args.path, "")}${lines ? dim(` (${lines} lines)`) : ""}`;
		}
		case "edit":
			return `${title("edit")} ${path(args.path, "")}`;
		case "find":
			return `${title("find")} ${theme.fg("accent", args.pattern || "*")} ${dim(`in ${shortenPath(args.path || ".")}`)}`;
		case "grep":
			return `${title("grep")} ${theme.fg("accent", `/${args.pattern || ""}/`)} ${dim(`in ${shortenPath(args.path || ".")}`)}`;
		case "ls":
			return `${title("ls")} ${path(args.path)}`;
	}
}

function renderExpandedResult(result: any, theme: any): Text {
	const textContent = result.content?.find((item: any) => item.type === "text");
	if (!textContent?.text) return new Text("", 0, 0);

	const output = String(textContent.text)
		.replace(/\s+$/u, "")
		.split("\n")
		.map((line) => theme.fg("toolOutput", line))
		.join("\n");

	return new Text(output ? `\n${output}` : "", 0, 0);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		currentModelLabel = formatModelLabel(ctx.model);
	});

	pi.on("model_select", async (event) => {
		currentModelLabel = formatModelLabel(event.model);
	});

	for (const name of ["read", "bash", "edit", "write", "find", "grep", "ls"] as BuiltInToolName[]) {
		const original = getBuiltInTools(process.cwd())[name] as any;

		pi.registerTool({
			name,
			label: name,
			description: original.description,
			parameters: original.parameters,

			async execute(toolCallId, params, signal, onUpdate, ctx) {
				const tool = (getBuiltInTools(ctx.cwd) as any)[name];
				return tool.execute(toolCallId, params, signal, onUpdate);
			},

			renderCall(args, theme, context) {
				return new Text(formatToolCall(name, args, theme, context.cwd, currentModelLabel), 0, 0);
			},

			renderResult(result, { expanded }, theme, _context) {
				if (!expanded) return new Text("", 0, 0);
				return renderExpandedResult(result, theme);
			},
		});
	}
}
