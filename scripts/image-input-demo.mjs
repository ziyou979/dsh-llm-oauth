// Offline demo: pi-ai openai Responses serialization of a user image (no network, no credentials).
import { createModels } from '@earendil-works/pi-ai'
import { convertResponsesMessages } from '@earendil-works/pi-ai/api/openai-responses-shared'
import { resolveOAuthProviders } from '../lib/index.js'

const models = createModels({})
for (const provider of resolveOAuthProviders(['openai'])) models.setProvider(provider)
const model = models.getModel('openai', 'gpt-5.5')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const context = { messages: [{ role: 'user', timestamp: 0, content: [
  { type: 'text', text: 'What is in this screenshot?' },
  { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
] }] }
console.log('model', model.provider, model.id, model.api, model.baseUrl, 'input:', model.input)
console.log(JSON.stringify(convertResponsesMessages(model, context, new Set(['openai'])), null, 2))
