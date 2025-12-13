import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat";
import { ChatHistoryManager } from "../utils/chat-history-manager.js";
import { logApiError } from "../utils/error-logger.js";
import fs from "fs";

export type GrokMessage = ChatCompletionMessageParam;

export interface GrokTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required: string[];
    };
  };
}

export interface GrokToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface SearchParameters {
  mode?: "auto" | "on" | "off";
  // sources removed - let API use default sources to avoid format issues
}

export interface SearchOptions {
  search_parameters?: SearchParameters;
}

export interface GrokResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: GrokToolCall[];
    };
    finish_reason: string;
  }>;
}

export class GrokClient {
  private client: OpenAI;
  private currentModel: string = "grok-code-fast-1";
  private defaultMaxTokens: number;
  private backendName: string;
  private supportsTools: boolean = true;
  private supportsVision: boolean = true;

  constructor(apiKey: string, model?: string, baseURL?: string, displayName?: string) {
    const finalBaseURL = baseURL || process.env.GROK_BASE_URL || "https://api.x.ai/v1";
    this.client = new OpenAI({
      apiKey,
      baseURL: finalBaseURL,
      timeout: 360000,
    });
    const envMax = Number(process.env.GROK_MAX_TOKENS);
    this.defaultMaxTokens = Number.isFinite(envMax) && envMax > 0 ? envMax : 1536;
    if (model) {
      this.currentModel = model;
    }

    // Use provided display name, or derive from baseURL hostname as fallback
    if (displayName) {
      this.backendName = displayName;
    } else {
      // Simple fallback: extract hostname from URL
      try {
        const url = new URL(finalBaseURL);
        // Special case: api.x.ai should be "grok" not "x"
        if (url.hostname === 'api.x.ai') {
          this.backendName = 'grok';
        } else {
          this.backendName = url.hostname.replace(/^api\./, '').replace(/\..*$/, '');
        }
      } catch {
        this.backendName = 'AI';
      }
    }
  }

  async setModel(model: string): Promise<void> {
    this.currentModel = model;
    // Reset tool and vision support flags when switching models
    await this.enableTools();
    this.enableVision();
  }

  private async enableTools(): Promise<void> {
    if (this.supportsTools) {
      return; // Already enabled
    }

    this.supportsTools = true;

    // Reinitialize MCP servers
    try {
      const { getMCPManager, initializeMCPServers } = await import('../grok/tools.js');
      const { loadMCPConfig } = await import('../mcp/config.js');
      const config = loadMCPConfig();

      if (config.servers.length > 0) {
        await initializeMCPServers();
        console.error(`MCP servers reinitialized.`);
      }
    } catch (mcpError: any) {
      console.warn("MCP reinitialization failed:", mcpError);
    }
  }

  private enableVision(): void {
    if (this.supportsVision) {
      return; // Already enabled
    }

    this.supportsVision = true;
  }

  getCurrentModel(): string {
    return this.currentModel;
  }

  getBaseURL(): string {
    return this.client.baseURL || "https://api.x.ai/v1";
  }

  getBackendName(): string {
    return this.backendName;
  }

  getSupportsTools(): boolean {
    return this.supportsTools;
  }

  getSupportsVision(): boolean {
    return this.supportsVision;
  }

  async chat(
    messages: GrokMessage[],
    tools?: GrokTool[],
    model?: string,
    searchOptions?: SearchOptions,
    temperature?: number,
    signal?: AbortSignal,
    maxTokens?: number
  ): Promise<GrokResponse> {
    const maxRetries = 5;
    const retryDelay = 10000; // 10 seconds

    const requestPayload: any = {
      model: model || this.currentModel,
      messages,
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens ?? this.defaultMaxTokens
    };

    // Only include tools if the model supports them AND tools are provided
    if (this.supportsTools && tools && tools.length > 0) {
      requestPayload.tools = tools;
      requestPayload.tool_choice = "auto";
    }

    // Only add think parameter for backends that support it (Grok, Ollama)
    const backendLower = this.backendName.toLowerCase();
    const supportsThink = backendLower === 'grok' ||
                          backendLower === 'ollama' ||
                          this.client.baseURL?.includes('x.ai');
    if (supportsThink) {
      requestPayload.think = false;
    }

    // Add search parameters if specified and using Grok API (x.ai)
    if (searchOptions?.search_parameters && this.client.baseURL?.includes('x.ai')) {
      requestPayload.search_parameters = searchOptions.search_parameters;
    }

    // Log tools being sent to API
    const toolNames = (tools || []).map(t => t.function.name);
    const mcpTools = toolNames.filter(name => name.startsWith('mcp__'));

    const debugLogPath = ChatHistoryManager.getDebugLogPath();
    const logEntry = `${new Date().toISOString()} - API CALL: ${toolNames.length} tools (${mcpTools.length} MCP: ${mcpTools.join(', ')})\n`;
    fs.appendFileSync(debugLogPath, logEntry);

    // Retry loop for 429 errors
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create(
          requestPayload,
          { signal: signal as any }
        );
        return response as GrokResponse;
      } catch (error: any) {
        // Check if model doesn't support tools
        const isToolsNotSupported = error.status === 400 &&
                                    error.message &&
                                    error.message.toLowerCase().includes('does not support tools');

        if (isToolsNotSupported && this.supportsTools) {
          // Disable tools for this model and rebuild request without tools
          this.supportsTools = false;
          console.error(`Model does not support tools.  Retrying without tools...`);

          // Shutdown MCP servers since they won't be usable without tools
          try {
            const { getMCPManager } = await import('../grok/tools.js');
            const mcpManager = getMCPManager();
            await mcpManager.shutdown();
            console.error(`MCP servers shut down.`);
          } catch (mcpError: any) {
            console.warn("MCP shutdown failed:", mcpError);
          }

          // Rebuild request payload without tools
          delete requestPayload.tools;
          delete requestPayload.tool_choice;

          continue;
        }

        // Check if model doesn't support vision (400 errors) or request is too large (413 errors)
        const isVisionNotSupported = ((error.status === 400 &&
                                       error.message &&
                                       (error.message.toLowerCase().includes('does not support vision') ||
                                        error.message.toLowerCase().includes('does not support images') ||
                                        error.message.toLowerCase().includes('image inputs are not supported') ||
                                        error.message.toLowerCase().includes('image_url'))) ||
                                      (error.status === 413 &&
                                       error.message &&
                                       error.message.toLowerCase().includes('request entity too large')));

        if (isVisionNotSupported && this.supportsVision) {
          // Disable vision for this model and rebuild request without images
          this.supportsVision = false;
          console.error(`Model does not support vision.  Retrying without images...`);

          // Strip images from all messages
          requestPayload.messages = requestPayload.messages.map((msg: any) => {
            if (Array.isArray(msg.content)) {
              // Keep only text content, remove image_url entries
              const textContent = msg.content.filter((item: any) => item.type === 'text');
              return {
                ...msg,
                content: textContent.length > 0 ? textContent[0].text : ''
              };
            }
            return msg;
          });

          continue;
        }

        // Check if it's a 429 rate limit error
        const is429 = error.status === 429 ||
                      error.code === 'rate_limit_exceeded' ||
                      (error.message && error.message.toLowerCase().includes('rate limit'));

        if (is429 && attempt < maxRetries) {
          console.error(`Rate limit hit (429). Retrying in ${retryDelay/1000}s... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }

        // Log 500 errors with full request/response for debugging
        if (error.status === 500) {
          const { requestFile, responseFile } = await logApiError(
            requestPayload,
            error,
            { errorType: 'runtime-api-error' },
            '500'
          );

          // Throw error with file references
          throw new Error(`${this.backendName} API error: ${error.message}\nRequest logged to: ${requestFile}\nResponse logged to: ${responseFile}`);
        }

        // If not 429 or out of retries, throw the error
        throw new Error(`${this.backendName} API error: ${error.message}`);
      }
    }

    // Should never reach here, but TypeScript needs it
    throw new Error('Grok API error: Max retries exceeded');
  }

  async *chatStream(
    messages: GrokMessage[],
    tools?: GrokTool[],
    model?: string,
    searchOptions?: SearchOptions,
    temperature?: number,
    signal?: AbortSignal,
    maxTokens?: number
  ): AsyncGenerator<any, void, unknown> {
    const maxRetries = 5;
    const retryDelay = 10000; // 10 seconds

    const requestPayload: any = {
      model: model || this.currentModel,
      messages,
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens ?? this.defaultMaxTokens,
      stream: true
    };

    // Only include tools if the model supports them
    if (this.supportsTools) {
      requestPayload.tools = tools || [];
    }

    // Only add think parameter for backends that support it (Grok, Ollama)
    const backendLower = this.backendName.toLowerCase();
    // Secure host check for "x.ai" (Grok)
    const supportsThink = backendLower === 'grok' ||
                          backendLower === 'ollama' ||
                          (this.client.baseURL ? this.isAllowedHost(this.client.baseURL, ['x.ai', 'api.x.ai']) : false);
    if (supportsThink) {
      requestPayload.think = false;
    }

    // Venice uses venice_parameters.disable_thinking
    // DISABLED: Venice parameters may be causing API response issues
    // if (backendLower === 'venice') {
    //   requestPayload.venice_parameters = {
    //     disable_thinking: false,
    //     include_venice_system_prompt: false
    //   };
    // }

    // Only add tool_choice for backends that support it (OpenAI, Grok, OpenRouter)
    const supportsToolChoice = backendLower === 'grok' ||
                               backendLower === 'openai' ||
                               backendLower === 'openrouter' ||
                               (this.client.baseURL ? this.isAllowedHost(this.client.baseURL, ['x.ai', 'api.x.ai']) : false) ||
                               (this.client.baseURL ? this.isAllowedHost(this.client.baseURL, ['openai.com', 'api.openai.com']) : false) ||
                               (this.client.baseURL ? this.isAllowedHost(this.client.baseURL, ['openrouter.ai', 'api.openrouter.ai']) : false);
    if (this.supportsTools && supportsToolChoice && tools && tools.length > 0) {
      requestPayload.tool_choice = "auto";
    }

    // Add search parameters if specified and using Grok API (x.ai)
    if (searchOptions?.search_parameters &&
        (this.client.baseURL ? this.isAllowedHost(this.client.baseURL, ['x.ai', 'api.x.ai']) : false)) {
      requestPayload.search_parameters = searchOptions.search_parameters;
    }

    // Retry loop for 429 errors
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const stream = (await this.client.chat.completions.create(
          requestPayload,
          { signal: signal as any }
        )) as any;

        for await (const chunk of stream) {
          // Check if signal was aborted
          if (signal?.aborted) {
            // Try to clean up the stream
            if (stream && typeof stream.controller?.abort === 'function') {
              stream.controller.abort();
            }
            break;
          }
          yield chunk;
        }
        return; // Success, exit the generator
      } catch (error: any) {
        // Check if model doesn't support tools
        const isToolsNotSupported = error.status === 400 &&
                                    error.message &&
                                    error.message.toLowerCase().includes('does not support tools');

        if (isToolsNotSupported && this.supportsTools) {
          // Disable tools for this model and rebuild request without tools
          this.supportsTools = false;
          console.error(`Model does not support tools.  Retrying without tools...`);

          // Shutdown MCP servers since they won't be usable without tools
          try {
            const { getMCPManager } = await import('../grok/tools.js');
            const mcpManager = getMCPManager();
            await mcpManager.shutdown();
            console.error(`MCP servers shut down.`);
          } catch (mcpError: any) {
            console.warn("MCP shutdown failed:", mcpError);
          }

          // Rebuild request payload without tools
          delete requestPayload.tools;
          delete requestPayload.tool_choice;

          continue;
        }

        // Check if model doesn't support vision (400 errors) or request is too large (413 errors)
        const isVisionNotSupported = ((error.status === 400 &&
                                       error.message &&
                                       (error.message.toLowerCase().includes('does not support vision') ||
                                        error.message.toLowerCase().includes('does not support images') ||
                                        error.message.toLowerCase().includes('image inputs are not supported') ||
                                        error.message.toLowerCase().includes('image_url'))) ||
                                      (error.status === 413 &&
                                       error.message &&
                                       error.message.toLowerCase().includes('request entity too large')));

        if (isVisionNotSupported && this.supportsVision) {
          // Disable vision for this model and rebuild request without images
          this.supportsVision = false;
          console.error(`Model does not support vision.  Retrying without images...`);

          // Strip images from all messages
          requestPayload.messages = requestPayload.messages.map((msg: any) => {
            if (Array.isArray(msg.content)) {
              // Keep only text content, remove image_url entries
              const textContent = msg.content.filter((item: any) => item.type === 'text');
              return {
                ...msg,
                content: textContent.length > 0 ? textContent[0].text : ''
              };
            }
            return msg;
          });

          continue;
        }

        // Check if it's a 429 rate limit error
        const is429 = error.status === 429 ||
                      error.code === 'rate_limit_exceeded' ||
                      (error.message && error.message.toLowerCase().includes('rate limit'));

        if (is429 && attempt < maxRetries) {
          console.error(`Rate limit hit (429). Retrying in ${retryDelay/1000}s... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }

        // Log 500 errors with full request/response for debugging
        if (error.status === 500) {
          const { requestFile, responseFile } = await logApiError(
            requestPayload,
            error,
            { errorType: 'runtime-api-error' },
            '500'
          );

          // Throw error with file references
          throw new Error(`${this.backendName} API error: ${error.message}\nRequest logged to: ${requestFile}\nResponse logged to: ${responseFile}`);
        }

        // If not 429 or out of retries, throw the error
        throw new Error(`${this.backendName} API error: ${error.message}`);
      }
    }

    // Should never reach here, but TypeScript needs it
    throw new Error(`${this.backendName} API error: Max retries exceeded`);
  }

  async search(
    query: string,
    searchParameters?: SearchParameters
  ): Promise<GrokResponse> {
    const searchMessage: GrokMessage = {
      role: "user",
      content: query,
    };

    const searchOptions: SearchOptions = {
      search_parameters: searchParameters || { mode: "on" },
    };

    return this.chat([searchMessage], [], undefined, searchOptions);
  }

  /**
   * Returns true if the host part of baseURL matches one of the allowedHosts or a subdomain thereof.
   */
  private isAllowedHost(urlString: string, allowedHosts: string[]): boolean {
    try {
      const { hostname } = new URL(urlString);
      return allowedHosts.some(allowedHost =>
        hostname === allowedHost || hostname.endsWith(`.${allowedHost}`)
      );
    } catch (e) {
      return false;
    }
  }
}
