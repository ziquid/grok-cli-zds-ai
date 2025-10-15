/**
 * Centralized backend configuration
 * Single source of truth for backend service names, URLs, and display names
 */

export interface BackendConfig {
  name: string; // Internal service name (e.g., "grok", "openai")
  displayName: string; // User-friendly display name (e.g., "Grok", "OpenAI")
  baseURL: string; // API base URL
  defaultModel?: string; // Default model for this backend
}

/**
 * Backend configuration registry
 * Maps internal service names to their configuration
 */
export const BACKEND_CONFIGS: Record<string, BackendConfig> = {
  grok: {
    name: "grok",
    displayName: "Grok",
    baseURL: "https://api.x.ai/v1",
    defaultModel: "grok-code-fast-1",
  },
  openai: {
    name: "openai",
    displayName: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
  },
  claude: {
    name: "claude",
    displayName: "Claude",
    baseURL: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4.5",
  },
  openrouter: {
    name: "openrouter",
    displayName: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "x-ai/grok-code-fast-1",
  },
  ollama: {
    name: "ollama",
    displayName: "Ollama",
    baseURL: "http://localhost:11434/v1",
    defaultModel: "qwen2.5-coder:32b",
  },
  "ollama-local": {
    name: "ollama-local",
    displayName: "Ollama (Local)",
    baseURL: "http://localhost:11434/v1",
    defaultModel: "qwen2.5-coder:32b",
  },
  "ollama-remote": {
    name: "ollama-remote",
    displayName: "Ollama (Remote)",
    baseURL: "http://ollama:11434/v1",
    defaultModel: "qwen2.5-coder:32b",
  },
};

/**
 * Get backend configuration by service name
 */
export function getBackendConfig(serviceName: string): BackendConfig | undefined {
  return BACKEND_CONFIGS[serviceName.toLowerCase()];
}

/**
 * Get base URL for a backend service
 */
export function getBackendBaseURL(serviceName: string): string | undefined {
  const config = getBackendConfig(serviceName);
  return config?.baseURL;
}

/**
 * Get display name for a backend service
 */
export function getBackendDisplayName(serviceName: string): string {
  const config = getBackendConfig(serviceName);
  return config?.displayName || serviceName;
}

/**
 * Detect backend service from a base URL
 * Returns the service name and display name
 */
export function detectBackendFromURL(baseURL: string): {
  serviceName: string;
  displayName: string;
} {
  const url = baseURL.toLowerCase();

  // Check known backends
  if (url.includes("x.ai")) {
    return { serviceName: "grok", displayName: "Grok" };
  }
  if (url.includes("openai.com")) {
    return { serviceName: "openai", displayName: "OpenAI" };
  }
  if (url.includes("anthropic.com")) {
    return { serviceName: "claude", displayName: "Claude" };
  }
  if (url.includes("openrouter.ai")) {
    return { serviceName: "openrouter", displayName: "OpenRouter" };
  }
  if (
    url.includes("localhost:11434") ||
    url.includes("127.0.0.1:11434") ||
    url.includes(":11434")
  ) {
    return { serviceName: "ollama", displayName: "Ollama" };
  }

  // For custom URLs, extract hostname
  try {
    const urlObj = new URL(baseURL);
    return { serviceName: "custom", displayName: urlObj.hostname };
  } catch {
    return { serviceName: "custom", displayName: "API" };
  }
}

/**
 * Get all available backend service names
 */
export function getAllBackendNames(): string[] {
  return Object.keys(BACKEND_CONFIGS);
}

/**
 * Check if a model name indicates Ollama Cloud usage (has -cloud suffix)
 */
export function isOllamaCloudModel(modelName: string): boolean {
  return modelName.toLowerCase().includes("-cloud");
}

/**
 * Get display name for backend, accounting for Ollama Cloud models
 */
export function getBackendDisplayNameWithModel(
  serviceName: string,
  modelName: string
): string {
  const baseDisplayName = getBackendDisplayName(serviceName);

  // Special case: Ollama with cloud model
  if (serviceName === "ollama" && isOllamaCloudModel(modelName)) {
    return "Ollama Cloud";
  }

  return baseDisplayName;
}
