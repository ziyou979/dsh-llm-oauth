import { describe, expect, it, vi } from 'vitest'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { convertResponsesMessages } from '@earendil-works/pi-ai/api/openai-responses-shared'
import { OAuthPiAiAdapter } from '../src/adapter.ts'
import { prepareRequestImages, toPiContext } from '../src/context.ts'
import type { ImageRequestReader } from '../src/context.ts'
import { FileCredentialStore } from '../src/store.ts'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ref = { attachmentId: 'att-1', mediaType: 'image/png', bytes: PNG.length, width: 4000, height: 3000, name: 'shot.png' }
const user = createMessage({
  role: 'user',
  source: { kind: 'user' },
  content: [{ type: 'text', text: 'What is this?' }, { type: 'image', attachment: ref as never }],
} as never)

function reader(): ImageRequestReader & { readImageRequest: ReturnType<typeof vi.fn> } {
  return { readImageRequest: vi.fn(async () => ({ data: PNG, mediaType: 'image/png' })) }
}

function adapter(catalog: string, attachments?: ImageRequestReader) {
  return new OAuthPiAiAdapter({
    authPath: 'unused',
    store: new FileCredentialStore('unused'),
    catalog: [catalog],
    resolveAttachments: () => attachments,
  })
}

describe('image input', () => {
  it('reports the pi-ai model input modalities', async () => {
    const subject = adapter('openai')
    const models = await subject.listModels('openai')
    expect(models.find(m => m.id === 'gpt-5.5')!.inputModalities).toEqual(['text', 'image'])
    expect(models.find(m => m.id === 'gpt-4')!.inputModalities).toEqual(['text'])
    expect((await subject.resolveModel('openai', 'gpt-5.5')).inputModalities).toEqual(['text', 'image'])
  })

  it('reads request bytes within the pixel/byte budget', async () => {
    const attachments = reader()
    const images = await prepareRequestImages([user], attachments)
    expect(images.get('att-1')!.data).toBe(PNG)
    const target = attachments.readImageRequest.mock.calls[0]![1]
    expect(target.maxBytes).toBe(1_048_576)
    expect(target.width * target.height).toBeLessThanOrEqual(4_194_304)
  })

  it('converts image blocks into pi-ai ImageContent', async () => {
    const images = await prepareRequestImages([user], reader())
    const context = toPiContext({ provider: 'openai', model: 'gpt-5.5', messages: [user] }, images)
    expect(context.messages[0]!.content).toEqual([
      { type: 'text', text: 'What is this?' },
      { type: 'image', data: Buffer.from(PNG).toString('base64'), mimeType: 'image/png' },
    ])
  })

  it('keeps text-only user content as a plain string', () => {
    const text = createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] })
    expect(toPiContext({ provider: 'openai', model: 'gpt-5.5', messages: [text] }).messages[0]!.content).toBe('hi')
  })

  it('refuses images without prepared bytes', () => {
    expect(() => toPiContext({ provider: 'openai', model: 'gpt-5.5', messages: [user] })).toThrow(/prepared request images/)
  })

  it('serializes to an input_image part on the openai Responses route', async () => {
    const subject = adapter('openai')
    const model = subject.modelsApi().getModel('openai', 'gpt-5.5')!
    const context = toPiContext({ provider: 'openai', model: 'gpt-5.5', messages: [user] }, await prepareRequestImages([user], reader()))
    const input = convertResponsesMessages(model, context, new Set(['openai'])) as Array<{ content: unknown }>
    expect(JSON.stringify(input)).toContain('"type":"input_image"')
    expect(JSON.stringify(input)).toContain(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`)
  })

  it('streams image requests through the attachment service', async () => {
    const attachments = reader()
    const subject = adapter('openai', attachments)
    vi.spyOn(subject.modelsApi(), 'checkAuth').mockResolvedValue({ type: 'oauth' })
    const events = createAssistantMessageEventStream()
    events.end()
    const stream = vi.spyOn(subject.modelsApi(), 'streamSimple').mockReturnValue(events)
    await expect(async () => {
      for await (const _ of subject.stream({ provider: 'openai', model: 'gpt-5.5', messages: [user] })) {}
    }).rejects.toThrow(/without done/)
    const sent = stream.mock.calls[0]![1].messages[0]!.content as Array<{ type: string }>
    expect(sent.map(part => part.type)).toEqual(['text', 'image'])
    expect(attachments.readImageRequest).toHaveBeenCalledOnce()
  })

  it('rejects images for text-only models and without the attachment service', async () => {
    const drain = async (subject: OAuthPiAiAdapter, model: string) => {
      for await (const _ of subject.stream({ provider: 'openai', model, messages: [user] })) {}
    }
    const textOnly = adapter('openai', reader())
    vi.spyOn(textOnly.modelsApi(), 'checkAuth').mockResolvedValue({ type: 'oauth' })
    await expect(drain(textOnly, 'gpt-4')).rejects.toThrow(/does not support image input/)
    const noService = adapter('openai')
    vi.spyOn(noService.modelsApi(), 'checkAuth').mockResolvedValue({ type: 'oauth' })
    await expect(drain(noService, 'gpt-5.5')).rejects.toThrow(/attachment service/)
  })
})
