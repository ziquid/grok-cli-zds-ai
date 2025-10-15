import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat";
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

  constructor(apiKey: string, model?: string, baseURL?: string) {
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

    // Determine backend name from URL
    this.backendName = this.detectBackendName(finalBaseURL);
    // Update to 'Ollama Cloud' if using a cloud model
    this.updateBackendForCloudModel();
  }

  private detectBackendName(baseURL: string): string {
    const url = baseURL.toLowerCase();
    if (url.includes('x.ai')) return 'Grok';
    if (url.includes('openai.com')) return 'OpenAI';
    if (url.includes('anthropic.com')) return 'Claude';
    if (url.includes('openrouter.ai')) return 'OpenRouter';
    if (url.includes('localhost:11434') || url.includes('127.0.0.1:11434') || url.includes(':11434')) {
      // Will be updated to 'Ollama Cloud' if using cloud model
      return 'Ollama';
    }
    return 'API';
  }

  private updateBackendForCloudModel(): void {
    // Check if current model is an Ollama cloud model (has -cloud suffix)
    const model = this.currentModel.toLowerCase();

    if (this.backendName === 'Ollama' && model.includes('-cloud')) {
      this.backendName = 'Ollama Cloud';
    }
  }

  setModel(model: string): void {
    this.currentModel = model;
    // Update backend name if switching to/from cloud model
    this.updateBackendForCloudModel();
  }

  getCurrentModel(): string {
    return this.currentModel;
  }

  getBaseURL(): string {
    return this.client.baseURL || "https://api.x.ai/v1";
  }

  async chat(
    messages: GrokMessage[],
    tools?: GrokTool[],
    model?: string,
    searchOptions?: SearchOptions
  ): Promise<GrokResponse> {
    const maxRetries = 5;
    const retryDelay = 10000; // 10 seconds

    const requestPayload: any = {
      model: model || this.currentModel,
      messages,
      tools: tools || [],
      tool_choice: tools && tools.length > 0 ? "auto" : undefined,
      temperature: 0.7,
      max_tokens: this.defaultMaxTokens,
      think: false
    };

    // Add search parameters if specified and using Grok API (x.ai)
    if (searchOptions?.search_parameters && this.client.baseURL?.includes('x.ai')) {
      requestPayload.search_parameters = searchOptions.search_parameters;
    }

    // Log tools being sent to API
    const toolNames = (tools || []).map(t => t.function.name);
    const mcpTools = toolNames.filter(name => name.startsWith('mcp__'));

    const logEntry = `${new Date().toISOString()} - API CALL: ${toolNames.length} tools (${mcpTools.length} MCP: ${mcpTools.join(', ')})\n`;
    fs.appendFileSync('/tmp/grok-api-tools.log', logEntry);

    // Retry loop for 429 errors
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create(requestPayload);
        return response as GrokResponse;
      } catch (error: any) {
        // Check if it's a 429 rate limit error
        const is429 = error.status === 429 ||
                      error.code === 'rate_limit_exceeded' ||
                      (error.message && error.message.toLowerCase().includes('rate limit'));

        if (is429 && attempt < maxRetries) {
          console.error(`Rate limit hit (429). Retrying in ${retryDelay/1000}s... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
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
    searchOptions?: SearchOptions
  ): AsyncGenerator<any, void, unknown> {
    const maxRetries = 5;
    const retryDelay = 10000; // 10 seconds

    const requestPayload: any = {
      model: model || this.currentModel,
      messages,
      tools: tools || [],
      tool_choice: tools && tools.length > 0 ? "auto" : undefined,
      temperature: 0.7,
      max_tokens: this.defaultMaxTokens,
      stream: true,
      think: false
    };

    // Add search parameters if specified and using Grok API (x.ai)
    if (searchOptions?.search_parameters && this.client.baseURL?.includes('x.ai')) {
      requestPayload.search_parameters = searchOptions.search_parameters;
    }

    // Retry loop for 429 errors
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const stream = (await this.client.chat.completions.create(
          requestPayload
        )) as any;

        for await (const chunk of stream) {
          yield chunk;
        }
        return; // Success, exit the generator
      } catch (error: any) {
        // Check if it's a 429 rate limit error
        const is429 = error.status === 429 ||
                      error.code === 'rate_limit_exceeded' ||
                      (error.message && error.message.toLowerCase().includes('rate limit'));

        if (is429 && attempt < maxRetries) {
          console.error(`Rate limit hit (429). Retrying in ${retryDelay/1000}s... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
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
}
