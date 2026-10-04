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

import {
  attributionHeaders,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { createModels, getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import type {
  Api,
  AuthInteraction,
  Credential,
  CredentialStore,
  Model,
  Models,
  MutableModels,
  Provider,
} from '@earendil-works/pi-ai'
import { resolveOAuthProviders } from './catalog.ts'
import { toPiContext } from './context.ts'
import { toStreamChunks } from './stream.ts'
import { getDeviceId } from '../bin/device-id.mjs'

export interface OAuthAdapterOptions {
  /** Absolute path of the durable auth file (diagnostics). */
  authPath: string
  /** Shared with the login CLI and `/oauth` command. */
  store: CredentialStore
  /** Full OAuth catalog this adapter can own (not necessarily registered). */
  catalog: readonly string[]
}

/** OAuth-backed multi-provider adapter. */
export class OAuthPiAiAdapter extends LlmAdapter {
  private readonly providers: readonly Provider[]
  private readonly models: Models
  private readonly byId: ReadonlyMap<string, Provider>

  constructor(private readonly options: OAuthAdapterOptions) {
    super()
    this.providers = resolveOAuthProviders(options.catalog)
    const mutable: MutableModels = createModels({ credentials: options.store })
    for (const provider of this.providers) mutable.setProvider(provider)
    this.models = mutable
    this.byId = new Map(this.providers.map(provider => [provider.id, provider]))
  }

  /** Full catalog route ids (settings directory), not only registered ones. */
  catalogIds(): string[] {
    return this.providers.map(provider => provider.id)
  }

  /**
   * @deprecated Use {@link catalogIds}. Kept for older command helpers.
   * @returns full catalog route ids.
   */
  routeIds(): string[] {
    return this.catalogIds()
  }

  /** Shared Models collection (login/logout/status). */
  modelsApi(): Models {
    return this.models
  }

  /** Durable auth file path. */
  authPath(): string {
    return this.options.authPath
  }

  /** Catalog display name for a route id. */
  displayName(provider: string): string {
    return this.byId.get(provider)?.name ?? provider
  }

  override providerInfo(provider: string): LlmProviderInfo {
    const entry = this.byId.get(provider)
    if (entry === undefined) return { id: provider, name: provider }
    return { id: entry.id, name: entry.name }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve().then(() => {
      this.requireProvider(provider)
      return this.models.getModels(provider).map(model => ({
        provider,
        id: model.id,
        name: model.name,
        inputModalities: ['text'],
      }))
    })
  }

  override resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve().then(() => {
      const resolved = this.requireModel(provider, model)
      const levels = getSupportedThinkingLevels(resolved)
      const reasoning = levels.length > 0 && !(levels.length === 1 && levels[0] === 'off')
        ? { efforts: levels.map(level => ({ id: ReasoningEffortId(level), name: level })) }
        : undefined
      return {
        provider,
        id: model,
        name: resolved.name,
        inputModalities: ['text'],
        context: { contextWindow: resolved.contextWindow },
        ...reasoning === undefined ? {} : { reasoning },
      }
    })
  }

  /**
   * Run an interactive OAuth login and persist the credential.
   * @param provider - catalog provider id.
   * @param interaction - prompt/notify callbacks.
   */
  async login(provider: string, interaction: AuthInteraction): Promise<Credential> {
    this.requireProvider(provider)
    const deviceId = provider === 'openai' ? await getDeviceId(this.options.authPath) : undefined
    return this.models.login(provider, 'oauth', interaction,
      deviceId === undefined ? undefined : { getDeviceId: () => deviceId })
  }

  /** Drop the stored credential for one provider. */
  logout(provider: string): Promise<void> {
    this.requireProvider(provider)
    return this.models.logout(provider)
  }

  /** Whether the provider currently has complete auth configuration. */
  checkAuth(provider: string): Promise<{ source?: string, type: 'api_key' | 'oauth' } | undefined> {
    this.requireProvider(provider)
    return this.models.checkAuth(provider)
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.stop !== undefined) {
      throw new LlmError('dsh-llm-oauth does not support GenerateOptions.stop', 'UNSUPPORTED_OPTION')
    }
    const model = this.requireModel(options.provider, options.model)
    const effort = options.reasoningEffort
    const reasoning = effort === undefined ? undefined
      : getSupportedThinkingLevels(model).find(level => level === effort)
    if (effort !== undefined && reasoning === undefined) {
      throw new LlmError(`Model "${model.id}" does not support reasoning effort "${effort}"`, 'UNSUPPORTED_REASONING_EFFORT')
    }
    const auth = await this.models.checkAuth(options.provider)
    if (auth === undefined) {
      throw new LlmError(
        `dsh-llm-oauth: provider "${options.provider}" is not logged in; `
        + `run \`/oauth login ${options.provider}\` or use Settings → OAuth / 订阅`,
        'MISSING_CREDENTIAL',
      )
    }

    const context = toPiContext(options)
    const events = this.models.streamSimple(model, context, {
      maxRetries: 0,
      ...reasoning === undefined || reasoning === 'off' ? {} : { reasoning },
      ...options.temperature === undefined ? {} : { temperature: options.temperature },
      ...options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens },
      ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
      ...options.signal === undefined ? {} : { signal: options.signal },
      headers: attributionHeaders(),
    })
    yield* toStreamChunks(events)
  }

  private requireProvider(provider: string): Provider {
    const entry = this.byId.get(provider)
    if (entry === undefined) {
      throw new LlmError(`dsh-llm-oauth does not own provider "${provider}"`, 'NO_ADAPTER')
    }
    return entry
  }

  private requireModel(provider: string, model: string): Model<Api> {
    this.requireProvider(provider)
    const resolved = this.models.getModel(provider, model)
    if (resolved === undefined) {
      throw new LlmError(
        `dsh-llm-oauth provider "${provider}" has no catalog model "${model}"`,
        'UNKNOWN_MODEL',
      )
    }
    return resolved
  }
}
