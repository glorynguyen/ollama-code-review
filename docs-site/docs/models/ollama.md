# Local Ollama

Run powerful AI models directly on your machine for maximum privacy and zero cost.

## Installation

1.  Download and install **Ollama** from [ollama.com](https://ollama.com/).
2.  Pull a recommended coding model:
    ```bash
    ollama pull qwen2.5-coder:7b
    ```

## Auto-Discovery

The extension automatically detects your local Ollama instance and fetches all installed models. You can see them in the model selection menu.

## Custom Endpoint

If your Ollama instance is running on a different machine or port, you can configure the endpoint in settings:

- **Setting:** `ollama-code-review.endpoint`
- **Default:** `http://localhost:11434/api/generate`

## Recommended Models

- **Qwen2.5-Coder:** Excellent all-around performance for coding tasks.
- **DeepSeek-Coder-V2:** Highly capable for complex logic.
- **Llama 3.1 / 3.2:** Good for general code reviews and explanations.
- **Codellama:** A classic choice specifically tuned for code.
