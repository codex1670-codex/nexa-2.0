// Real LLM integration. Requires ANTHROPIC_API_KEY in the environment — this is NOT a
// mock. If no key is configured, every function here returns { ok: false, reason: 'not_configured' }
// and callers must surface that honestly rather than pretending the AI ran.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest';

export function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

async function callAnthropic(body) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Plain text generation for bio Write/Improve/Professional/Shorter/Translate.
export async function generateText({ system, prompt, maxTokens = 200 }) {
  if (!isConfigured()) return { ok: false, reason: 'not_configured' };
  try {
    const data = await callAnthropic({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = data.content?.find(b => b.type === 'text')?.text?.trim() || '';
    return { ok: true, text };
  } catch (err) {
    return { ok: false, reason: 'api_error', message: err.message };
  }
}

// Tool-calling based intent resolution for Codex: the model picks ONE tool from the
// allowlisted registry (or none, if nothing fits) — it never gets free-form execution
// power, only the ability to choose which pre-defined, backend-validated action to invoke.
export async function resolveIntent({ text, tools, context }) {
  if (!isConfigured()) return { ok: false, reason: 'not_configured' };
  try {
    const data = await callAnthropic({
      model: MODEL,
      max_tokens: 400,
      system: `You are Codex, an assistant inside the NEXA app. Your ONLY job is to map the user's message to one tool call from the provided list, or call no_match if nothing fits. Never invent actions outside the provided tools. Context: ${JSON.stringify(context || {})}`,
      messages: [{ role: 'user', content: text }],
      tools: [...tools, {
        name: 'no_match',
        description: 'Call this if the user\'s message does not clearly match any other available tool.',
        input_schema: { type: 'object', properties: { reason: { type: 'string' } } },
      }],
      tool_choice: { type: 'any' },
    });
    const toolUse = data.content?.find(b => b.type === 'tool_use');
    if (!toolUse) return { ok: true, action: null };
    return { ok: true, action: { name: toolUse.name, input: toolUse.input } };
  } catch (err) {
    return { ok: false, reason: 'api_error', message: err.message };
  }
}
