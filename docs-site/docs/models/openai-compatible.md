# OpenAI-Compatible Servers

Use any server that exposes an OpenAI-compatible `/v1/chat/completions` endpoint — no individual integration required.

## Supported Servers
| Server | Type | Default Endpoint |
|--------|------|-----------------|
| **LM Studio** | Local | `http://localhost:1234/v1` |
| **LocalAI** | Local | `http://localhost:8080/v1` |
| **vLLM** | Local | `http://localhost:8000/v1` |
| **Groq** | Cloud | `https://api.groq.com/openai/v1` |
| **OpenRouter** | Cloud | `https://openrouter.ai/api/v1` |
| **Together AI** | Cloud | `https://api.together.xyz/v1` |

## Smart Setup Picker
When you select `openai-compatible` from the model picker, a guided flow appears:
1. Choose from popular server presets or enter a custom endpoint URL.
2. Enter the model name.
3. Settings are saved automatically.

## Authentication
Leave `ollama-code-review.openaiCompatible.apiKey` empty for local servers. Set it for cloud services like Groq or OpenRouter.
