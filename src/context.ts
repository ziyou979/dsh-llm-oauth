/**
 * Minimal harness → pi-ai context conversion (text, images, tools).
 * Image blocks are durable attachment references; the adapter reads their
 * request bytes through the host attachment service before conversion.
 */

import { contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message, RequestMessage } from '@deepseek-ai/dsh-llm'
import type {
  AssistantMessage,
  Context as PiContext,
  ImageContent,
  JsonObject,
  Message as PiMessage,
  TextContent,
  ThinkingContent,
  Tool as PiTool,
  ToolCall,
} from '@earendil-works/pi-ai'

/** Durable image reference fields this plugin reads (subset of dsh-attachment's ImageAttachmentRef). */
export interface ImageRef {
  attachmentId: string
  mediaType: string
  width: number
  height: number
}

/** Request-ready image bytes (subset of dsh-attachment's RequestImageAttachment). */
export interface RequestImage {
  data: Uint8Array
  mediaType: string
}

/** Structural view of the host `attachments` service used for image requests. */
export interface ImageRequestReader {
  readImageRequest(
    ref: never,
    target: { width: number, height: number, maxBytes: number },
    signal?: AbortSignal,
  ): Promise<RequestImage>
}

/** Request images keyed by attachment id. */
export type RequestImages = ReadonlyMap<string, RequestImage>

/** Same defaults as first-party dsh-llm-pi-ai: 2048×2048 pixel budget, 1 MiB encoded. */
const IMAGE_MAX_PIXELS = 4_194_304
const IMAGE_MAX_BYTES = 1_048_576

function imageTarget(ref: ImageRef): { width: number, height: number, maxBytes: number } {
  const scale = Math.min(1, Math.sqrt(IMAGE_MAX_PIXELS / (ref.width * ref.height)))
  return {
    width: Math.max(1, Math.floor(ref.width * scale)),
    height: Math.max(1, Math.floor(ref.height * scale)),
    maxBytes: IMAGE_MAX_BYTES,
  }
}

/**
 * Read request bytes for every non-offloaded image in the request.
 * @param messages - request messages.
 * @param attachments - host attachment service.
 * @param signal - request abort signal.
 */
export async function prepareRequestImages(
  messages: readonly RequestMessage[],
  attachments: ImageRequestReader,
  signal?: AbortSignal,
): Promise<RequestImages> {
  const refs = new Map<string, ImageRef>()
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'image' && block.offloaded !== true) {
        const ref = block.attachment as unknown as ImageRef
        refs.set(String(ref.attachmentId), ref)
      }
    }
  }
  const images = new Map<string, RequestImage>()
  for (const [id, ref] of refs) {
    images.set(id, await attachments.readImageRequest(ref as never, imageTarget(ref), signal))
  }
  return images
}

function imageName(ref: ImageRef & { name?: string }): string {
  return ref.name ?? String(ref.attachmentId)
}

/** User content: plain string when text-only, else text + image parts. */
function userContent(message: Message, images: RequestImages | undefined): string | Array<TextContent | ImageContent> {
  if (!contentHasImage(message.content)) return flattenText(message)
  const content: Array<TextContent | ImageContent> = []
  for (const block of message.content) {
    if (block.type === 'text') {
      if (block.text.length > 0) content.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      const ref = block.attachment as unknown as ImageRef & { name?: string }
      const image = block.offloaded === true ? undefined : images?.get(String(ref.attachmentId))
      if (image === undefined) {
        content.push({ type: 'text', text: `[image omitted: ${imageName(ref)}]` })
      } else {
        content.push({ type: 'image', data: Buffer.from(image.data).toString('base64'), mimeType: image.mediaType })
      }
    }
  }
  return content
}

function flattenText(message: Message): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

function toolResultText(blocks: readonly ContentBlock[]): string {
  return blocks.map(block => {
    if (block.type === 'text') return block.text
    if (block.type === 'tool-result') return toolResultText(block.content)
    return ''
  }).join('')
}

/**
 * Parse historical tool arguments into pi-ai's JSON object shape.
 * pi-ai >= 1.0.0 types `ToolCall.arguments` as `JsonObject`, so a malformed or
 * non-object payload must collapse to `{}` rather than an untyped record.
 */
function parseArguments(raw: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as JsonObject
    }
  } catch {
    // tolerate malformed historical arguments
  }
  return {}
}

function emptyUsage(): AssistantMessage['usage'] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function toAssistant(message: Message): AssistantMessage {
  if (message.source.kind !== 'model') {
    throw new LlmError('Assistant message is missing model provenance', 'UNSUPPORTED_CONTENT')
  }
  const content: Array<TextContent | ThinkingContent | ToolCall> = []
  for (const block of message.content) {
    if (block.type === 'text') content.push({ type: 'text', text: block.text })
    else if (block.type === 'reasoning') content.push({ type: 'thinking', thinking: block.text })
    else if (block.type === 'tool-call') {
      content.push({
        type: 'toolCall',
        id: String(block.id),
        name: block.name,
        arguments: parseArguments(block.arguments),
      })
    }
  }
  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: message.source.provider,
    model: message.source.model,
    usage: emptyUsage(),
    stopReason: 'stop',
    timestamp: 0,
  }
}

/**
 * Convert one assembled harness request into pi-ai's context envelope.
 * @param options - fully assembled model request.
 * @param images - request image bytes keyed by attachment id (required when images are present).
 */
export function toPiContext(options: GenerateOptions, images?: RequestImages): PiContext {
  for (const message of options.messages) {
    if ((message.role === 'assistant' || message.role === 'system') && contentHasImage(message.content)) {
      throw new LlmError(`dsh-llm-oauth cannot send an image in a ${message.role} message`, 'UNSUPPORTED_CONTENT')
    }
    if (images === undefined && message.content.some(b => b.type === 'image' && b.offloaded !== true)) {
      throw new LlmError('dsh-llm-oauth image content requires prepared request images', 'UNSUPPORTED_CONTENT')
    }
  }

  const toolNames = new Map<string, string>()
  const messages: PiMessage[] = []
  const leading = options.messages[0]
  const systemPrompt = options.system ?? (leading?.role === 'system' ? flattenText(leading) || undefined : undefined)
  const history = options.system === undefined && leading?.role === 'system'
    ? options.messages.slice(1) : options.messages

  for (const message of history) {
    if (message.role === 'system') {
      messages.push({ role: 'user', content: flattenText(message), timestamp: 0 })
      continue
    }
    if (message.role === 'assistant') {
      const assistant = toAssistant(message)
      for (const block of assistant.content) {
        if (block.type === 'toolCall') toolNames.set(block.id, block.name)
      }
      messages.push(assistant)
      continue
    }

    const content = userContent(message, images)
    const results = message.content.filter(block => block.type === 'tool-result')
    if (content.length > 0 || results.length === 0) {
      messages.push({ role: 'user', content, timestamp: 0 })
    }
    for (const result of results) {
      messages.push({
        role: 'toolResult',
        toolCallId: String(result.toolCallId),
        toolName: toolNames.get(String(result.toolCallId)) ?? 'unknown',
        content: [{ type: 'text', text: toolResultText(result.content) || '(no output)' }],
        isError: result.isError === true,
        timestamp: 0,
      })
    }
  }

  const tools: PiTool[] | undefined = options.tools?.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))

  return {
    ...systemPrompt !== undefined ? { systemPrompt } : {},
    messages,
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
  }
}
