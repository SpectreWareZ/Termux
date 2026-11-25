#!/data/data/com.termux/files/usr/bin/node
// claude-relay.cjs — Anthropic-wire front for OpenAI-wire upstreams (Termux)
// Claude Code -> 127.0.0.1:8789 (/v1/messages, anthropic wire)
//            -> <RELAY_UPSTREAM>/chat/completions (openai wire)
// แปลง request/response ทั้งสองทาง + retry + key rotation
//
// env: RELAY_PORT RELAY_UPSTREAM RELAY_KEYS (คั่นด้วย ,) RELAY_MODEL
//      RELAY_TRIES RELAY_TIMEOUT_MS RELAY_LOG
const http = require('node:http');
const fs = require('node:fs');

const PORT = Number(process.env.RELAY_PORT || 8789);
const UP = (process.env.RELAY_UPSTREAM || '').replace(/\/+$/, '');
const KEYS = (process.env.RELAY_KEYS || process.env.RELAY_KEY || '').split(',').map((s) => s.trim()).filter(Boolean);
const MODEL = process.env.RELAY_MODEL || 'deepseek-v4.1-flash-free';
const TRIES = Number(process.env.RELAY_TRIES || 6);
const TIMEOUT = Number(process.env.RELAY_TIMEOUT_MS || 240000);
const LOG = process.env.RELAY_LOG || '';
const STREAM = process.env.RELAY_DISABLE_STREAM !== '1';

if (!UP || !KEYS.length) {
  console.error('claude-relay: RELAY_UPSTREAM and RELAY_KEYS are required');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function logfs(msg) {
  if (!LOG) return;
  try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + msg + '\n'); } catch (e) {}
}

function blocksToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => {
    if (b.type === 'text') return b.text || '';
    if (b.type === 'tool_result') {
      const inner = typeof b.content === 'string' ? b.content : blocksToText(b.content);
      return '[tool_result ' + (b.tool_use_id || '') + ']\n' + inner;
    }
    if (b.type === 'image') return '[image]';
    return '';
  }).filter(Boolean).join('\n');
}

function anthropicToOpenAI(body) {
  const messages = [];
  if (body.system) {
    messages.push({ role: 'system', content: typeof body.system === 'string' ? body.system : blocksToText(body.system) });
  }
  for (const m of body.messages || []) {
    messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: blocksToText(m.content) });
  }
  const out = { model: MODEL, messages: messages, max_tokens: body.max_tokens || 4096 };
  if (body.temperature != null) out.temperature = body.temperature;
  if (body.top_p != null) out.top_p = body.top_p;
  if (body.stop_sequences) out.stop = body.stop_sequences;

  if (Array.isArray(body.tools) && body.tools.length && !body.tool_choice_none) {
    out.tools = body.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} } }
    }));
    if (body.tool_choice && body.tool_choice.type === 'none') delete out.tools;
    else if (body.tool_choice && body.tool_choice.type === 'tool' && body.tool_choice.name) {
      out.tool_choice = { type: 'function', function: { name: body.tool_choice.name } };
    }
  }
  return out;
}

function openAIToAnthropic(j) {
  const ch = (j.choices && j.choices[0]) || {};
  const msg = ch.message || {};
  const content = [];
  if (msg.reasoning_content) content.push({ type: 'thinking', thinking: String(msg.reasoning_content) });
  if (msg.content && String(msg.content).trim()) content.push({ type: 'text', text: String(msg.content) });
  for (const tc of msg.tool_calls || []) {
    let input = {};
    try { input = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : (tc.function.arguments || {}); } catch (e) { input = { raw: tc.function.arguments }; }
    content.push({ type: 'tool_use', id: tc.id || ('toolu_' + Date.now()), name: tc.function && tc.function.name, input: input });
  }
  const stopMap = { stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use', function_call: 'tool_use' };
  const usage = j.usage || {};
  return {
    id: j.id || ('msg_' + Date.now()),
    type: 'message', role: 'assistant',
    model: j.model || MODEL,
    content: content.length ? content : [{ type: 'text', text: '' }],
    stop_reason: stopMap[ch.finish_reason] || 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: usage.prompt_tokens || 0, output_tokens: usage.completion_tokens || 0 }
  };
}

function toSSE(msg) {
  const out = [];
  out.push('event: message_start\ndata: ' + JSON.stringify({
    type: 'message_start',
    message: { id: msg.id, type: 'message', role: 'assistant', model: msg.model,
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: msg.usage.input_tokens, output_tokens: 0 } }
  }) + '\n\n');
  msg.content.forEach((b, idx) => {
    if (b.type === 'text') {
      out.push('event: content_block_start\ndata: ' + JSON.stringify({ type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } }) + '\n\n');
      out.push('event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text: b.text } }) + '\n\n');
      out.push('event: content_block_stop\ndata: ' + JSON.stringify({ type: 'content_block_stop', index: idx }) + '\n\n');
    } else if (b.type === 'tool_use') {
      out.push('event: content_block_start\ndata: ' + JSON.stringify({ type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } }) + '\n\n');
      out.push('event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } }) + '\n\n');
      out.push('event: content_block_stop\ndata: ' + JSON.stringify({ type: 'content_block_stop', index: idx }) + '\n\n');
    } else if (b.type === 'thinking') {
      out.push('event: content_block_start\ndata: ' + JSON.stringify({ type: 'content_block_start', index: idx, content_block: { type: 'thinking', thinking: '' } }) + '\n\n');
      out.push('event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', index: idx, delta: { type: 'thinking_delta', thinking: b.thinking } }) + '\n\n');
      out.push('event: content_block_stop\ndata: ' + JSON.stringify({ type: 'content_block_stop', index: idx }) + '\n\n');
    }
  });
  out.push('event: message_delta\ndata: ' + JSON.stringify({
    type: 'message_delta',
    delta: { stop_reason: msg.stop_reason, stop_sequence: null },
    usage: { output_tokens: msg.usage.output_tokens }
  }) + '\n\n');
  out.push('event: message_stop\ndata: ' + JSON.stringify({ type: 'message_stop' }) + '\n\n');
  return out.join('');
}

function okBody(status, text) {
  if (status !== 200 || !text || text.length < 20) return false;
  try {
    const j = JSON.parse(text);
    if (j.error) return false;
    const ch = (j.choices && j.choices[0]) || null;
    if (!ch) return false;
    const m = ch.message || {};
    if (m.content && String(m.content).trim().length) return true;
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) return true;
    if (m.reasoning_content) return true;
    return false;
  } catch (e) { return false; }
}

async function callUpstream(payload) {
  let last = { status: 502, text: '{"error":{"type":"relay_error","message":"no attempt"}}' };
  for (let i = 1; i <= TRIES; i++) {
    const key = KEYS[(i - 1) % KEYS.length];
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT);
    try {
      const r = await fetch(UP + '/chat/completions', {
        method: 'POST', signal: ac.signal,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: Buffer.from(JSON.stringify(payload))
      });
      const text = await r.text();
      clearTimeout(timer);
      last = { status: r.status, text: text };
      if (okBody(r.status, text)) { if (i > 1) logfs('ok after ' + i + ' tries'); return last; }
      logfs('try ' + i + '/' + TRIES + ' key#' + ((i - 1) % KEYS.length + 1) + ' status=' + r.status + ' len=' + text.length + ' ' + text.slice(0, 90).replace(/\n/g, ' '));
    } catch (e) {
      clearTimeout(timer);
      last = { status: 504, text: JSON.stringify({ error: { type: 'relay_timeout', message: String(e && e.message) } }) };
      logfs('try ' + i + '/' + TRIES + ' threw ' + String(e && e.message).slice(0, 80));
    }
    if (i < TRIES) await sleep(Math.min(700 * i, 2500));
  }
  return last;
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const path = (req.url || '/').split('?')[0];

    if (path === '/health' || path === '/') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, upstream: UP, model: MODEL, keys: KEYS.length, tries: TRIES }));
      return;
    }
    if (path === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: MODEL, type: 'model' }] }));
      return;
    }

    let body;
    try { body = raw ? JSON.parse(raw) : {}; } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end('{"error":{"type":"invalid_request_error","message":"bad json"}}');
      return;
    }

    const wantsStream = body.stream === true;
    const payload = anthropicToOpenAI(body);
    const out = await callUpstream(payload);

    if (out.status !== 200 || !okBody(out.status, out.text)) {
      logfs('giving up: status=' + out.status + ' body=' + String(out.text).slice(0, 140).replace(/\n/g, ' '));
      res.writeHead(out.status === 200 ? 502 : out.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'api_error', message: 'upstream failed: ' + String(out.text).slice(0, 200) } }));
      return;
    }

    const msg = openAIToAnthropic(JSON.parse(out.text));

    if (!wantsStream || !STREAM) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(msg));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.end(toSSE(msg));
    logfs('streamed ' + msg.content.length + ' blocks, text=' + (msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').length) + ' chars');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('claude-relay 127.0.0.1:' + PORT + ' -> ' + UP + ' model=' + MODEL + ' keys=' + KEYS.length + ' tries=' + TRIES);
});
