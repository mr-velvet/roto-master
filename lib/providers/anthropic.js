// Wrapper minimalista da Anthropic Messages API.
// Usado pelo "melhorar prompt".
//
// Modelo default: Sonnet 4.6 (o user pediu explicitamente — Haiku é fraco demais
// pra reescrita criativa).

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

async function complete({ system, user, model = DEFAULT_MODEL, max_tokens = 800 }) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`anthropic ${r.status}: ${text.slice(0, 300)}`);
  }
  const data = await r.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new Error('anthropic: resposta vazia');
  return { text, usage: data.usage || null };
}

module.exports = { complete };
