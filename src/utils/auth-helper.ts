/**
 * Authentication helper utilities
 * Handles API key retrieval from multiple sources with proper fallback logic
 */

import { getSettingsManager } from "./settings-manager.js";

/**
 * Get API key with proper fallback logic:
 * 1. Environment variable (GROK_API_KEY)
 * 2. User settings file (~/.grok/user-settings.json)
 * 3. Command-line argument (passed explicitly)
 *
 * @param explicitApiKey - API key passed via command-line argument (highest priority)
 * @returns API key or undefined if not found
 */
export function getApiKey(explicitApiKey?: string): string | undefined {
  // Priority 1: Explicit API key from command-line argument
  if (explicitApiKey) {
    return explicitApiKey;
  }

  // Priority 2: Environment variable
  const envApiKey = process.env.GROK_API_KEY;
  if (envApiKey) {
    return envApiKey;
  }

  // Priority 3: User settings file
  try {
    const manager = getSettingsManager();
    return manager.getUserSetting("apiKey");
  } catch (error) {
    // Silently ignore errors loading from settings
    return undefined;
  }
}

/**
 * Get base URL with proper fallback logic:
 * 1. Explicit base URL from command-line argument
 * 2. Environment variable (GROK_BASE_URL)
 * 3. User settings file (~/.grok/user-settings.json)
 * 4. Default value
 *
 * @param explicitBaseURL - Base URL passed via command-line argument (highest priority)
 * @param defaultBaseURL - Default base URL to use if none found (default: https://api.x.ai/v1)
 * @returns Base URL
 */
export function getBaseURL(
  explicitBaseURL?: string,
  defaultBaseURL: string = "https://api.x.ai/v1"
): string {
  // Priority 1: Explicit base URL from command-line argument
  if (explicitBaseURL) {
    return explicitBaseURL;
  }

  // Priority 2: Environment variable
  const envBaseURL = process.env.GROK_BASE_URL;
  if (envBaseURL) {
    return envBaseURL;
  }

  // Priority 3: User settings file
  try {
    const manager = getSettingsManager();
    const userBaseURL = manager.getUserSetting("baseURL");
    if (userBaseURL) {
      return userBaseURL;
    }
  } catch (error) {
    // Silently ignore errors loading from settings
  }

  // Priority 4: Default value
  return defaultBaseURL;
}

/**
 * Get model with proper fallback logic:
 * 1. Explicit model from command-line argument
 * 2. Environment variable (GROK_MODEL)
 * 3. Project-specific model setting
 * 4. User's default model
 * 5. Default value
 *
 * @param explicitModel - Model passed via command-line argument (highest priority)
 * @param defaultModel - Default model to use if none found (default: grok-code-fast-1)
 * @returns Model name
 */
export function getModel(
  explicitModel?: string,
  defaultModel: string = "grok-code-fast-1"
): string {
  // Priority 1: Explicit model from command-line argument
  if (explicitModel) {
    return explicitModel;
  }

  // Priority 2: Environment variable
  const envModel = process.env.GROK_MODEL;
  if (envModel) {
    return envModel;
  }

  // Priority 3-4: Project-specific or user's default model
  try {
    const manager = getSettingsManager();
    return manager.getCurrentModel();
  } catch (error) {
    // Silently ignore errors loading from settings
  }

  // Priority 5: Default value
  return defaultModel;
}

/**
 * Validate that required authentication is present
 * Throws an error with helpful message if API key is missing
 *
 * @param apiKey - API key to validate
 * @throws Error if API key is undefined or empty
 */
export function validateApiKey(apiKey: string | undefined): asserts apiKey is string {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error(
      "API key required. Set GROK_API_KEY environment variable, use --api-key flag, or save to ~/.grok/user-settings.json"
    );
  }
}

/**
 * Get all authentication configuration with proper fallbacks
 * Convenience function that combines all auth-related getters
 *
 * @param options - Optional explicit values from command-line arguments
 * @returns Complete authentication configuration
 */
export function getAuthConfig(options: {
  apiKey?: string;
  baseURL?: string;
  model?: string;
} = {}): {
  apiKey: string | undefined;
  baseURL: string;
  model: string;
} {
  return {
    apiKey: getApiKey(options.apiKey),
    baseURL: getBaseURL(options.baseURL),
    model: getModel(options.model),
  };
}
