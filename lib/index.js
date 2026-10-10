import z from "@deepseek-ai/schemastery";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { deepEqualJson } from "@deepseek-ai/dsh-util-values";
import * as llm from "@deepseek-ai/dsh-llm";
import { LlmAdapter, LlmError, ReasoningEffortId, attributionHeaders, contentHasImage } from "@deepseek-ai/dsh-llm";
import { createModels, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
//#region src/catalog.ts
/**
* Resolve OAuth-capable pi-ai catalog providers.
*/
/** Default subscription / OAuth catalog ids this plugin ships. */
const DEFAULT_PROVIDERS = [
	"xai",
	"github-copilot",
	"openai",
	"openai-codex",
	"anthropic",
	"openrouter",
	"kimi-coding"
];
/** Settings / configurable-provider namespace owned by this plugin. */
const SETTINGS_NS = "llm-oauth";
/**
* Every installed catalog provider that declares an OAuth method.
*/
function oauthCatalogProviders() {
	return builtinProviders().filter((provider) => provider.auth.oauth !== void 0);
}
/**
* Resolve configured catalog ids against the installed catalog.
* @param requested - provider ids from plugin config.
* @returns catalog providers in config order.
*/
function resolveOAuthProviders(requested) {
	const catalog = new Map(builtinProviders().map((provider) => [provider.id, provider]));
	const resolved = [];
	for (const id of requested) {
		const provider = catalog.get(id);
		if (provider === void 0) throw new Error(`dsh-llm-oauth: unknown pi-ai catalog provider "${id}"`);
		if (provider.auth.oauth === void 0) throw new Error(`dsh-llm-oauth: provider "${id}" has no OAuth method (GPT subscriptions use "openai" — Sign in with ChatGPT — or the legacy "openai-codex"; pure API-key ids such as "openai"-less gateways stay on the first-party plugin. Run \`node bin/login.mjs --list\` for every OAuth-capable id)`);
		resolved.push(provider);
	}
	if (resolved.length === 0) throw new Error("dsh-llm-oauth: catalog must list at least one OAuth-capable catalog id");
	return resolved;
}
/**
* Human label for a catalog id (falls back to the id).
* @param providerId - pi-ai catalog provider id.
*/
function catalogDisplayName(providerId) {
	return builtinProviders().find((provider) => provider.id === providerId)?.name ?? providerId;
}
//#endregion
//#region src/config.ts
/** Empty enabled-profile object accepted by the settings form. */
const ProviderProfileSchema = z.object({ displayName: z.string() });
/**
* Loader-visible configuration schema.
* Shared by composition entry config and the `llm-oauth` settings section.
*
* `providers` is volatile, so the settings service accepts live enable/disable
* edits to this entry and the Loader swaps the reference in place instead of
* remounting the plugin.
*/
const Config = z.object({
	catalog: z.array(z.string()).default([...DEFAULT_PROVIDERS]),
	providers: z.union([z.dict(ProviderProfileSchema), z.array(z.string())]).default({}).volatile(),
	authPath: z.string()
});
/**
* Read one configuration field's current value; an ordinary value passes
* through unchanged.
* @param value - a parsed field, plain or volatile.
* @returns the current snapshot for a volatile reference.
*/
function readField(value) {
	if (value === void 0 || value === null) return void 0;
	const box = value;
	return typeof box.get === "function" ? box.get() : value;
}
/**
* Project the Loader's configuration onto the plain shape composition input
* uses, so no caller holds a volatile reference between operations.
* @param config - Loader configuration (volatile fields) or plain values.
* @returns plain configuration, detached from the live references.
*/
function readConfig(config = {}) {
	const values = config;
	const catalog = readField(values.catalog);
	const providers = readField(values.providers);
	const authPath = readField(values.authPath);
	return {
		...catalog === void 0 ? {} : { catalog: structuredClone(catalog) },
		...providers === void 0 ? {} : { providers: structuredClone(providers) },
		...authPath === void 0 ? {} : { authPath }
	};
}
/**
* Normalize composition/settings input: legacy `providers: string[]` becomes
* the catalog with nothing enabled (dormant), matching the v0.2 default.
* @param config - partial or legacy configuration.
*/
function resolveConfig(config = {}) {
	const legacyList = Array.isArray(config.providers) ? config.providers : void 0;
	return {
		catalog: config.catalog ?? (legacyList !== void 0 && legacyList.length > 0 ? [...legacyList] : [...DEFAULT_PROVIDERS]),
		providers: legacyList !== void 0 ? {} : config.providers ?? {},
		...config.authPath === void 0 ? {} : { authPath: config.authPath }
	};
}
/** Sorted list of enabled provider route ids. */
function enabledProviderIds(config) {
	const providers = resolveConfig(config).providers;
	return Object.keys(providers).sort((a, b) => a.localeCompare(b));
}
//#endregion
//#region src/context.ts
/**
* Minimal harness → pi-ai context conversion (text, images, tools).
* Image blocks are durable attachment references; the adapter reads their
* request bytes through the host attachment service before conversion.
*/
/** Same defaults as first-party dsh-llm-pi-ai: 2048×2048 pixel budget, 1 MiB encoded. */
const IMAGE_MAX_PIXELS = 4194304;
const IMAGE_MAX_BYTES = 1048576;
function imageTarget(ref) {
	const scale = Math.min(1, Math.sqrt(IMAGE_MAX_PIXELS / (ref.width * ref.height)));
	return {
		width: Math.max(1, Math.floor(ref.width * scale)),
		height: Math.max(1, Math.floor(ref.height * scale)),
		maxBytes: IMAGE_MAX_BYTES
	};
}
/**
* Read request bytes for every non-offloaded image in the request.
* @param messages - request messages.
* @param attachments - host attachment service.
* @param signal - request abort signal.
*/
async function prepareRequestImages(messages, attachments, signal) {
	const refs = /* @__PURE__ */ new Map();
	for (const message of messages) for (const block of message.content) if (block.type === "image" && block.offloaded !== true) {
		const ref = block.attachment;
		refs.set(String(ref.attachmentId), ref);
	}
	const images = /* @__PURE__ */ new Map();
	for (const [id, ref] of refs) images.set(id, await attachments.readImageRequest(ref, imageTarget(ref), signal));
	return images;
}
function imageName(ref) {
	return ref.name ?? String(ref.attachmentId);
}
/** User content: plain string when text-only, else text + image parts. */
function userContent(message, images) {
	if (!contentHasImage(message.content)) return flattenText(message);
	const content = [];
	for (const block of message.content) if (block.type === "text") {
		if (block.text.length > 0) content.push({
			type: "text",
			text: block.text
		});
	} else if (block.type === "image") {
		const ref = block.attachment;
		const image = block.offloaded === true ? void 0 : images?.get(String(ref.attachmentId));
		if (image === void 0) content.push({
			type: "text",
			text: `[image omitted: ${imageName(ref)}]`
		});
		else content.push({
			type: "image",
			data: Buffer.from(image.data).toString("base64"),
			mimeType: image.mediaType
		});
	}
	return content;
}
function flattenText(message) {
	return message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
}
function toolResultText(blocks) {
	return blocks.map((block) => {
		if (block.type === "text") return block.text;
		if (block.type === "tool-result") return toolResultText(block.content);
		return "";
	}).join("");
}
/**
* Parse historical tool arguments into pi-ai's JSON object shape.
* pi-ai >= 1.0.0 types `ToolCall.arguments` as `JsonObject`, so a malformed or
* non-object payload must collapse to `{}` rather than an untyped record.
*/
function parseArguments(raw) {
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed;
	} catch {}
	return {};
}
function emptyUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0
		}
	};
}
function toAssistant(message) {
	if (message.source.kind !== "model") throw new LlmError("Assistant message is missing model provenance", "UNSUPPORTED_CONTENT");
	const content = [];
	for (const block of message.content) if (block.type === "text") content.push({
		type: "text",
		text: block.text
	});
	else if (block.type === "reasoning") content.push({
		type: "thinking",
		thinking: block.text
	});
	else if (block.type === "tool-call") content.push({
		type: "toolCall",
		id: String(block.id),
		name: block.name,
		arguments: parseArguments(block.arguments)
	});
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: message.source.provider,
		model: message.source.model,
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: 0
	};
}
/**
* Convert one assembled harness request into pi-ai's context envelope.
* @param options - fully assembled model request.
* @param images - request image bytes keyed by attachment id (required when images are present).
*/
function toPiContext(options, images) {
	for (const message of options.messages) {
		if ((message.role === "assistant" || message.role === "system") && contentHasImage(message.content)) throw new LlmError(`dsh-llm-oauth cannot send an image in a ${message.role} message`, "UNSUPPORTED_CONTENT");
		if (images === void 0 && message.content.some((b) => b.type === "image" && b.offloaded !== true)) throw new LlmError("dsh-llm-oauth image content requires prepared request images", "UNSUPPORTED_CONTENT");
	}
	const toolNames = /* @__PURE__ */ new Map();
	const messages = [];
	const leading = options.messages[0];
	const systemPrompt = options.system ?? (leading?.role === "system" ? flattenText(leading) || void 0 : void 0);
	const history = options.system === void 0 && leading?.role === "system" ? options.messages.slice(1) : options.messages;
	for (const message of history) {
		if (message.role === "system") {
			messages.push({
				role: "user",
				content: flattenText(message),
				timestamp: 0
			});
			continue;
		}
		if (message.role === "assistant") {
			const assistant = toAssistant(message);
			for (const block of assistant.content) if (block.type === "toolCall") toolNames.set(block.id, block.name);
			messages.push(assistant);
			continue;
		}
		const content = userContent(message, images);
		const results = message.content.filter((block) => block.type === "tool-result");
		if (content.length > 0 || results.length === 0) messages.push({
			role: "user",
			content,
			timestamp: 0
		});
		for (const result of results) messages.push({
			role: "toolResult",
			toolCallId: String(result.toolCallId),
			toolName: toolNames.get(String(result.toolCallId)) ?? "unknown",
			content: [{
				type: "text",
				text: toolResultText(result.content) || "(no output)"
			}],
			isError: result.isError === true,
			timestamp: 0
		});
	}
	const tools = options.tools?.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters
	}));
	return {
		...systemPrompt !== void 0 ? { systemPrompt } : {},
		messages,
		...tools !== void 0 && tools.length > 0 ? { tools } : {}
	};
}
//#endregion
//#region src/stream.ts
/**
* pi-ai assistant event → harness StreamChunk translation.
*/
const ids = llm;
const toolCallId = ids.ToolCallId ?? ids.CallId;
function mapUsage(usage) {
	return {
		inputTokens: usage.input,
		outputTokens: usage.output,
		totalTokens: usage.totalTokens,
		...usage.cacheRead > 0 ? { cacheReadTokens: usage.cacheRead } : {},
		...usage.cacheWrite > 0 ? { cacheWriteTokens: usage.cacheWrite } : {}
	};
}
function mapStopReason(message) {
	switch (message.stopReason) {
		case "stop":
			if (message.content.length === 0) return {
				kind: "error",
				failure: {
					message: `model "${message.model}" returned a completed response with no content`,
					code: "EMPTY_RESPONSE"
				}
			};
			return { kind: "stop" };
		case "length": return { kind: "max-tokens" };
		case "toolUse": return { kind: "tool-calls" };
		case "pending":
		case "deferred": return {
			kind: "error",
			failure: {
				message: `Unsupported terminal pi-ai state: ${message.stopReason}`,
				code: "PI_AI_ERROR"
			}
		};
		case "aborted": return {
			kind: "aborted",
			failure: {
				message: message.errorMessage ?? "pi-ai stream aborted",
				code: "ABORTED"
			}
		};
		case "error": return {
			kind: "error",
			failure: {
				message: message.errorMessage ?? "pi-ai stream error",
				code: "PI_AI_ERROR"
			}
		};
	}
}
/**
* Translate one pi-ai event stream into harness StreamChunks.
* @param events - one assistant turn's pi-ai event stream.
*/
async function* toStreamChunks(events) {
	const toolIds = /* @__PURE__ */ new Map();
	for await (const event of events) switch (event.type) {
		case "start": break;
		case "text_start":
			yield {
				type: "block-start",
				index: event.contentIndex,
				blockType: "text"
			};
			break;
		case "text_delta":
			yield {
				type: "text-delta",
				index: event.contentIndex,
				text: event.delta
			};
			break;
		case "text_end":
			yield {
				type: "block-end",
				index: event.contentIndex,
				block: {
					type: "text",
					text: event.content
				}
			};
			break;
		case "thinking_start":
			yield {
				type: "block-start",
				index: event.contentIndex,
				blockType: "reasoning"
			};
			break;
		case "thinking_delta":
			yield {
				type: "reasoning-delta",
				index: event.contentIndex,
				text: event.delta
			};
			break;
		case "thinking_end":
			yield {
				type: "block-end",
				index: event.contentIndex,
				block: {
					type: "reasoning",
					text: event.content
				}
			};
			break;
		case "toolcall_start": {
			const partial = event.partial.content[event.contentIndex];
			const id = partial?.type === "toolCall" ? partial.id : "";
			const name = partial?.type === "toolCall" ? partial.name : "";
			toolIds.set(event.contentIndex, {
				id,
				name
			});
			yield {
				type: "block-start",
				index: event.contentIndex,
				blockType: "tool-call"
			};
			break;
		}
		case "toolcall_delta": {
			const known = toolIds.get(event.contentIndex);
			yield {
				type: "tool-call-delta",
				index: event.contentIndex,
				id: toolCallId(known?.id ?? ""),
				...known?.name ? { name: known.name } : {},
				argumentsDelta: event.delta
			};
			break;
		}
		case "toolcall_end":
			yield {
				type: "block-end",
				index: event.contentIndex,
				block: {
					type: "tool-call",
					id: toolCallId(event.toolCall.id),
					name: event.toolCall.name,
					arguments: JSON.stringify(event.toolCall.arguments)
				}
			};
			break;
		case "done":
			yield {
				type: "usage",
				usage: mapUsage(event.message.usage)
			};
			yield {
				type: "finish",
				reason: mapStopReason(event.message)
			};
			return;
		case "error":
			yield {
				type: "usage",
				usage: mapUsage(event.error.usage)
			};
			yield {
				type: "finish",
				reason: mapStopReason(event.error)
			};
			return;
	}
	throw new LlmError("pi-ai event stream ended without done/error", "STREAM_CLOSED");
}
//#endregion
//#region bin/device-id.mjs
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Share a durable installation ID between the host adapter and login CLI. */
async function getDeviceId(authPath) {
	const path = `${authPath}.device-id`;
	const read = async () => {
		const value = (await readFile(path, "utf8")).trim();
		if (!UUID.test(value)) throw new Error(`Invalid OAuth device ID in ${path}`);
		return value;
	};
	try {
		return await read();
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	await mkdir(dirname(path), { recursive: true });
	const value = randomUUID();
	const temporary = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporary, `${value}\n`, {
		flag: "wx",
		mode: 384
	});
	try {
		try {
			await link(temporary, path);
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
		}
	} finally {
		await unlink(temporary);
	}
	return await read();
}
//#endregion
//#region src/adapter.ts
/**
* OAuth-aware pi-ai LlmAdapter.
*
* Unlike first-party dsh-llm-pi-ai, Models is constructed with a CredentialStore
* so streamSimple can refresh subscription tokens under the store lock.
*
* The adapter always knows the full OAuth catalog (login/status/listModels for
* owned routes). Which routes are *registered* with `ctx.llm` is decided by
* the runtime from the enabled settings profiles — dormant providers stay off
* the model picker until the user turns them on.
*/
/** OAuth-backed multi-provider adapter. */
var OAuthPiAiAdapter = class extends LlmAdapter {
	options;
	providers;
	models;
	byId;
	constructor(options) {
		super();
		this.options = options;
		this.providers = resolveOAuthProviders(options.catalog);
		const mutable = createModels({ credentials: options.store });
		for (const provider of this.providers) mutable.setProvider(provider);
		this.models = mutable;
		this.byId = new Map(this.providers.map((provider) => [provider.id, provider]));
	}
	/** Full catalog route ids (settings directory), not only registered ones. */
	catalogIds() {
		return this.providers.map((provider) => provider.id);
	}
	/**
	* @deprecated Use {@link catalogIds}. Kept for older command helpers.
	* @returns full catalog route ids.
	*/
	routeIds() {
		return this.catalogIds();
	}
	/** Shared Models collection (login/logout/status). */
	modelsApi() {
		return this.models;
	}
	/** Durable auth file path. */
	authPath() {
		return this.options.authPath;
	}
	/** Catalog display name for a route id. */
	displayName(provider) {
		return this.byId.get(provider)?.name ?? provider;
	}
	providerInfo(provider) {
		const entry = this.byId.get(provider);
		if (entry === void 0) return {
			id: provider,
			name: provider
		};
		return {
			id: entry.id,
			name: entry.name
		};
	}
	listModels(provider) {
		return Promise.resolve().then(() => {
			this.requireProvider(provider);
			return this.models.getModels(provider).map((model) => ({
				provider,
				id: model.id,
				name: model.name,
				inputModalities: [...model.input]
			}));
		});
	}
	resolveModel(provider, model, _signal) {
		return Promise.resolve().then(() => {
			const resolved = this.requireModel(provider, model);
			const levels = getSupportedThinkingLevels(resolved);
			const reasoning = levels.length > 0 && !(levels.length === 1 && levels[0] === "off") ? { efforts: levels.map((level) => ({
				id: ReasoningEffortId(level),
				name: level
			})) } : void 0;
			return {
				provider,
				id: model,
				name: resolved.name,
				inputModalities: [...resolved.input],
				context: { contextWindow: resolved.contextWindow },
				...reasoning === void 0 ? {} : { reasoning }
			};
		});
	}
	/**
	* Run an interactive OAuth login and persist the credential.
	* @param provider - catalog provider id.
	* @param interaction - prompt/notify callbacks.
	*/
	async login(provider, interaction) {
		this.requireProvider(provider);
		const deviceId = provider === "openai" ? await getDeviceId(this.options.authPath) : void 0;
		return this.models.login(provider, "oauth", interaction, deviceId === void 0 ? void 0 : { getDeviceId: () => deviceId });
	}
	/** Drop the stored credential for one provider. */
	logout(provider) {
		this.requireProvider(provider);
		return this.models.logout(provider);
	}
	/** Whether the provider currently has complete auth configuration. */
	checkAuth(provider) {
		this.requireProvider(provider);
		return this.models.checkAuth(provider);
	}
	async *stream(options) {
		if (options.stop !== void 0) throw new LlmError("dsh-llm-oauth does not support GenerateOptions.stop", "UNSUPPORTED_OPTION");
		const model = this.requireModel(options.provider, options.model);
		const effort = options.reasoningEffort;
		const reasoning = effort === void 0 ? void 0 : getSupportedThinkingLevels(model).find((level) => level === effort);
		if (effort !== void 0 && reasoning === void 0) throw new LlmError(`Model "${model.id}" does not support reasoning effort "${effort}"`, "UNSUPPORTED_REASONING_EFFORT");
		if (await this.models.checkAuth(options.provider) === void 0) throw new LlmError(`dsh-llm-oauth: provider "${options.provider}" is not logged in; run \`/oauth login ${options.provider}\` or use Settings → OAuth / 订阅`, "MISSING_CREDENTIAL");
		const containsImage = options.messages.some((message) => contentHasImage(message.content));
		if (containsImage && !model.input.includes("image")) throw new LlmError(`Model "${model.id}" does not support image input`, "UNSUPPORTED_CONTENT");
		const attachments = containsImage ? this.options.resolveAttachments?.() : void 0;
		if (containsImage && attachments === void 0) throw new LlmError("dsh-llm-oauth image input requires the host attachment service", "UNSUPPORTED_CONTENT");
		const context = toPiContext(options, attachments === void 0 ? void 0 : await prepareRequestImages(options.messages, attachments, options.signal));
		yield* toStreamChunks(this.models.streamSimple(model, context, {
			maxRetries: 0,
			...reasoning === void 0 || reasoning === "off" ? {} : { reasoning },
			...options.temperature === void 0 ? {} : { temperature: options.temperature },
			...options.maxTokens === void 0 ? {} : { maxTokens: options.maxTokens },
			...options.sessionId === void 0 ? {} : { sessionId: String(options.sessionId) },
			...options.signal === void 0 ? {} : { signal: options.signal },
			headers: attributionHeaders()
		}));
	}
	requireProvider(provider) {
		const entry = this.byId.get(provider);
		if (entry === void 0) throw new LlmError(`dsh-llm-oauth does not own provider "${provider}"`, "NO_ADAPTER");
		return entry;
	}
	requireModel(provider, model) {
		this.requireProvider(provider);
		const resolved = this.models.getModel(provider, model);
		if (resolved === void 0) throw new LlmError(`dsh-llm-oauth provider "${provider}" has no catalog model "${model}"`, "UNKNOWN_MODEL");
		return resolved;
	}
};
//#endregion
//#region src/command.ts
const watches = /* @__PURE__ */ new Map();
const sessions = /* @__PURE__ */ new Map();
/** Resolvers for prompts awaiting a pasted value, keyed by provider id. */
const pendingPrompts = /* @__PURE__ */ new Map();
/** Stop a provider's background login before removing its credentials. */
async function cancelLogin(provider) {
	const session = sessions.get(provider);
	const watch = watches.get(provider);
	session?.abort.abort(/* @__PURE__ */ new Error("OAuth login cancelled"));
	await session?.finished;
	if (watches.get(provider) === watch) watches.delete(provider);
}
/**
* Answer the prompt a background login is waiting on — the value pi-ai asks for
* when a browser callback cannot complete (Sign in with ChatGPT on a remote
* Web UI, or a busy :1455 callback port).
* @param provider - provider id whose login is waiting.
* @param value - pasted final redirect URL or authorization code.
* @returns whether a waiting prompt consumed the value.
*/
function submitLoginCode(provider, value) {
	const pending = pendingPrompts.get(provider);
	if (pending === void 0) return false;
	const trimmed = value.trim();
	if (trimmed.length === 0) return false;
	pendingPrompts.delete(provider);
	const watch = watches.get(provider);
	if (watch !== void 0) {
		delete watch.prompt;
		watch.lines.push("Submitted the pasted value; finishing the sign-in…");
	}
	pending.resolve(trimmed);
	return true;
}
/** Snapshot of background login watches (for tests and `/oauth status`). */
function listLoginWatches() {
	return [...watches.values()];
}
function usageText(authPath) {
	return [
		"Usage:",
		"  /oauth status",
		"  /oauth list",
		"  /oauth enable <provider>",
		"  /oauth disable <provider>",
		"  /oauth login <provider>",
		"  /oauth code <provider> <redirect-url-or-code>",
		"  /oauth logout <provider>",
		"",
		`Auth file: ${authPath}`,
		"",
		"Notes:",
		"  - Only enabled providers appear in the model picker.",
		"  - login auto-enables the provider when settings are available.",
		"  - GPT subscriptions: \"openai\" is Sign in with ChatGPT (pi-ai >= 1.0.0);",
		"    \"openai-codex\" is the legacy device-code flow for the Codex models.",
		"  - Grok is provider id \"xai\".",
		"  - Do not also configure the same provider id under llm-pi-ai (DUPLICATE_ADAPTER):",
		"    an id one adapter already owns is refused here with a clear error.",
		"  - Prefer Settings → OAuth / 订阅 for status + enable toggles."
	].join("\n");
}
function formatEvent(event) {
	switch (event.type) {
		case "auth_url": return [`Open this URL:\n${event.url ?? ""}`, ...event.instructions ? [event.instructions] : []];
		case "device_code": return [`Open this URL:\n${event.verificationUri ?? ""}`, `Enter code: ${event.userCode ?? ""}`];
		case "info":
		case "progress": return event.message ? [event.message] : [];
		default: return [];
	}
}
function isLoginNotice(type) {
	return type === "device_code" || type === "auth_url";
}
/**
* Choose a non-interactive answer for a select prompt.
* Prefer device-code / headless options when present (Web has no local
* OAuth callback port for browser login).
*/
function pickSelectOption(provider, options) {
	const byId = (id) => options.find((option) => option.id === id);
	if (provider === "openai-codex") {
		const device = byId("device_code");
		if (device !== void 0) return device;
	}
	const headless = options.find((option) => /device[_-]?code|headless|cli/i.test(`${option.id} ${option.label} ${option.description ?? ""}`));
	if (headless !== void 0) return headless;
	return options[0];
}
/**
* Answer a text prompt without a terminal when a blank / default is valid.
* github-copilot asks for Enterprise URL with blank = github.com.
*/
function answerOptionalTextPrompt(provider, prompt) {
	if (prompt.type !== "text") return void 0;
	const blob = `${prompt.message} ${prompt.placeholder ?? ""}`.toLowerCase();
	if (provider === "github-copilot" || /enterprise|blank for github\.com|github\.com/i.test(blob)) return "";
	if (/\bblank\b|\boptional\b|\bleave empty\b|\(empty\)/i.test(blob)) return "";
}
function resultExtras(watch) {
	return {
		...watch.openUrl === void 0 ? {} : { openUrl: watch.openUrl },
		...watch.userCode === void 0 ? {} : { userCode: watch.userCode }
	};
}
function waitingText(watch) {
	return [
		...watch.lines,
		"",
		`Finish signing in to ${watch.provider} in the browser.`,
		...watch.prompt === void 0 ? [] : [`If the browser callback cannot reach this machine, paste the value it asks for (${watch.prompt.message}) in Settings → OAuth / 订阅, or run:`, `  /oauth code ${watch.provider} <redirect-url-or-code>`],
		"This command has returned so the UI is not stuck; the login continues in the background.",
		"When you are done, run /oauth status or refresh Settings → OAuth / 订阅."
	].join("\n");
}
/**
* Start OAuth and return as soon as the user has something to open.
* The device-code poll is not bound to the command AbortSignal — the Web
* request ends when this handler returns, and aborting it would cancel login.
*/
async function startLogin(adapter, provider, signal) {
	if (signal?.aborted) return {
		kind: "error",
		text: "oauth login cancelled before the provider returned a URL"
	};
	const existing = watches.get(provider);
	if (existing?.status === "waiting") return {
		kind: "success",
		text: waitingText(existing),
		...resultExtras(existing)
	};
	const lines = [];
	const watch = {
		provider,
		status: "waiting",
		lines
	};
	watches.set(provider, watch);
	const session = {
		watch,
		abort: new AbortController()
	};
	sessions.set(provider, session);
	let released = false;
	let release;
	const firstNotice = new Promise((resolve, reject) => {
		release = (error) => {
			if (released) return;
			released = true;
			if (error === void 0) resolve();
			else reject(error);
		};
	});
	const onAbort = () => {
		const error = /* @__PURE__ */ new Error("oauth login cancelled before the provider returned a URL");
		session.abort.abort(error);
		release(error);
	};
	signal?.addEventListener("abort", onAbort, { once: true });
	const interaction = {
		signal: session.abort.signal,
		prompt: async (prompt) => {
			const promptSignal = prompt.signal === void 0 ? session.abort.signal : AbortSignal.any([session.abort.signal, prompt.signal]);
			promptSignal.throwIfAborted();
			if (prompt.type === "select" && prompt.options !== void 0 && prompt.options.length > 0) {
				const preferred = pickSelectOption(provider, prompt.options);
				lines.push(`${prompt.message} → ${preferred.label} (${preferred.id})`);
				return preferred.id;
			}
			const optionalText = answerOptionalTextPrompt(provider, prompt);
			if (optionalText !== void 0) {
				lines.push(optionalText.length === 0 ? `${prompt.message} → (default / blank)` : `${prompt.message} → ${optionalText}`);
				return optionalText;
			}
			watch.prompt = {
				type: prompt.type,
				message: prompt.message,
				...prompt.placeholder === void 0 ? {} : { placeholder: prompt.placeholder }
			};
			lines.push(`${prompt.message}${prompt.placeholder === void 0 ? "" : ` (${prompt.placeholder})`}`);
			return await new Promise((resolve, reject) => {
				const cleanup = () => {
					promptSignal.removeEventListener("abort", onPromptAbort);
					if (pendingPrompts.get(provider) === pending) {
						pendingPrompts.delete(provider);
						delete watch.prompt;
					}
				};
				const onPromptAbort = () => {
					cleanup();
					reject(promptSignal.reason);
				};
				const pending = {
					watch,
					resolve: (value) => {
						cleanup();
						resolve(value);
					}
				};
				pendingPrompts.set(provider, pending);
				promptSignal.addEventListener("abort", onPromptAbort, { once: true });
				release();
			});
		},
		notify: (event) => {
			lines.push(...formatEvent(event));
			if (event.type === "auth_url" && event.url) watch.openUrl = event.url;
			if (event.type === "device_code") {
				if (event.verificationUri) watch.openUrl = event.verificationUri;
				if (event.userCode) watch.userCode = event.userCode;
			}
			if (isLoginNotice(event.type)) release();
		}
	};
	session.finished = Promise.resolve().then(() => adapter.login(provider, interaction)).then(() => {
		watch.status = "ok";
		watch.detail = `Logged in to ${provider}. Tokens stored in ${adapter.authPath()}.`;
		release();
	}, (error) => {
		watch.status = "error";
		watch.detail = error instanceof Error ? error.message : String(error);
		release(error instanceof Error ? error : new Error(watch.detail));
	}).finally(() => {
		if (pendingPrompts.get(provider)?.watch === watch) pendingPrompts.delete(provider);
		delete watch.prompt;
		if (sessions.get(provider) === session) sessions.delete(provider);
	});
	try {
		await firstNotice;
	} catch (error) {
		signal?.removeEventListener("abort", onAbort);
		return {
			kind: "error",
			text: [watch.detail ?? (error instanceof Error ? error.message : String(error)), ...lines].join("\n"),
			...resultExtras(watch)
		};
	}
	signal?.removeEventListener("abort", onAbort);
	if (watch.status === "ok") return {
		kind: "success",
		text: watch.detail ?? `Logged in to ${provider}.`,
		...resultExtras(watch)
	};
	return {
		kind: "success",
		text: waitingText(watch),
		...resultExtras(watch)
	};
}
/**
* Execute `/oauth` against the live adapter.
* @param adapter - registered OAuth adapter.
* @param rawInput - text after the command name.
* @param signal - UI request cancellation; only aborts waiting for the first URL.
*/
async function handleOauthCommand(adapter, rawInput, signal) {
	const parts = rawInput.trim().split(/\s+/).filter(Boolean);
	const action = (parts[0] ?? "status").toLowerCase();
	const target = parts[1];
	const catalog = typeof adapter.catalogIds === "function" ? adapter.catalogIds() : adapter.routeIds();
	if (action === "help" || action === "-h" || action === "--help") return {
		kind: "success",
		text: usageText(adapter.authPath())
	};
	if (action === "list") {
		const rows = ["OAuth catalog owned by this plugin:"];
		for (const id of catalog) {
			const auth = await adapter.checkAuth(id);
			rows.push(`  ${id.padEnd(20)} ${auth === void 0 ? "not logged in" : `${auth.type}${auth.source ? ` (${auth.source})` : ""}`}`);
		}
		rows.push("", "Enable a provider with `/oauth enable <id>` or Settings → OAuth / 订阅.");
		return {
			kind: "success",
			text: rows.join("\n")
		};
	}
	if (action === "code") {
		if (target === void 0) return {
			kind: "error",
			text: "Usage: /oauth code <provider> <redirect-url-or-code>"
		};
		const value = parts.slice(2).join(" ");
		if (value.length === 0) return {
			kind: "error",
			text: "Usage: /oauth code <provider> <redirect-url-or-code>"
		};
		if (!submitLoginCode(target, value)) return {
			kind: "error",
			text: `${target} is not waiting for a pasted value. Start /oauth login ${target} first.`
		};
		return {
			kind: "success",
			text: `Submitted the value for ${target}; the sign-in continues in the background. Run /oauth status or refresh Settings → OAuth / 订阅.`
		};
	}
	if (action === "status") {
		const rows = [`Auth file: ${adapter.authPath()}`, ""];
		for (const id of catalog) {
			const auth = await adapter.checkAuth(id);
			const watch = watches.get(id);
			const login = auth === void 0 ? "not logged in" : `ok (${auth.type}${auth.source ? `, ${auth.source}` : ""})`;
			const extra = watch === void 0 ? "" : watch.status === "waiting" ? " — browser login in progress" : watch.status === "error" ? ` — last login error: ${watch.detail ?? "failed"}` : " — last login finished";
			rows.push(`${id}: ${login}${extra}`);
		}
		rows.push("", "Tip: only enabled providers list models. Use /oauth enable <id> or the Settings panel.");
		return {
			kind: "success",
			text: rows.join("\n")
		};
	}
	if (action === "logout") {
		if (target === void 0) return {
			kind: "error",
			text: "Usage: /oauth logout <provider>"
		};
		try {
			await cancelLogin(target);
			await adapter.logout(target);
			return {
				kind: "success",
				text: `Logged out ${target}.`
			};
		} catch (error) {
			return {
				kind: "error",
				text: error instanceof Error ? error.message : String(error)
			};
		}
	}
	if (action === "login") {
		if (target === void 0) return {
			kind: "error",
			text: "Usage: /oauth login <provider>"
		};
		return startLogin(adapter, target, signal);
	}
	if (action === "enable" || action === "disable") return {
		kind: "error",
		text: `/${action} is handled by the plugin runtime. If you see this, settings may be unavailable.\n\n${usageText(adapter.authPath())}`
	};
	return {
		kind: "error",
		text: `Unknown action "${action}".\n\n${usageText(adapter.authPath())}`
	};
}
/** Environment override for the Harness home. */
const DSH_HOME_ENV = "DSH_HOME";
/**
* Expand `~` / `~/` prefixes.
* @param path - configured path that may begin with a tilde.
*/
function expandHomePath(path) {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return path;
}
/**
* Resolve the Harness home.
* Precedence: explicit path, `$DSH_HOME`, then `~/.dsh`.
* @param configured - explicit override.
* @param env - environment mapping.
*/
function resolveDshHome(configured, env = process.env) {
	const fromEnv = env[DSH_HOME_ENV];
	const selected = configured ?? (fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), ".dsh"));
	return resolve(expandHomePath(selected));
}
/**
* Default path of the durable OAuth credential file.
* @param configuredHome - optional explicit Harness home.
*/
function defaultAuthPath(configuredHome) {
	return join(resolveDshHome(configuredHome), "pi-ai-oauth.json");
}
//#endregion
//#region src/http.ts
const API_PREFIX = "/dsh-llm-oauth";
/** JSON helper. */
function sendJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(payload);
}
/** Read a small JSON object body. */
async function readJson(req) {
	const chunks = [];
	for await (const chunk of req) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
		if (chunks.reduce((sum, part) => sum + part.length, 0) > 64e3) throw new Error("request body too large");
	}
	if (chunks.length === 0) return {};
	const raw = Buffer.concat(chunks).toString("utf8").trim();
	if (raw.length === 0) return {};
	const parsed = JSON.parse(raw);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("JSON body must be an object");
	return parsed;
}
function providerOf(body, url) {
	const fromQuery = url.searchParams.get("provider");
	if (fromQuery !== null && fromQuery.length > 0) return fromQuery;
	const value = body.provider;
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
/**
* Handle one request under `/dsh-llm-oauth`.
* @param controller - OAuth control plane.
* @param req - incoming request.
* @param res - server response.
*/
async function handleOauthHttp(controller, req, res) {
	const method = (req.method ?? "GET").toUpperCase();
	const host = req.headers.host ?? "127.0.0.1";
	const url = new URL(req.url ?? "/", `http://${host}`);
	const path = url.pathname.replace(/\/+$/, "") || "/";
	try {
		if (method === "GET" && (path === API_PREFIX || path === `${API_PREFIX}/status`)) {
			sendJson(res, 200, await controller.status());
			return;
		}
		if (method === "POST" && path === `${API_PREFIX}/enable`) {
			const provider = providerOf(await readJson(req), url);
			if (provider === void 0) {
				sendJson(res, 400, { error: "missing provider" });
				return;
			}
			await controller.enable(provider);
			sendJson(res, 200, await controller.status());
			return;
		}
		if (method === "POST" && path === `${API_PREFIX}/disable`) {
			const provider = providerOf(await readJson(req), url);
			if (provider === void 0) {
				sendJson(res, 400, { error: "missing provider" });
				return;
			}
			await controller.disable(provider);
			sendJson(res, 200, await controller.status());
			return;
		}
		if (method === "POST" && path === `${API_PREFIX}/code`) {
			const body = await readJson(req);
			const provider = providerOf(body, url);
			const value = typeof body.code === "string" ? body.code : typeof body.value === "string" ? body.value : void 0;
			if (provider === void 0 || value === void 0 || value.trim().length === 0) {
				sendJson(res, 400, { error: "missing provider or code" });
				return;
			}
			controller.submitCode(provider, value);
			sendJson(res, 200, {
				...await controller.status(),
				command: {
					kind: "success",
					text: `Submitted the value for ${provider}; the sign-in continues in the background.`
				}
			});
			return;
		}
		if (method === "POST" && path === `${API_PREFIX}/logout`) {
			const provider = providerOf(await readJson(req), url);
			if (provider === void 0) {
				sendJson(res, 400, { error: "missing provider" });
				return;
			}
			await controller.logout(provider);
			sendJson(res, 200, await controller.status());
			return;
		}
		if (method === "POST" && path === `${API_PREFIX}/login`) {
			const provider = providerOf(await readJson(req), url);
			if (provider === void 0) {
				sendJson(res, 400, { error: "missing provider" });
				return;
			}
			await controller.enable(provider);
			const result = await handleOauthCommand(controller.getAdapter(), `login ${provider}`);
			const status = await controller.status();
			sendJson(res, result.kind === "error" ? 400 : 200, {
				...status,
				command: result
			});
			return;
		}
		sendJson(res, 404, { error: `unknown route ${path}` });
	} catch (error) {
		sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
	}
}
/** Exact path registered on webServer. */
const OAUTH_HTTP_PREFIX = API_PREFIX;
//#endregion
//#region src/service.ts
/**
* Control plane for OAuth providers.
* @param adapter - live OAuth adapter (full catalog).
* @param hooks - enable/disable integration with the runtime.
*/
var OAuthController = class {
	adapter;
	hooks;
	constructor(adapter, hooks) {
		this.adapter = adapter;
		this.hooks = hooks;
	}
	/** Catalog ids the adapter owns. */
	catalog() {
		return this.adapter.catalogIds();
	}
	/** Currently enabled route ids. */
	enabled() {
		return [...this.hooks.listEnabled()];
	}
	/**
	* Build a status snapshot for UIs.
	* @returns auth path, catalog, enabled set, and per-provider rows.
	*/
	async status() {
		const catalog = this.adapter.catalogIds();
		const enabled = new Set(this.hooks.listEnabled());
		const watches = new Map(listLoginWatches().map((watch) => [watch.provider, watch]));
		const providers = [];
		for (const id of catalog) {
			const auth = await this.adapter.checkAuth(id);
			const watch = watches.get(id);
			providers.push(statusRow(id, this.adapter.displayName(id), enabled.has(id), auth, watch));
		}
		return {
			authPath: this.adapter.authPath(),
			catalog,
			enabled: [...enabled].sort((a, b) => a.localeCompare(b)),
			providers
		};
	}
	/**
	* Enable a catalog provider (show its models once logged in).
	* @param provider - catalog id.
	*/
	async enable(provider) {
		this.requireCatalog(provider);
		await this.hooks.enable(provider);
	}
	/**
	* Disable a catalog provider (hide its models; credentials are kept).
	* @param provider - catalog id.
	*/
	async disable(provider) {
		this.requireCatalog(provider);
		await this.hooks.disable(provider);
	}
	/**
	* Drop stored credentials. Does not change the enabled flag.
	* @param provider - catalog id.
	*/
	async logout(provider) {
		this.requireCatalog(provider);
		await cancelLogin(provider);
		await this.adapter.logout(provider);
	}
	/**
	* Answer the value a running login waits for (pi-ai `manual_code`: the final
	* redirect URL / authorization code a callback flow could not deliver).
	* @param provider - catalog id.
	* @param value - pasted redirect URL or code.
	* @throws when no login of that provider is waiting for a value.
	*/
	submitCode(provider, value) {
		this.requireCatalog(provider);
		if (!submitLoginCode(provider, value)) throw new Error(`dsh-llm-oauth: ${provider} is not waiting for a pasted value; start the sign-in first`);
	}
	/** Underlying adapter (login helper / commands). */
	getAdapter() {
		return this.adapter;
	}
	requireCatalog(provider) {
		if (!this.adapter.catalogIds().includes(provider)) throw new Error(`dsh-llm-oauth: unknown catalog provider "${provider}"`);
	}
};
function statusRow(id, name, enabled, auth, watch) {
	return {
		id,
		name: name || catalogDisplayName(id),
		enabled,
		loggedIn: auth !== void 0,
		...auth === void 0 ? {} : {
			authType: auth.type,
			...auth.source === void 0 ? {} : { authSource: auth.source }
		},
		...watch === void 0 ? {} : {
			loginStatus: watch.status,
			...watch.detail === void 0 ? {} : { loginDetail: watch.detail },
			...watch.prompt === void 0 ? {} : { loginPrompt: watch.prompt }
		}
	};
}
//#endregion
//#region src/store.ts
/**
* Durable pi-ai CredentialStore under the Harness home.
* One credential per provider id; writes are serialized per provider so a
* refresh and a concurrent login cannot clobber each other.
*/
/** File-backed credential store compatible with pi-ai Models OAuth refresh. */
var FileCredentialStore = class {
	path;
	chains = /* @__PURE__ */ new Map();
	cache;
	/**
	* @param path - absolute path of the JSON credential document.
	*/
	constructor(path = defaultAuthPath()) {
		this.path = path;
	}
	async load() {
		if (this.cache !== void 0) return this.cache;
		try {
			const raw = await readFile(this.path, "utf8");
			const parsed = JSON.parse(raw);
			this.cache = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			this.cache = {};
		}
		return this.cache;
	}
	async save(next) {
		this.cache = next;
		await mkdir(dirname(this.path), { recursive: true });
		await writeFile(this.path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	}
	enqueue(providerId, task) {
		const run = (this.chains.get(providerId) ?? Promise.resolve()).catch(() => void 0).then(task);
		this.chains.set(providerId, run.then(() => void 0, () => void 0));
		return run;
	}
	async read(providerId) {
		return (await this.load())[providerId];
	}
	async list() {
		const file = await this.load();
		return Object.entries(file).map(([providerId, credential]) => ({
			providerId,
			type: credential.type
		}));
	}
	modify(providerId, fn) {
		return this.enqueue(providerId, async () => {
			const file = { ...await this.load() };
			const next = await fn(file[providerId]);
			if (next === void 0) return file[providerId];
			file[providerId] = next;
			await this.save(file);
			return next;
		});
	}
	delete(providerId) {
		return this.enqueue(providerId, async () => {
			const file = { ...await this.load() };
			if (file[providerId] === void 0) return;
			delete file[providerId];
			await this.save(file);
		});
	}
};
//#endregion
//#region src/runtime.ts
const NS = SETTINGS_NS;
/**
* Apply the plugin to its Cordis context.
* @param ctx - scoped plugin context; registrations are effects.
* @param config - configuration resolved by Cordis from the exported schema.
*/
function apply(ctx, config) {
	const entry = resolveConfig(readConfig(config));
	resolveOAuthProviders(entry.catalog);
	const authPath = entry.authPath ?? defaultAuthPath();
	const adapter = new OAuthPiAiAdapter({
		authPath,
		store: new FileCredentialStore(authPath),
		catalog: entry.catalog,
		resolveAttachments: () => ctx.get("attachments")
	});
	let registration;
	let registeredRoutes = [];
	let directory;
	let directoryFacts;
	/**
	* The live configuration. `config.providers` is a volatile reference, so
	* every operation reads the value the Loader committed last — a settings
	* write reaches the adapter without a remount.
	*/
	const snapshot = () => resolveConfig(readConfig(config));
	const catalogIds = () => snapshot().catalog;
	const enabledIds = () => {
		const allowed = new Set(catalogIds());
		return enabledProviderIds(snapshot()).filter((id) => allowed.has(id));
	};
	/**
	* Models settings rows for providers the user turned on. Dormant catalog
	* entries stay off this directory (and off the model picker) until enabled
	* via Settings → OAuth / 订阅 or `/oauth enable|login`.
	*/
	const directoryEntries = () => {
		const profiles = snapshot().providers;
		return enabledIds().map((provider) => {
			return {
				provider,
				displayName: profiles[provider]?.displayName?.trim() || catalogDisplayName(provider) || provider,
				settingsNs: SETTINGS_NS,
				settingsPath: ["providers", provider]
			};
		});
	};
	const ensureDirectory = () => {
		const entries = directoryEntries();
		if (deepEqualJson(entries, directoryFacts)) return;
		if (directory === void 0) {
			if (entries.length === 0) {
				directoryFacts = entries;
				return;
			}
			directory = ctx.llm.registerConfigurableProviders(entries);
		} else directory.replace(entries);
		directoryFacts = entries;
	};
	const ensureRoutes = () => {
		const routes = enabledIds();
		if (deepEqualJson(routes, registeredRoutes)) return;
		if (registration === void 0) {
			if (routes.length === 0) {
				registeredRoutes = routes;
				return;
			}
			registration = ctx.llm.registerAdapter(routes, adapter);
		} else registration.replace(routes);
		registeredRoutes = routes;
	};
	const refresh = () => {
		try {
			ensureRoutes();
		} catch (error) {
			ctx.logger.error("llm-oauth: keeping previous adapter routes after a refused update");
			ctx.logger.error(error);
		}
		try {
			ensureDirectory();
		} catch (error) {
			ctx.logger.error("llm-oauth: keeping previous configurable-provider directory after a refused update");
			ctx.logger.error(error);
		}
	};
	/**
	* Refuse a configuration that cannot be served: every enabled id must be a
	* catalog id, and every catalog id must be an OAuth-capable pi-ai provider.
	*/
	const assertServiceable = (value) => {
		resolveOAuthProviders(value.catalog);
		const allowed = new Set(value.catalog);
		for (const id of Object.keys(value.providers)) {
			if (!allowed.has(id)) throw new Error(`dsh-llm-oauth: enabled provider "${id}" is not in catalog [${value.catalog.join(", ")}]`);
			resolveOAuthProviders([id]);
			assertRouteFree(id);
		}
	};
	/**
	* One route id belongs to one adapter. `openai` (Sign in with ChatGPT) is also
	* the first-party llm-pi-ai API-key route, so enabling it while such a profile
	* exists must fail loudly here instead of letting DUPLICATE_ADAPTER leave the
	* model picker empty.
	*/
	const assertRouteFree = (provider) => {
		if (registeredRoutes.includes(provider)) return;
		if (ctx.llm.listProviders().map((info) => info.id).includes(provider)) throw new Error(`dsh-llm-oauth: provider route "${provider}" is already registered by another plugin (an llm-pi-ai API-key profile?). Remove that profile first, or keep the API key and use a different id from this catalog.`);
	};
	assertServiceable(entry);
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber));
	});
	ctx.on("internal/config", function(_raw, next) {
		const raw = next();
		if (this !== ctx.fiber) return raw;
		assertServiceable(resolveConfig(readConfig(raw)));
		return raw;
	});
	ctx.on("loader/volatile-update", () => {
		refresh();
	});
	refresh();
	const controller = new OAuthController(adapter, {
		listEnabled: () => enabledIds(),
		enable: async (provider) => {
			const settings = ctx.get("settings");
			if (settings === void 0) throw new Error("dsh-llm-oauth: settings service is unavailable; add the provider under llm-oauth.providers in settings.yaml");
			assertServiceable({
				...snapshot(),
				providers: {
					...snapshot().providers,
					[provider]: {}
				}
			});
			await settings.mutate(NS, [{
				op: "set",
				path: ["providers", provider],
				value: {}
			}]);
			refresh();
		},
		disable: async (provider) => {
			const settings = ctx.get("settings");
			if (settings === void 0) throw new Error("dsh-llm-oauth: settings service is unavailable; remove the provider under llm-oauth.providers in settings.yaml");
			await settings.mutate(NS, [{
				op: "unset",
				path: ["providers", provider]
			}]);
			refresh();
		}
	});
	const commands = ctx.get("commands");
	if (commands !== void 0) commands.register({
		name: "oauth",
		description: "OAuth / subscription providers: status, enable, login, logout",
		input: { hint: "[status|list|enable <provider>|disable <provider>|login <provider>|logout <provider>]" },
		handler: async (invocation) => {
			const parts = invocation.rawInput.trim().split(/\s+/).filter(Boolean);
			const action = (parts[0] ?? "status").toLowerCase();
			const target = parts[1];
			if (action === "enable") {
				if (target === void 0) return {
					kind: "error",
					text: "Usage: /oauth enable <provider>"
				};
				try {
					await controller.enable(target);
					return {
						kind: "success",
						text: `Enabled ${target}. Its models appear in the picker; run /oauth login ${target} if you are not signed in.`
					};
				} catch (error) {
					return {
						kind: "error",
						text: error instanceof Error ? error.message : String(error)
					};
				}
			}
			if (action === "disable") {
				if (target === void 0) return {
					kind: "error",
					text: "Usage: /oauth disable <provider>"
				};
				try {
					await controller.disable(target);
					return {
						kind: "success",
						text: `Disabled ${target}. Stored credentials (if any) were kept.`
					};
				} catch (error) {
					return {
						kind: "error",
						text: error instanceof Error ? error.message : String(error)
					};
				}
			}
			if (action === "login" && target !== void 0) try {
				await controller.enable(target);
			} catch (error) {
				ctx.logger.warn(`[llm-oauth] could not auto-enable ${target} before login: ${String(error)}`);
			}
			return handleOauthCommand(adapter, invocation.rawInput, invocation.signal);
		}
	});
	ctx.inject(["webServer"], (httpCtx) => {
		httpCtx.effect(() => httpCtx.webServer.register({
			kind: "prefix",
			path: OAUTH_HTTP_PREFIX,
			handler: (req, res) => {
				handleOauthHttp(controller, req, res);
			}
		}), "llm-oauth: http api");
	});
	ctx.logger.info(`[llm-oauth] catalog=[${adapter.catalogIds().join(", ")}] enabled=[${enabledIds().join(", ") || "(none)"}] auth=${authPath}`);
}
//#endregion
//#region src/index.ts
/**
* Standalone OAuth LLM plugin for DeepSeek Harness.
*
* Install with `dsh plugin --profile <name> add github:<user>/dsh-llm-oauth`.
* Do not add a default export: Cordis Loader unwraps `exports.default ?? exports`.
*
* @module dsh-llm-oauth
*/
/** Cordis plugin name; keep this stable after publishing. */
const name = "llm-oauth";
/**
* Services that must exist before the plugin is applied.
* `settings` is optional at runtime: the live policy attaches through ctx.inject,
* and `/oauth` / the HTTP API report their own error when it is absent.
*/
const inject = ["llm"];
//#endregion
export { Config, DEFAULT_PROVIDERS, FileCredentialStore, OAuthController, OAuthPiAiAdapter, SETTINGS_NS, apply, catalogDisplayName, defaultAuthPath, enabledProviderIds, inject, name, oauthCatalogProviders, readConfig, resolveConfig, resolveOAuthProviders };
