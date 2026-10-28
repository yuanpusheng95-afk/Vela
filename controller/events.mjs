// Keep useful model/tool output, never private reasoning. Both live and legacy logs use this projection.
export function redactText(value, secret = '') {
  let text = String(value ?? '');
  if (secret) text = text.split(secret).join('[REDACTED]');
  return text.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|password|authorization|access[_-]?token)\s*[=:]\s*)[^\s,;"']+/gi, '$1[REDACTED]');
}

export function projectEvent(event, redact = redactText) {
  const short = (value, limit = 4000) => redact(typeof value === 'string' ? value : JSON.stringify(value ?? '')).slice(0, limit);
  switch (event.type) {
    case 'thinking': return null;
    case 'session': return { type: event.type, sessionId: short(event.sessionId, 200) };
    case 'status': return { type: event.type, phase: short(event.phase, 100), turn: event.turn, step: event.step, reason: event.reason?.kind };
    case 'text': case 'final': return { type: event.type, text: short(event.text, 12000) };
    case 'tool_call': return { type: event.type, callId: short(event.callId, 200), tool: short(event.tool || event.name, 120), input: short(event.input, 2000) };
    case 'tool_result': return { type: event.type, callId: short(event.callId, 200), status: short(event.status, 80), result: short(event.result) };
    case 'error': return { type: event.type, message: short(event.message || event.error) };
    default: return { type: short(event.type, 100) };
  }
}
