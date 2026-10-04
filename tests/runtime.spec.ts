import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { resolveConfig as parseConfig } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import * as plugin from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function boot(config: plugin.Config = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  const consumer = ctx.plugin(plugin, config)
  await consumer
  return { ctx, consumer }
}

function routes(ctx: Context) {
  return ctx.llm.listProviders().map(provider => provider.id).sort()
}

describe('composition registration', () => {
  it('registers no routes on a dormant install', async () => {
    const { ctx } = await boot()
    expect(routes(ctx)).toEqual([])
  })

  it('registers the composition-enabled providers', async () => {
    const { ctx } = await boot({ providers: { xai: {} } })
    expect(routes(ctx)).toEqual(['xai'])
  })

  it('rejects a configuration that cannot be served', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await expect(ctx.plugin(plugin, { providers: { 'not-a-provider': {} } }))
      .rejects.toThrow(/not in catalog/)
    expect(routes(ctx)).toEqual([])
  })

  it('unregisters every route when the plugin unloads', async () => {
    const { ctx, consumer } = await boot({ providers: { xai: {}, anthropic: {} } })
    expect(routes(ctx)).toEqual(['anthropic', 'xai'])
    await consumer.dispose()
    expect(routes(ctx)).toEqual([])
  })
})

describe('Loader live configuration', () => {
  async function live() {
    const require = createRequire(import.meta.url)
    const peers = createRequire(require.resolve('@deepseek-ai/dsh-settings/package.json'))
    const Loader = (await import(peers.resolve('@deepseek-ai/cordis-plugin-loader'))).default
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Loader)
    ctx.loader.builtins.oauth = plugin
    const id = await ctx.loader.create({ id: 'llm-oauth', name: 'cordis:oauth', config: { providers: { xai: {} } } })
    const entry = ctx.loader.resolve(id)
    await entry.fiber!.await()
    return { ctx, entry }
  }

  it('updates provider routes without remounting the running plugin', async () => {
    const { ctx, entry } = await live()
    const fiber = entry.fiber!
    await entry.update({ config: { providers: { anthropic: {} } } })
    await entry.fiber!.await()
    expect(entry.fiber === fiber).toBe(true)
    expect(routes(ctx)).toEqual(['anthropic'])
  })

  it('refuses a foreign route before configEditor can commit the candidate', async () => {
    const { ctx, entry } = await live()
    const foreign = new plugin.OAuthPiAiAdapter({ authPath: 'unused', store: new plugin.FileCredentialStore('unused'), catalog: ['openai'] })
    ctx.llm.registerAdapter(['openai'], foreign)
    const fiber = entry.fiber!
    const next = { providers: { xai: {}, openai: {}, anthropic: {} } }
    expect(() => parseConfig(fiber.runtime!, fiber.ctx.waterfall(fiber, 'internal/config', next, () => next)))
      .toThrow(/already registered by another plugin/)
    // Loader also keeps its running volatile references when a raw reload is invalid.
    await entry.update({ config: next })
    await entry.fiber!.await()
    expect(Object.keys(plugin.readConfig(fiber.config).providers!)).toEqual(['xai'])
    expect(routes(ctx)).toEqual(['openai', 'xai'])
  })
})
