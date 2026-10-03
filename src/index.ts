/**
 * Standalone OAuth LLM plugin for DeepSeek Harness.
 *
 * Install with `dsh plugin --profile <name> add github:<user>/dsh-llm-oauth`.
 * Do not add a default export: Cordis Loader unwraps `exports.default ?? exports`.
 *
 * @module dsh-llm-oauth
 */

/** Cordis plugin name; keep this stable after publishing. */
export const name = 'llm-oauth'

/**
 * Services that must exist before the plugin is applied.
 * `settings` is optional at runtime: the live policy attaches through ctx.inject,
 * and `/oauth` / the HTTP API report their own error when it is absent.
 */
export const inject = ['llm']

export { Config, readConfig, resolveConfig, enabledProviderIds } from './config.ts'
export type { ResolvedConfig, RuntimeConfig, OAuthProviderProfile } from './config.ts'
export { apply } from './runtime.ts'
export { OAuthPiAiAdapter } from './adapter.ts'
export { FileCredentialStore } from './store.ts'
export {
  resolveOAuthProviders,
  oauthCatalogProviders,
  catalogDisplayName,
  DEFAULT_PROVIDERS,
  SETTINGS_NS,
} from './catalog.ts'
export { defaultAuthPath } from './home.ts'
export { OAuthController } from './service.ts'
export type { OAuthProviderStatus, OAuthStatusSnapshot } from './service.ts'
