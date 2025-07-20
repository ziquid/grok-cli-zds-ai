import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat';

export type GrokMessage = ChatCompletionMessageParam;

export interface GrokTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

export interface GrokToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
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
  private currentModel: string = 'grok-3-latest';

  constructor(apiKey: string, model?: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.x.ai/v1',
      timeout: 360000,
    });
    if (model) {
      this.currentModel = model;
    }
  }

  setModel(model: string): void {
    this.currentModel = model;
  }

  getCurrentModel(): string {
    return this.currentModel;
  }

  async chat(
    messages: GrokMessage[],
    tools?: GrokTool[],
    model?: string
  ): Promise<GrokResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: model || this.currentModel,
        messages,
        tools: tools || [],
        tool_choice: tools ? 'auto' : undefined,
        temperature: 0.7,
        max_tokens: 4000,
      });

      return response as GrokResponse;
    } catch (error: any) {
      throw new Error(`Grok API error: ${error.message}`);
    }
  }

  async *chatStream(
    messages: GrokMessage[],
    tools?: GrokTool[],
    model?: string
  ): AsyncGenerator<any, void, unknown> {
    try {
      const stream = await this.client.chat.completions.create({
        model: model || this.currentModel,
        messages,
        tools: tools || [],
        tool_choice: tools ? 'auto' : undefined,
        temperature: 0.7,
        max_tokens: 4000,
        stream: true,
      });

      for await (const chunk of stream) {
        yield chunk;
      }
    } catch (error: any) {
      throw new Error(`Grok API error: ${error.message}`);
    }
  }
}