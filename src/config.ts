/**
 * Serializable configuration and defaults.
 *
 * Composition and the optional `llm-oauth` settings section share this shape:
 * - `catalog` — OAuth-capable pi-ai ids this plugin may offer
 * - `providers` — enabled profiles (key present ⇒ route registered / models listed)
 *
 * `providers` is declared `.volatile()`: schemastery parses it into a stable
 * reference read with `.get()`, the Loader replaces that reference in place when
 * a settings write commits (no remount), and only a Config declaring at least
 * one volatile field may be edited live — without one the settings service
 * answers every enable/disable with
 * `Plugin entry "llm-oauth" has no volatile fields`. `catalog` and `authPath`
 * stay ordinary: both are composition choices the adapter resolves once at
 * mount.
 *
 * Default `providers` is empty so installing the plugin does not dump every
 * catalog model into the picker. Enable via Settings → OAuth / 订阅, or by
 * writing a profile under `llm-oauth.providers.<id>`, or automatically on a
 * successful `/oauth login`.
 *
 * @module dsh-llm-oauth/config
 */

import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_PROVIDERS } from './catalog.ts'

/** One enabled OAuth provider profile (reserved for future knobs). */
export interface OAuthProviderProfile {
  /** Optional display override; defaults to the pi-ai catalog name. */
  displayName?: string
}

/** Plugin configuration supplied by the profile composition / settings section. */
export interface Config {
  /**
   * pi-ai catalog provider ids that declare OAuth and may be enabled.
   * Defaults: xai, github-copilot, openai-codex, anthropic, openrouter, kimi-coding.
   */
  catalog?: string[]
  /**
   * Enabled OAuth routes. Presence of a key under `providers` turns that
   * catalog id on (registers the adapter route and lists its models).
   *
   * Legacy (v0.1) accepted a string array here meaning “always-on catalog”;
   * that form is still accepted and normalized to `catalog` + empty enablement
   * so upgrades stop flooding the model picker.
   */
  providers?: Record<string, OAuthProviderProfile> | string[]
  /** Override path for the durable OAuth credential file. */
  authPath?: string
}

/**
 * Configuration as the Loader hands it to `apply()`. `providers` is the
 * volatile field: keep the reference and read `.get()` on each operation, so a
 * settings write is observed without remounting the plugin.
 */
export interface RuntimeConfig {
  catalog: string[]
  providers: Volatile<Record<string, OAuthProviderProfile> | string[]>
  authPath?: string
}

/** Configuration after defaults. */
export interface ResolvedConfig {
  catalog: string[]
  providers: Record<string, OAuthProviderProfile>
  authPath?: string
}

/** Empty enabled-profile object accepted by the settings form. */
const ProviderProfileSchema: z<OAuthProviderProfile> = z.object({
  displayName: z.string(),
})

/**
 * Loader-visible configuration schema.
 * Shared by composition entry config and the `llm-oauth` settings section.
 *
 * `providers` is volatile, so the settings service accepts live enable/disable
 * edits to this entry and the Loader swaps the reference in place instead of
 * remounting the plugin.
 */
export const Config = z.object({
  catalog: z.array(z.string()).default([...DEFAULT_PROVIDERS]),
  // Dict = enabled profiles. Array = legacy v0.1 “always register these ids”.
  providers: z.union([
    z.dict(ProviderProfileSchema),
    z.array(z.string()),
  ]).default({}).volatile(),
  authPath: z.string(),
})

/**
 * Read one configuration field's current value; an ordinary value passes
 * through unchanged.
 * @param value - a parsed field, plain or volatile.
 * @returns the current snapshot for a volatile reference.
 */
function readField<T>(value: T | Volatile<T> | undefined): T | undefined {
  if (value === undefined || value === null) return undefined
  const box = value as Volatile<T>
  // The snapshot is deeply readonly; readConfig detaches it below, and every
  // other reader only inspects it.
  return typeof box.get === 'function' ? box.get() as T : value as T
}

/**
 * Project the Loader's configuration onto the plain shape composition input
 * uses, so no caller holds a volatile reference between operations.
 * @param config - Loader configuration (volatile fields) or plain values.
 * @returns plain configuration, detached from the live references.
 */
export function readConfig(config: RuntimeConfig | Config = {}): Config {
  const values = config as Partial<RuntimeConfig>
  const catalog = readField(values.catalog)
  const providers = readField(values.providers)
  const authPath = readField(values.authPath)
  return {
    ...catalog === undefined ? {} : { catalog: structuredClone(catalog) },
    ...providers === undefined ? {} : { providers: structuredClone(providers) },
    ...authPath === undefined ? {} : { authPath },
  }
}

/**
 * Normalize composition/settings input: legacy `providers: string[]` becomes
 * the catalog with nothing enabled (dormant), matching the v0.2 default.
 * @param config - partial or legacy configuration.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const legacyList = Array.isArray(config.providers) ? config.providers : undefined
  const catalog = config.catalog
    ?? (legacyList !== undefined && legacyList.length > 0 ? [...legacyList] : [...DEFAULT_PROVIDERS])
  const providers = legacyList !== undefined
    ? {}
    : (config.providers as Record<string, OAuthProviderProfile> | undefined) ?? {}
  return {
    catalog,
    providers,
    ...config.authPath === undefined ? {} : { authPath: config.authPath },
  }
}

/** Sorted list of enabled provider route ids. */
export function enabledProviderIds(config: Config | ResolvedConfig): string[] {
  const providers = resolveConfig(config).providers
  return Object.keys(providers).sort((a, b) => a.localeCompare(b))
}
