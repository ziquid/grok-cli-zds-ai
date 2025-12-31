import type { ChatCompletionContentPart } from "openai/resources/chat/completions.js";
import { LLMToolCall } from "../grok/client.js";
import { parseImagesFromMessage, hasImageReferences } from "../utils/image-encoder.js";
import { Variable } from "./prompt-variables.js";
import { ChatEntry } from "./llm-agent.js";

/**
 * State information for message rephrasing operations
 */
export interface RephraseState {
  /** Index of the original assistant message being rephrased */
  originalAssistantMessageIndex: number;
  /** Index of the rephrase request message */
  rephraseRequestIndex: number;
  /** Index where the new response will be inserted */
  newResponseIndex: number;
  /** Type of message being sent for the rephrase */
  messageType: "user" | "system";
  /** Optional prefill text to start the rephrased response */
  prefillText?: string;
}

/**
 * Dependencies required by MessageProcessor
 */
export interface MessageProcessorDependencies {
  /** Chat history array */
  chatHistory: ChatEntry[];
  /** Function to get current token count */
  getCurrentTokenCount(): number;
  /** Function to get maximum context size */
  getMaxContextSize(): number;
  /** Function to set rephrase state */
  setRephraseState(originalAssistantMessageIndex: number, rephraseRequestIndex: number, newResponseIndex: number, messageType: "user" | "system", prefillText?: string): void;
}

/**
 * Handles message processing, parsing, and transformation for the LLM agent
 */
export class MessageProcessor {
  /** Stores prefill text from hooks */
  private hookPrefillText: string | null = null;

  /**
   * Creates a new MessageProcessor instance
   * @param deps - Dependencies required for message processing
   */
  constructor(private deps: MessageProcessorDependencies) {}

  /**
   * Processes rephrase commands and sets up rephrase state
   * @param message - The input message to check for rephrase commands
   * @returns Object containing rephrase information and processed message
   */
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

  /**
   * Parses message content and assembles it with variables
   * @param messageToSend - The message to parse and assemble
   * @returns Object containing parsed content and assembled message
   */
  async parseAndAssembleMessage(messageToSend: string): Promise<{parsed: any, assembledMessage: string}> {
    const parsed = hasImageReferences(messageToSend)
      ? parseImagesFromMessage(messageToSend)
      : { text: messageToSend, images: [] };

    Variable.set("USER:PROMPT", parsed.text);

    const assembledMessage = Variable.renderFull("USER");
    return {parsed, assembledMessage};
  }

  /**
   * Prepares message content for LLM consumption, handling images and content types
   * @param messageType - Type of message ("user" or "system")
   * @param assembledMessage - The assembled message text
   * @param parsed - Parsed message content including images
   * @param messageToSend - Original message to send
   * @param supportsVision - Whether the LLM supports vision/images
   * @returns Object containing user entry and formatted message content
   */
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
   * @param message - Message object that may contain XML tool calls
   * @returns Modified message with parsed tool calls
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

  /**
   * Reduces streaming message chunks into a complete message object
   * @param previous - Previously accumulated message data
   * @param item - Current streaming chunk to process
   * @returns Updated accumulated message object
   */
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

  /**
   * Gets the current hook prefill text
   * @returns The prefill text or null if none is set
   */
  getHookPrefillText(): string | null {
    return this.hookPrefillText;
  }

  /**
   * Clears the hook prefill text
   */
  clearHookPrefillText(): void {
    this.hookPrefillText = null;
  }

  /**
   * Sets the hook prefill text
   * @param text - The prefill text to set
   */
  setHookPrefillText(text: string): void {
    this.hookPrefillText = text;
  }
}
