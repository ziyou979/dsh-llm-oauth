/**
 * In-process OAuth control surface used by `/oauth`, the HTTP API, and tests.
 *
 * Keeps enable/disable (settings profiles + adapter routes) separate from
 * login/logout (pi-ai credential file), and exposes a single status snapshot
 * for the Settings → OAuth panel.
 */

import type { OAuthPiAiAdapter } from './adapter.ts'
import { catalogDisplayName } from './catalog.ts'
import type { LoginPrompt, LoginWatch } from './command.ts'
import { listLoginWatches, submitLoginCode } from './command.ts'

/** One provider row for status UIs. */
export interface OAuthProviderStatus {
  /** pi-ai catalog / route id. */
  id: string
  /** Human label from the catalog (or a settings override). */
  name: string
  /** Whether the adapter route is registered (models appear in the picker). */
  enabled: boolean
  /** Whether a usable OAuth/API credential is stored. */
  loggedIn: boolean
  /** Credential kind when logged in. */
  authType?: 'api_key' | 'oauth'
  /** Optional credential source label from pi-ai. */
  authSource?: string
  /** Background login watch, when one exists. */
  loginStatus?: 'waiting' | 'ok' | 'error'
  /** Detail from the last login watch. */
  loginDetail?: string
  /** Value the running login waits for (paste it back through the UI). */
  loginPrompt?: LoginPrompt
}

/** Full status payload. */
export interface OAuthStatusSnapshot {
  /** Durable credential file path. */
  authPath: string
  /** Catalog ids this plugin may enable. */
  catalog: string[]
  /** Currently registered (enabled) route ids. */
  enabled: string[]
  /** Per-provider rows in catalog order. */
  providers: OAuthProviderStatus[]
}

/** Callbacks the runtime supplies so the service never owns Cordis handles. */
export interface OAuthControllerHooks {
  /** Current enabled route ids (sorted). */
  listEnabled(): readonly string[]
  /** Enable a catalog id (settings profile + route registration). */
  enable(provider: string): Promise<void>
  /** Disable a catalog id (drop profile + route). */
  disable(provider: string): Promise<void>
}

/**
 * Control plane for OAuth providers.
 * @param adapter - live OAuth adapter (full catalog).
 * @param hooks - enable/disable integration with the runtime.
 */
export class OAuthController {
  constructor(
    private readonly adapter: OAuthPiAiAdapter,
    private readonly hooks: OAuthControllerHooks,
  ) {}

  /** Catalog ids the adapter owns. */
  catalog(): string[] {
    return this.adapter.catalogIds()
  }

  /** Currently enabled route ids. */
  enabled(): string[] {
    return [...this.hooks.listEnabled()]
  }

  /**
   * Build a status snapshot for UIs.
   * @returns auth path, catalog, enabled set, and per-provider rows.
   */
  async status(): Promise<OAuthStatusSnapshot> {
    const catalog = this.adapter.catalogIds()
    const enabled = new Set(this.hooks.listEnabled())
    const watches = new Map(listLoginWatches().map(watch => [watch.provider, watch]))
    const providers: OAuthProviderStatus[] = []
    for (const id of catalog) {
      const auth = await this.adapter.checkAuth(id)
      const watch = watches.get(id)
      providers.push(statusRow(id, this.adapter.displayName(id), enabled.has(id), auth, watch))
    }
    return {
      authPath: this.adapter.authPath(),
      catalog,
      enabled: [...enabled].sort((a, b) => a.localeCompare(b)),
      providers,
    }
  }

  /**
   * Enable a catalog provider (show its models once logged in).
   * @param provider - catalog id.
   */
  async enable(provider: string): Promise<void> {
    this.requireCatalog(provider)
    await this.hooks.enable(provider)
  }

  /**
   * Disable a catalog provider (hide its models; credentials are kept).
   * @param provider - catalog id.
   */
  async disable(provider: string): Promise<void> {
    this.requireCatalog(provider)
    await this.hooks.disable(provider)
  }

  /**
   * Drop stored credentials. Does not change the enabled flag.
   * @param provider - catalog id.
   */
  async logout(provider: string): Promise<void> {
    this.requireCatalog(provider)
    await this.adapter.logout(provider)
  }

  /**
   * Answer the value a running login waits for (pi-ai `manual_code`: the final
   * redirect URL / authorization code a callback flow could not deliver).
   * @param provider - catalog id.
   * @param value - pasted redirect URL or code.
   * @throws when no login of that provider is waiting for a value.
   */
  submitCode(provider: string, value: string): void {
    this.requireCatalog(provider)
    if (!submitLoginCode(provider, value)) {
      throw new Error(
        `dsh-llm-oauth: ${provider} is not waiting for a pasted value; start the sign-in first`,
      )
    }
  }

  /** Underlying adapter (login helper / commands). */
  getAdapter(): OAuthPiAiAdapter {
    return this.adapter
  }

  private requireCatalog(provider: string): void {
    if (!this.adapter.catalogIds().includes(provider)) {
      throw new Error(`dsh-llm-oauth: unknown catalog provider "${provider}"`)
    }
  }
}

function statusRow(
  id: string,
  name: string,
  enabled: boolean,
  auth: { source?: string, type: 'api_key' | 'oauth' } | undefined,
  watch: LoginWatch | undefined,
): OAuthProviderStatus {
  return {
    id,
    name: name || catalogDisplayName(id),
    enabled,
    loggedIn: auth !== undefined,
    ...auth === undefined
      ? {}
      : {
        authType: auth.type,
        ...auth.source === undefined ? {} : { authSource: auth.source },
      },
    ...watch === undefined
      ? {}
      : {
        loginStatus: watch.status,
        ...watch.detail === undefined ? {} : { loginDetail: watch.detail },
        ...watch.prompt === undefined ? {} : { loginPrompt: watch.prompt },
      },
  }
}
