#!/usr/bin/env python3
"""
api-handler.py — WhatsApp Agent LLM Handler (provider-agnostic, OpenAI-compatible)

Reads from stdin:  {"body": "<user message>", ...}
Writes to stdout:  {"response": "<llm response>"}

Configuration is fully driven by environment variables (typically loaded from
/run/openclaw-env). The handler talks to any OpenAI-compatible endpoint —
which today covers OpenRouter, OpenAI, Together, Groq, Fireworks, DeepInfra,
Anthropic's OAI-compat endpoint, vLLM/Ollama local, etc.

Environment variables:
  LLM_BASE_URL       OpenAI-compatible endpoint URL.
                     Default: https://openrouter.ai/api/v1
                     Examples:
                       OpenAI direct:    https://api.openai.com/v1
                       Anthropic OAI:    https://api.anthropic.com/v1/
                       Together AI:      https://api.together.xyz/v1
                       Groq:             https://api.groq.com/openai/v1
                       Local (vLLM):     http://localhost:8000/v1
  LLM_API_KEY_VAR    Name of the env var that holds the API key.
                     Default: MODELO_API_KEY
                     (kept as default for backward compat with v0.1.0 deployments.)
  LLM_MODELS         Comma-separated list of model slugs, primary first,
                     remaining are the fallback chain. REQUIRED — no default,
                     because slugs are provider-specific.
                     Example: "anthropic/claude-haiku-4-5,openai/gpt-4o-mini,google/gemini-2.0-flash"
  LLM_TIMEOUT        Per-call timeout, seconds. Default: 30
  LLM_MAX_TOKENS     Max output tokens. Default: 500
  LLM_ENV_FILE       Path to env file to bootstrap. Default: /run/openclaw-env

CUSTOMIZE the SYSTEM_PROMPT below for the agent's persona/rules.
"""
import sys
import json
import os

ENV_FILE = os.environ.get('LLM_ENV_FILE', '/run/openclaw-env')


def load_env(path: str) -> None:
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and '=' in line and not line.startswith('#'):
                key, _, val = line.partition('=')
                os.environ.setdefault(key.strip(), val.strip())


load_env(ENV_FILE)

# CUSTOMIZE: your agent's persona, context, and rules
SYSTEM_PROMPT = """You are a helpful virtual assistant. Reply clearly and concisely.
[CUSTOMIZE: agent name, business context, tone, language, rules, restrictions]"""

# Provider-agnostic configuration — read from environment, never hardcoded
LLM_BASE_URL = os.environ.get('LLM_BASE_URL', 'https://openrouter.ai/api/v1')
LLM_API_KEY_VAR = os.environ.get('LLM_API_KEY_VAR', 'MODELO_API_KEY')
LLM_API_KEY = os.environ.get(LLM_API_KEY_VAR, '')
LLM_MODELS = [m.strip() for m in os.environ.get('LLM_MODELS', '').split(',') if m.strip()]
LLM_TIMEOUT = int(os.environ.get('LLM_TIMEOUT', '30'))
LLM_MAX_TOKENS = int(os.environ.get('LLM_MAX_TOKENS', '500'))

FALLBACK_RESPONSE = (
    'Sorry, I am having technical difficulties right now. '
    'Please try again in a few minutes.'
)


def call_llm(message: str) -> str:
    if not LLM_API_KEY:
        print(f'[WARN] {LLM_API_KEY_VAR} not set in environment', file=sys.stderr)
        return FALLBACK_RESPONSE
    if not LLM_MODELS:
        print('[WARN] LLM_MODELS not set in environment (comma-separated slugs required)', file=sys.stderr)
        return FALLBACK_RESPONSE

    try:
        from openai import OpenAI
    except ImportError:
        print('[WARN] openai package not installed (pip3 install openai)', file=sys.stderr)
        return FALLBACK_RESPONSE

    client = OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY)

    for model in LLM_MODELS:
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {'role': 'system', 'content': SYSTEM_PROMPT},
                    {'role': 'user', 'content': message},
                ],
                max_tokens=LLM_MAX_TOKENS,
                timeout=LLM_TIMEOUT,
            )
            return resp.choices[0].message.content
        except Exception as e:
            print(f'[WARN] Model {model} failed: {e}', file=sys.stderr)

    return FALLBACK_RESPONSE


def main() -> None:
    raw = sys.stdin.read()
    msg = json.loads(raw)
    response_text = call_llm(msg['body'])
    print(json.dumps({'response': response_text}))


if __name__ == '__main__':
    main()
