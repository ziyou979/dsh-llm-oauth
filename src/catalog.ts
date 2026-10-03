/**
 * Resolve OAuth-capable pi-ai catalog providers.
 */

import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import type { Provider } from '@earendil-works/pi-ai'

/** Default subscription / OAuth catalog ids this plugin ships. */
export const DEFAULT_PROVIDERS = [
  'xai',
  'github-copilot',
  // Sign in with ChatGPT (ChatGPT subscription); pi-ai >= 1.0.0.
  'openai',
  // Legacy Codex device-code flow, kept for the GPT-5.x Codex models.
  'openai-codex',
  'anthropic',
  'openrouter',
  'kimi-coding',
] as const

/** Settings / configurable-provider namespace owned by this plugin. */
export const SETTINGS_NS = 'llm-oauth'

/**
 * Every installed catalog provider that declares an OAuth method.
 */
export function oauthCatalogProviders(): Provider[] {
  return builtinProviders().filter(provider => provider.auth.oauth !== undefined)
}

/**
 * Resolve configured catalog ids against the installed catalog.
 * @param requested - provider ids from plugin config.
 * @returns catalog providers in config order.
 */
export function resolveOAuthProviders(requested: readonly string[]): Provider[] {
  const catalog = new Map(builtinProviders().map(provider => [provider.id, provider]))
  const resolved: Provider[] = []
  for (const id of requested) {
    const provider = catalog.get(id)
    if (provider === undefined) {
      throw new Error(`dsh-llm-oauth: unknown pi-ai catalog provider "${id}"`)
    }
    if (provider.auth.oauth === undefined) {
      throw new Error(
        `dsh-llm-oauth: provider "${id}" has no OAuth method `
        + '(GPT subscriptions use "openai" — Sign in with ChatGPT — or the legacy "openai-codex"; '
        + 'pure API-key ids such as "openai"-less gateways stay on the first-party plugin. '
        + 'Run `node bin/login.mjs --list` for every OAuth-capable id)',
      )
    }
    resolved.push(provider)
  }
  if (resolved.length === 0) {
    throw new Error('dsh-llm-oauth: catalog must list at least one OAuth-capable catalog id')
  }
  return resolved
}

/**
 * Human label for a catalog id (falls back to the id).
 * @param providerId - pi-ai catalog provider id.
 */
export function catalogDisplayName(providerId: string): string {
  const hit = builtinProviders().find(provider => provider.id === providerId)
  return hit?.name ?? providerId
}
