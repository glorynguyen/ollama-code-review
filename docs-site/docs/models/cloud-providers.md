# Cloud Providers

Ollama Code Review supports a wide range of state-of-the-art cloud AI models.

## Supported Providers

| Provider | Models | API Key Setting |
|----------|--------|-----------------|
| **Gemini** | `gemini-2.5-flash`, `gemini-2.5-pro` | `geminiApiKey` |
| **Claude** | `claude-3-7-sonnet`, `claude-3-5-sonnet` | `claudeApiKey` |
| **Mistral** | `mistral-large-latest`, `codestral-latest` | `mistralApiKey` |
| **GLM** | `glm-4.7-flash` | `glmApiKey` |
| **MiniMax** | `MiniMax-M2.5` | `minimaxApiKey` |
| **v0** | `v0-auto`, `v0-max` | `v0ApiKey` |
| **Hugging Face** | thousands of models | `hfApiKey` |

## Setup

1.  **Get an API Key:** Visit the provider's website (links in the root README) and generate a key.
2.  **Configure in VS Code:**
    - Open Settings (`Cmd+,`).
    - Search for `Ollama Code Review`.
    - Paste your key into the corresponding field.
3.  **Switch Model:**
    - Click the model name in the VS Code **Status Bar**.
    - Select your preferred cloud model from the list.

## Why use Cloud Models?

- **Zero Setup:** No need to install and manage local software like Ollama.
- **Superior Reasoning:** Models like Claude 3.7 and Gemini Pro often provide deeper architectural insights than smaller local models.
- **Speed:** Cloud models can be significantly faster if you don't have a high-end GPU.
- **Free Tiers:** Providers like Google (Gemini) and GLM offer generous free tiers.
