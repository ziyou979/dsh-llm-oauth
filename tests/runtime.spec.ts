import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
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

// The Harness settings service was reworked into `SettingsForms` (a Service
// driven by `configEditor` + `profileContext`, with no `load`/`persist` seam
// for a test double to override), so this file can no longer exercise live
// settings writes the way it did against the old `SettingsProvider`. The
// composition-driven paths below need no service; the volatile-config path is
// covered by the Harness' own tests.
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
    // Cordis reports a failed plugin start through the fiber state, not a throw.
    const consumer = await ctx.plugin(plugin, { providers: { 'not-a-provider': {} } })
    expect(consumer?.state).not.toBe(1) // not active
    expect(routes(ctx)).toEqual([])
  })

  it('unregisters every route when the plugin unloads', async () => {
    const { ctx, consumer } = await boot({ providers: { xai: {}, anthropic: {} } })
    expect(routes(ctx)).toEqual(['anthropic', 'xai'])
    await consumer.dispose()
    expect(routes(ctx)).toEqual([])
  })
})