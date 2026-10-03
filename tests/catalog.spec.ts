import { createModels } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROVIDERS,
  SETTINGS_NS,
  catalogDisplayName,
  oauthCatalogProviders,
  resolveOAuthProviders,
} from '../src/catalog.ts'
import { enabledProviderIds, resolveConfig } from '../src/config.ts'

describe('oauth catalog', () => {
  it('ships only ids that exist and declare OAuth', () => {
    const resolved = resolveOAuthProviders(DEFAULT_PROVIDERS)
    expect(resolved.map(provider => provider.id)).toEqual([...DEFAULT_PROVIDERS])
    for (const provider of resolved) {
      expect(provider.auth.oauth).toBeDefined()
    }
  })

  it('lists every installed OAuth catalog provider', () => {
    const ids = oauthCatalogProviders().map(provider => provider.id)
    expect(ids).toEqual(expect.arrayContaining([...DEFAULT_PROVIDERS]))
    expect(ids).toContain('xai')
    expect(ids).toContain('github-copilot')
    expect(ids).toContain('openai-codex')
  })

  it('includes Grok 4.6 on the xai provider from the installed pi-ai catalog', () => {
    const [xai] = resolveOAuthProviders(['xai'])
    const models = createModels()
    models.setProvider(xai!)
    expect(models.getModels('xai').map(model => model.id)).toContain('grok-4.6')
  })

  it('offers Sign in with ChatGPT on the openai catalog id', () => {
    // pi-ai >= 1.0.0 gives `openai` a real OAuth method (ChatGPT subscription).
    const [provider] = resolveOAuthProviders(['openai'])
    expect(provider?.id).toBe('openai')
    expect(provider?.auth.oauth).toBeDefined()
  })

  it('includes GPT-6 from the upstream Codex catalog', () => {
    const [provider] = resolveOAuthProviders(['openai-codex'])
    const models = createModels()
    models.setProvider(provider!)
    expect(models.getModels('openai-codex').map(model => model.id)).toContain('gpt-6-astra')
  })

  it('refuses an unknown catalog id', () => {
    expect(() => resolveOAuthProviders(['not-a-provider'])).toThrow(/unknown pi-ai catalog provider/)
  })

  it('refuses an empty list', () => {
    expect(() => resolveOAuthProviders([])).toThrow(/at least one/)
  })

  it('owns the llm-oauth settings namespace id', () => {
    expect(SETTINGS_NS).toBe('llm-oauth')
  })

  it('resolves catalog display names', () => {
    expect(catalogDisplayName('xai')).toMatch(/xAI|xai/i)
    expect(catalogDisplayName('not-real')).toBe('not-real')
  })
})

describe('config enablement', () => {
  it('defaults to an empty enabled set (dormant install)', () => {
    const resolved = resolveConfig()
    expect(resolved.catalog).toEqual([...DEFAULT_PROVIDERS])
    expect(resolved.providers).toEqual({})
    expect(enabledProviderIds(resolved)).toEqual([])
  })

  it('lists enabled provider keys sorted', () => {
    expect(enabledProviderIds({
      catalog: [...DEFAULT_PROVIDERS],
      providers: { openrouter: {}, xai: {} },
    })).toEqual(['openrouter', 'xai'])
  })
})
