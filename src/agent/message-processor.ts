import type { ChatCompletionContentPart } from "openai/resources/chat/completions.js";
import { LLMToolCall } from "../grok/client.js";
import { parseImagesFromMessage, hasImageReferences } from "../utils/image-encoder.js";
import { Variable } from "./prompt-variables.js";
import { getSettingsManager } from "../utils/settings-manager.js";
import { executeOperationHook, applyHookCommands } from "../utils/hook-executor.js";
import { ChatEntry } from "./llm-agent.js";

export interface RephraseState {
  originalAssistantMessageIndex: number;
  rephraseRequestIndex: number;
  newResponseIndex: number;
  messageType: "user" | "system";
  prefillText?: string;
}

export interface MessageProcessorDependencies {
  chatHistory: ChatEntry[];
  getCurrentTokenCount(): number;
  getMaxContextSize(): number;
  setRephraseState(originalAssistantMessageIndex: number, rephraseRequestIndex: number, newResponseIndex: number, messageType: "user" | "system", prefillText?: string): void;
}

export class MessageProcessor {
  private hookPrefillText: string | null = null;

  constructor(private deps: MessageProcessorDependencies) {}

  async setupRephraseCommand(message: string): Promise<{isRephraseCommand: boolean, messageType: "user"|"system", messageToSend: string, prefillText?: string}> {
    let isRephraseCommand = false;
    let isSystemRephrase = false;
    let messageToSend = message;
    let messageType: "user" | "system" = "user";
    let prefillText: string | undefined;

    if (message.startsWith("/system rephrase")) {
      isRephraseCommand = true;
      isSystemRephrase = true;
      messageToSend = message.substring(8).trim();
      messageType = "system";
      const prefillMatch = message.match(/^\/system rephrase\s+(.+)$/);
      if (prefillMatch) {
        prefillText = prefillMatch[1];
      }
    } else if (message.startsWith("/rephrase")) {
      isRephraseCommand = true;
      messageToSend = message;
      messageType = "user";
      const prefillMatch = message.match(/^\/rephrase\s+(.+)$/);
      if (prefillMatch) {
        prefillText = prefillMatch[1];
      }
    }

    if (isRephraseCommand) {
      let lastAssistantIndex = -1;
      for (let i = this.deps.chatHistory.length - 1; i >= 0; i--) {
        if (this.deps.chatHistory[i].type === "assistant") {
          lastAssistantIndex = i;
          break;
        }
      }

      if (lastAssistantIndex === -1) {
        throw new Error("No previous assistant message to rephrase");
      }

      this.deps.setRephraseState(lastAssistantIndex, this.deps.chatHistory.length, -1, messageType, prefillText);
    }

    return {isRephraseCommand, messageType, messageToSend, prefillText};
  }

  async parseAndAssembleMessage(messageToSend: string): Promise<{parsed: any, assembledMessage: string}> {
    const parsed = hasImageReferences(messageToSend)
      ? parseImagesFromMessage(messageToSend)
      : { text: messageToSend, images: [] };

    Variable.set("USER:PROMPT", parsed.text);

    const hookPath = getSettingsManager().getPreLLMResponseHook();
    if (hookPath) {
      const hookResult = await executeOperationHook(
        hookPath,
        "preLLMResponse",
        { USER_MESSAGE: parsed.text },
        30000,
        false,
        this.deps.getCurrentTokenCount(),
        this.deps.getMaxContextSize()
      );

      if (hookResult.approved && hookResult.commands) {
        const results = applyHookCommands(hookResult.commands);

        for (const [varName, value] of results.promptVars.entries()) {
          Variable.set(varName, value);
        }

        if (results.prefill) {
          this.hookPrefillText = results.prefill;
        }
      }
    }

    const assembledMessage = Variable.renderFull("USER");
    return {parsed, assembledMessage};
  }

  prepareMessageContent(messageType: "user"|"system", assembledMessage: string, parsed: any, messageToSend: string, supportsVision: boolean): {userEntry: ChatEntry, messageContent: any} {
    let messageContent: string | ChatCompletionContentPart[] = assembledMessage;

    if (messageType === "user" && parsed.images.length > 0 && supportsVision) {
      messageContent = [
        { type: "text", text: assembledMessage },
        ...parsed.images
      ];
    }

    const userEntry: ChatEntry = {
      type: messageType,
      content: messageContent,
      originalContent: messageType === "user" ? (parsed.images.length > 0 && supportsVision
        ? [{ type: "text", text: parsed.text }, ...parsed.images]
        : parsed.text) : undefined,
      timestamp: new Date(),
    };

    return {userEntry, messageContent};
  }

  /**
   * Parse XML-formatted tool calls from message content (x.ai format)
   * Converts <xai:function_call> elements to standard LLMToolCall format
   */
  parseXMLToolCalls(message: any): any {
    if (!message.content || typeof message.content !== 'string') {
      return message;
    }

    const content = message.content;
    const xmlToolCallRegex = /<xai:function_call\s+name="([^"]+)">([\s\S]*?)<\/xai:function_call>/g;
    const matches = Array.from(content.matchAll(xmlToolCallRegex));

    if (matches.length === 0) {
      return message;
    }

    // Parse each XML tool call
    const toolCalls: LLMToolCall[] = [];
    let cleanedContent = content;

    for (const match of matches) {
      const functionName = match[1];
      const paramsXML = match[2];

      // Parse parameters
      const paramRegex = /<parameter\s+name="([^"]+)">([^<]*)<\/parameter>/g;
      const paramMatches = Array.from(paramsXML.matchAll(paramRegex));

      const args: Record<string, any> = {};
      for (const paramMatch of paramMatches) {
        args[paramMatch[1]] = paramMatch[2];
      }

      // Generate a unique ID for this tool call
      const toolCallId = `call_xml_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      toolCalls.push({
        id: toolCallId,
        type: "function",
        function: {
          name: functionName,
          arguments: JSON.stringify(args)
        }
      });

      // Remove this XML block from content
      cleanedContent = cleanedContent.replace(match[0], '');
    }

    // Trim any extra whitespace
    cleanedContent = cleanedContent.trim();

    // Return modified message with tool_calls and cleaned content
    return {
      ...message,
      content: cleanedContent || null,
      tool_calls: [...(message.tool_calls || []), ...toolCalls]
    };
  }

  messageReducer(previous: any, item: any): any {
    const reduce = (acc: any, delta: any) => {
      // Ensure acc is always an object before spreading (handles null/undefined)
      acc = { ...(acc || {}) };
      for (const [key, value] of Object.entries(delta)) {
        // Skip null values in delta (Venice sends tool_calls: null which breaks Object.entries)
        if (value === null) continue;

        if (acc[key] === undefined || acc[key] === null) {
          acc[key] = value;
          // Clean up index properties from tool calls
          if (Array.isArray(acc[key])) {
            for (const arr of acc[key]) {
              delete arr.index;
            }
          }
        } else if (typeof acc[key] === "string" && typeof value === "string") {
          // Don't concatenate certain properties that should remain separate
          const nonConcatenableProps = ['id', 'type', 'name'];
          if (nonConcatenableProps.includes(key)) {
            // For non-concatenable properties, keep the new value
            acc[key] = value;
          } else {
            // For content, arguments, and other text properties, concatenate
            (acc[key] as string) += value;
          }
        } else if (Array.isArray(acc[key]) && Array.isArray(value)) {
          const accArray = acc[key] as any[];
          for (let i = 0; i < value.length; i++) {
            if (!accArray[i]) accArray[i] = {};
            accArray[i] = reduce(accArray[i], value[i]);
          }
        } else if (typeof acc[key] === "object" && typeof value === "object") {
          acc[key] = reduce(acc[key], value);
        }
      }
      return acc;
    };

    return reduce(previous, item.choices?.[0]?.delta || {});
  }

  getHookPrefillText(): string | null {
    return this.hookPrefillText;
  }

  clearHookPrefillText(): void {
    this.hookPrefillText = null;
  }

  setHookPrefillText(text: string): void {
    this.hookPrefillText = text;
  }
}