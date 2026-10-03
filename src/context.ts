/**
 * Minimal harness → pi-ai context conversion (text + tools).
 * Image content is refused; use first-party dsh-llm-pi-ai for vision.
 */

import { contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type {
  AssistantMessage,
  Context as PiContext,
  JsonObject,
  Message as PiMessage,
  TextContent,
  ThinkingContent,
  Tool as PiTool,
  ToolCall,
} from '@earendil-works/pi-ai'

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
 */
export function toPiContext(options: GenerateOptions): PiContext {
  if (options.messages.some(message => contentHasImage(message.content))) {
    throw new LlmError(
      'dsh-llm-oauth does not support image content; use dsh-llm-pi-ai for vision models',
      'UNSUPPORTED_CONTENT',
    )
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

    const text = flattenText(message)
    const results = message.content.filter(block => block.type === 'tool-result')
    if (text.length > 0 || results.length === 0) {
      messages.push({ role: 'user', content: text, timestamp: 0 })
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
