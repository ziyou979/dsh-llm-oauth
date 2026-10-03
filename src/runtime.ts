/**
 * Cordis activation: dormant-by-default OAuth adapter, settings section,
 * optional `/oauth` command, and optional HTTP API for the Settings panel.
 *
 * @module dsh-llm-oauth/runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  AdapterRegistrationHandle,
  DirectoryRegistrationHandle,
  LlmConfigurableProvider,
} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { OAuthPiAiAdapter } from './adapter.ts'
import { SETTINGS_NS, catalogDisplayName, resolveOAuthProviders } from './catalog.ts'
import { handleOauthCommand } from './command.ts'
import {
  enabledProviderIds,
  readConfig,
  resolveConfig,
  type OAuthProviderProfile,
  type ResolvedConfig,
  type RuntimeConfig,
} from './config.ts'
import { defaultAuthPath } from './home.ts'
import { OAUTH_HTTP_PREFIX, handleOauthHttp } from './http.ts'
import { OAuthController } from './service.ts'
import { FileCredentialStore } from './store.ts'

const NS = SETTINGS_NS

/**
 * Apply the plugin to its Cordis context.
 * @param ctx - scoped plugin context; registrations are effects.
 * @param config - configuration resolved by Cordis from the exported schema.
 */
export function apply(ctx: Context, config: RuntimeConfig): void {
  // resolveConfig also collapses legacy `providers: string[]` compositions.
  const entry = resolveConfig(readConfig(config))
  resolveOAuthProviders(entry.catalog)

  const authPath = entry.authPath ?? defaultAuthPath()
  const store = new FileCredentialStore(authPath)
  const adapter = new OAuthPiAiAdapter({
    authPath,
    store,
    catalog: entry.catalog,
  })

  let registration: AdapterRegistrationHandle | undefined
  let registeredRoutes: string[] = []
  let directory: DirectoryRegistrationHandle | undefined
  let directoryFacts: unknown

  /**
   * The live configuration. `config.providers` is a volatile reference, so
   * every operation reads the value the Loader committed last — a settings
   * write reaches the adapter without a remount.
   */
  const snapshot = (): ResolvedConfig => resolveConfig(readConfig(config))

  const catalogIds = (): string[] => snapshot().catalog

  const enabledIds = (): string[] => {
    const allowed = new Set(catalogIds())
    return enabledProviderIds(snapshot()).filter(id => allowed.has(id))
  }

  /**
   * Models settings rows for providers the user turned on. Dormant catalog
   * entries stay off this directory (and off the model picker) until enabled
   * via Settings → OAuth / 订阅 or `/oauth enable|login`.
   */
  const directoryEntries = (): LlmConfigurableProvider[] => {
    const profiles = snapshot().providers
    return enabledIds().map((provider) => {
      const profile = profiles[provider] as OAuthProviderProfile | undefined
      const displayName = profile?.displayName?.trim()
        || catalogDisplayName(provider)
        || provider
      return {
        provider,
        displayName,
        settingsNs: SETTINGS_NS,
        settingsPath: ['providers', provider],
      }
    })
  }

  const ensureDirectory = (): void => {
    const entries = directoryEntries()
    if (deepEqualJson(entries, directoryFacts)) return
    // Empty replace is legal on an existing handle (dormant again). An empty
    // *initial* registration is not — stay unregistered until the first enable.
    if (directory === undefined) {
      if (entries.length === 0) {
        directoryFacts = entries
        return
      }
      directory = ctx.llm.registerConfigurableProviders(entries)
    } else {
      directory.replace(entries)
    }
    directoryFacts = entries
  }

  const ensureRoutes = (): void => {
    const routes = enabledIds()
    if (deepEqualJson(routes, registeredRoutes)) return
    if (registration === undefined) {
      if (routes.length === 0) {
        registeredRoutes = routes
        return
      }
      registration = ctx.llm.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    registeredRoutes = routes
  }

  const refresh = (): void => {
    try {
      ensureRoutes()
    } catch (error) {
      ctx.logger.error('llm-oauth: keeping previous adapter routes after a refused update')
      ctx.logger.error(error)
    }
    try {
      ensureDirectory()
    } catch (error) {
      ctx.logger.error('llm-oauth: keeping previous configurable-provider directory after a refused update')
      ctx.logger.error(error)
    }
  }

  /**
   * Refuse a configuration that cannot be served: every enabled id must be a
   * catalog id, and every catalog id must be an OAuth-capable pi-ai provider.
   */
  const assertServiceable = (value: ResolvedConfig): void => {
    resolveOAuthProviders(value.catalog)
    const allowed = new Set(value.catalog)
    for (const id of Object.keys(value.providers)) {
      if (!allowed.has(id)) {
        throw new Error(
          `dsh-llm-oauth: enabled provider "${id}" is not in catalog [${value.catalog.join(', ')}]`,
        )
      }
      resolveOAuthProviders([id])
    }
  }

  /**
   * One route id belongs to one adapter. `openai` (Sign in with ChatGPT) is also
   * the first-party llm-pi-ai API-key route, so enabling it while such a profile
   * exists must fail loudly here instead of letting DUPLICATE_ADAPTER leave the
   * model picker empty.
   */
  const assertRouteFree = (provider: string): void => {
    if (registeredRoutes.includes(provider)) return
    const owners = ctx.llm.listProviders().map(info => info.id)
    if (owners.includes(provider)) {
      throw new Error(
        `dsh-llm-oauth: provider route "${provider}" is already registered by another plugin `
        + '(an llm-pi-ai API-key profile?). Remove that profile first, or keep the API key and '
        + 'use a different id from this catalog.',
      )
    }
  }

  // Settings surface policy: `auto: false` keeps the generic auto-generated
  // page out of Settings → Plugins. This plugin owns the OAuth / 订阅 page and
  // the `/oauth` command instead, and its `providers` dict is not a form.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })

  // Validate each candidate before the Loader commits it, so an unusable
  // catalog or enablement fails the settings write instead of half-applying.
  // The candidate carries the composed values (a missing catalog falls back to
  // the shipped default inside resolveConfig).
  ctx.on('internal/config', function (
    this: import('@deepseek-ai/cordis').Fiber, _raw: unknown, next: () => unknown,
  ): unknown {
    const raw: unknown = next()
    if (this !== ctx.fiber) return raw
    assertServiceable(resolveConfig(readConfig(raw as RuntimeConfig)))
    return raw
  })

  // The Loader commits volatile values into the running references and
  // announces the change; this is what makes a settings write visible to the
  // model picker and the route list.
  ctx.on('loader/volatile-update', () => { refresh() })

  // Composition-only path before settings attach (and when settings never mounts).
  refresh()

  const controller = new OAuthController(adapter, {
    listEnabled: () => enabledIds(),
    enable: async (provider) => {
      const settings = ctx.get('settings') as {
        mutate(
          ns: typeof NS,
          ops: readonly ({ op: 'set', path: readonly string[], value: unknown } | { op: 'unset', path: readonly string[] })[],
        ): Promise<void>
      } | undefined
      if (settings === undefined) {
        throw new Error(
          'dsh-llm-oauth: settings service is unavailable; add the provider under llm-oauth.providers in settings.yaml',
        )
      }
      // Refuse an unknown or non-OAuth id here: the Loader refuses the same
      // candidate, but the person clicking 开启 deserves the catalog error.
      assertServiceable({
        ...snapshot(),
        providers: { ...snapshot().providers, [provider]: {} },
      })
      // …and refuse a route another plugin already owns (openai API key).
      assertRouteFree(provider)
      await settings.mutate(NS, [
        { op: 'set', path: ['providers', provider], value: {} },
      ])
      refresh()
    },
    disable: async (provider) => {
      const settings = ctx.get('settings') as {
        mutate(
          ns: typeof NS,
          ops: readonly ({ op: 'set', path: readonly string[], value: unknown } | { op: 'unset', path: readonly string[] })[],
        ): Promise<void>
      } | undefined
      if (settings === undefined) {
        throw new Error(
          'dsh-llm-oauth: settings service is unavailable; remove the provider under llm-oauth.providers in settings.yaml',
        )
      }
      await settings.mutate(NS, [
        { op: 'unset', path: ['providers', provider] },
      ])
      refresh()
    },
  })

  const commands = ctx.get('commands') as {
    register(definition: {
      name: string
      description: string
      input?: { hint: string }
      handler: (invocation: { rawInput: string, signal?: AbortSignal }) => Promise<{ kind: string, text?: string }>
    }): void
  } | undefined
  if (commands !== undefined) {
    commands.register({
      name: 'oauth',
      description: 'OAuth / subscription providers: status, enable, login, logout',
      input: { hint: '[status|list|enable <provider>|disable <provider>|login <provider>|logout <provider>]' },
      handler: async (invocation) => {
        const parts = invocation.rawInput.trim().split(/\s+/).filter(Boolean)
        const action = (parts[0] ?? 'status').toLowerCase()
        const target = parts[1]

        if (action === 'enable') {
          if (target === undefined) return { kind: 'error', text: 'Usage: /oauth enable <provider>' }
          try {
            await controller.enable(target)
            return {
              kind: 'success',
              text: `Enabled ${target}. Its models appear in the picker; run /oauth login ${target} if you are not signed in.`,
            }
          } catch (error) {
            return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
          }
        }
        if (action === 'disable') {
          if (target === undefined) return { kind: 'error', text: 'Usage: /oauth disable <provider>' }
          try {
            await controller.disable(target)
            return { kind: 'success', text: `Disabled ${target}. Stored credentials (if any) were kept.` }
          } catch (error) {
            return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
          }
        }
        if (action === 'login' && target !== undefined) {
          try {
            await controller.enable(target)
          } catch (error) {
            ctx.logger.warn(`[llm-oauth] could not auto-enable ${target} before login: ${String(error)}`)
          }
        }
        return handleOauthCommand(adapter, invocation.rawInput, invocation.signal)
      },
    })
  }

  // Optional HTTP API for the Settings panel. Registered when/after webServer
  // mounts — `ctx.inject` waits for the service instead of sampling it at
  // apply time (the first-party pattern; see client-ui-theme).
  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(() => httpCtx.webServer.register({
      kind: 'prefix',
      path: OAUTH_HTTP_PREFIX,
      handler: (req, res) => {
        void handleOauthHttp(controller, req, res)
      },
    }), 'llm-oauth: http api')
  })

  ctx.logger.info(
    `[llm-oauth] catalog=[${adapter.catalogIds().join(', ')}] `
    + `enabled=[${enabledIds().join(', ') || '(none)'}] auth=${authPath}`,
  )
}
