const SECRET_KEY_PATTERN = /(token|secret|api[_-]?key|password|credential|authorization|bearer)\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{12,})/gi;
const ENV_SECRET_PATTERN = /(OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|VERCEL_TOKEN)=([^\s]+)/gi;

export function redactSecrets(input = ""): string {
  return input
    .replace(SECRET_KEY_PATTERN, (_match, key) => `${key}=<redacted>`)
    .replace(ENV_SECRET_PATTERN, (_match, key) => `${key}=<redacted>`);
}
