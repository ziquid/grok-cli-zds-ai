import { GrokClient, GrokMessage, GrokToolCall } from "../grok/client.js";
import {
  GROK_TOOLS,
  addMCPToolsToGrokTools,
  getAllGrokTools,
  getMCPManager,
  initializeMCPServers,
} from "../grok/tools.js";
import { loadMCPConfig } from "../mcp/config.js";
import {
  TextEditorTool,
  MorphEditorTool,
  ZshTool,
  ConfirmationTool,
  SearchTool,
  EnvTool,
  IntrospectTool,
  ClearCacheTool,
  CharacterTool,
  TaskTool,
  InternetTool,
  ImageTool,
  FileConversionTool
} from "../tools/index.js";
import { ToolResult } from "../types/index.js";
import { EventEmitter } from "events";
import { createTokenCounter, TokenCounter } from "../utils/token-counter.js";
import { loadCustomInstructions } from "../utils/custom-instructions.js";
import { getSettingsManager } from "../utils/settings-manager.js";
import { executeOperationHook, executeToolApprovalHook, applyHookCommands } from "../utils/hook-executor.js";

export interface ChatEntry {
  type: "user" | "assistant" | "tool_result" | "tool_call" | "system";
  content?: string;
  timestamp: Date;
  tool_calls?: GrokToolCall[];
  toolCall?: GrokToolCall;
  toolResult?: { success: boolean; output?: string; error?: string; displayOutput?: string };
  isStreaming?: boolean;
}

export interface StreamingChunk {
  type: "content" | "tool_calls" | "tool_result" | "done" | "token_count" | "user_message";
  content?: string;
  tool_calls?: GrokToolCall[];
  toolCall?: GrokToolCall;
  toolResult?: ToolResult;
  tokenCount?: number;
  userEntry?: ChatEntry;
}

export class GrokAgent extends EventEmitter {
  private grokClient: GrokClient;
  private textEditor: TextEditorTool;
  private morphEditor: MorphEditorTool | null;
  private zsh: ZshTool;
  private confirmationTool: ConfirmationTool;
  private search: SearchTool;
  private env: EnvTool;
  private introspect: IntrospectTool;
  private clearCacheTool: ClearCacheTool;
  private characterTool: CharacterTool;
  private taskTool: TaskTool;
  private internetTool: InternetTool;
  private imageTool: ImageTool;
  private fileConversionTool: FileConversionTool;
  private chatHistory: ChatEntry[] = [];
  private messages: GrokMessage[] = [];
  private tokenCounter: TokenCounter;
  private abortController: AbortController | null = null;
  private mcpInitialized: boolean = false;
  private maxToolRounds: number;
  private temperature: number;
  private maxTokens: number | undefined;
  private firstMessageProcessed: boolean = false;
  private contextWarningAt80: boolean = false;
  private contextWarningAt90: boolean = false;
  private persona: string = "";
  private personaColor: string = "white";
  private mood: string = "";
  private moodColor: string = "white";
  private activeTask: string = "";
  private activeTaskAction: string = "";
  private activeTaskColor: string = "white";
  private pendingContextEdit: { tmpJsonPath: string; contextFilePath: string } | null = null;

  constructor(
    apiKey: string,
    baseURL?: string,
    model?: string,
    maxToolRounds?: number,
    debugLogFile?: string,
    startupHookOutput?: string,
    temperature?: number,
    maxTokens?: number
  ) {
    super();
    const manager = getSettingsManager();
    const savedModel = manager.getCurrentModel();
    const modelToUse = model || savedModel || "grok-code-fast-1";
    this.maxToolRounds = maxToolRounds || 400;
    this.temperature = temperature ?? manager.getTemperature();
    this.maxTokens = maxTokens ?? manager.getMaxTokens();
    // Get display name from environment (set by zai/helpers)
    const displayName = process.env.GROK_BACKEND_DISPLAY_NAME;
    this.grokClient = new GrokClient(apiKey, modelToUse, baseURL, displayName);
    this.textEditor = new TextEditorTool();
    this.morphEditor = process.env.MORPH_API_KEY ? new MorphEditorTool() : null;
    this.zsh = new ZshTool();
    this.confirmationTool = new ConfirmationTool();
    this.search = new SearchTool();
    this.env = new EnvTool();
    this.introspect = new IntrospectTool();
    this.clearCacheTool = new ClearCacheTool();
    this.characterTool = new CharacterTool();
    this.taskTool = new TaskTool();
    this.internetTool = new InternetTool();
    this.imageTool = new ImageTool();
    this.fileConversionTool = new FileConversionTool();
    this.textEditor.setAgent(this); // Give text editor access to agent for context awareness
    this.introspect.setAgent(this); // Give introspect access to agent for tool class info
    this.clearCacheTool.setAgent(this); // Give clearCache access to agent
    this.characterTool.setAgent(this); // Give character tool access to agent
    this.taskTool.setAgent(this); // Give task tool access to agent
    this.internetTool.setAgent(this); // Give internet tool access to agent
    this.imageTool.setAgent(this); // Give image tool access to agent
    this.zsh.setAgent(this); // Give zsh tool access to agent for CWD tracking
    this.tokenCounter = createTokenCounter(modelToUse);

    // Initialize MCP servers if configured
    this.initializeMCP(debugLogFile);

    // Load custom instructions
    const customInstructions = loadCustomInstructions();
    const customInstructionsSection = customInstructions
      ? `${customInstructions}`
      : "";

    // System message will be set after async initialization
    this.messages.push({
      role: "system",
      content: "Initializing...", // Temporary, will be replaced in initialize()
    });

    // Also add to chat history for persistence
    this.chatHistory.push({
      type: "system",
      content: "Initializing...",
      timestamp: new Date(),
    });

    // Store startup hook output for later use
    this.startupHookOutput = startupHookOutput;
    this.customInstructions = customInstructions;
  }

  private startupHookOutput?: string;
  private customInstructions?: string;

  /**
   * Initialize the agent with dynamic system prompt
   * Must be called after construction
   */
  async initialize(): Promise<void> {
    // Add startup hook output if provided
    const startupHookSection = this.startupHookOutput
      ? `\nSTARTUP HOOK OUTPUT:\n${this.startupHookOutput}\n`
      : "";

    const customInstructionsSection = this.customInstructions
      ? `${this.customInstructions}`
      : "";

    // Generate dynamic tool list using introspect tool
    const toolsResult = await this.introspect.introspect("tools");
    const toolsSection = toolsResult.success ? toolsResult.output : "Tools: Unknown";

    // Build the system message
    const systemContent = `You are a clever, helpful AI assistant.
${startupHookSection}
${customInstructionsSection}

${toolsSection}

Current working directory: ${process.cwd()}`;

    // Replace the temporary system message
    this.messages[0] = {
      role: "system",
      content: systemContent,
    };

    // Also update chat history
    this.chatHistory[0] = {
      type: "system",
      content: systemContent,
      timestamp: new Date(),
    };

    // Execute instance hook on every startup (fresh or not)
    const settings = getSettingsManager();
    const instanceHookPath = settings.getInstanceHook();
    if (instanceHookPath) {
      const hookResult = await executeOperationHook(
        instanceHookPath,
        "instance",
        {},
        30000,
        false,  // Instance hook is not mandatory
        this.getCurrentTokenCount(),
        this.getMaxContextSize()
      );

      if (hookResult.approved && hookResult.commands && hookResult.commands.length > 0) {
        // Apply hook commands (ENV, TOOL_RESULT, SYSTEM)
        const results = applyHookCommands(hookResult.commands);

        // TOOL_RESULT is for tool return values, not used by instance hook

        // Add SYSTEM message if present
        if (results.system) {
          this.messages.push({
            role: "system",
            content: results.system,
          });
          this.chatHistory.push({
            type: "system",
            content: results.system,
            timestamp: new Date(),
          });
        }
      }
    }
  }

  async loadInitialHistory(history: ChatEntry[]): Promise<void> {
    // Load existing chat history into agent's memory
    this.chatHistory = history;

    // Instance hook now runs in initialize() for both fresh and existing sessions

    // Convert history to messages format for API calls
    const historyMessages: GrokMessage[] = [];
    let hasSystemMessage = false;

    // Track which tool_call_ids we've seen in assistant messages
    const seenToolCallIds = new Set<string>();

    // First pass: collect all tool_call_ids from assistant messages
    for (const entry of history) {
      if (entry.type === "assistant" && entry.tool_calls) {
        entry.tool_calls.forEach(tc => seenToolCallIds.add(tc.id));
      }
    }

    // Second pass: build history messages, only including tool_results that have matching tool_calls
    // We'll collect them separately and insert them in the correct order
    const toolResultMessages: GrokMessage[] = [];
    const toolCallIdToMessage: Map<string, GrokMessage> = new Map();
    let firstSystemMessageSeen = false;

    for (const entry of history) {
      switch (entry.type) {
        case "system":
          // First system message replaces the default system message (instructions)
          // Subsequent system messages are added to conversation history
          if (!firstSystemMessageSeen && this.messages.length > 0 && this.messages[0].role === "system") {
            this.messages[0] = {
              role: "system",
              content: entry.content,
            };
            hasSystemMessage = true;
            firstSystemMessageSeen = true;
          } else {
            // Add subsequent system messages to history (e.g., persona changes)
            historyMessages.push({
              role: "system",
              content: entry.content,
            });
          }
          break;
        case "user":
          historyMessages.push({
            role: "user",
            content: entry.content,
          });
          break;
        case "assistant":
          const assistantMessage: GrokMessage = {
            role: "assistant",
            content: entry.content || "", // Ensure content is never null/undefined
          };
          if (entry.tool_calls && entry.tool_calls.length > 0) {
            // For assistant messages with tool calls, collect the tool results that correspond to them
            const correspondingToolResults: GrokMessage[] = [];
            const toolCallsWithResults: GrokToolCall[] = [];

            entry.tool_calls.forEach(tc => {
              // Find the tool_result entry for this tool_call
              const toolResultEntry = history.find(h => h.type === "tool_result" && h.toolCall?.id === tc.id);
              if (toolResultEntry) {
                // Only include this tool_call if we have its result
                toolCallsWithResults.push(tc);
                correspondingToolResults.push({
                  role: "tool",
                  content: toolResultEntry.toolResult?.output || toolResultEntry.toolResult?.error || "",
                  tool_call_id: tc.id,
                });
              }
            });

            // Only add tool_calls if we have at least one with a result
            if (toolCallsWithResults.length > 0) {
              assistantMessage.tool_calls = toolCallsWithResults;
              // Add assistant message
              historyMessages.push(assistantMessage);
              // Add corresponding tool results immediately after
              historyMessages.push(...correspondingToolResults);
            } else {
              // No tool results found, just add the assistant message without tool_calls
              historyMessages.push(assistantMessage);
            }
          } else {
            historyMessages.push(assistantMessage);
          }
          break;
        case "tool_result":
          // Skip tool_result entries here - they're handled when processing assistant messages with tool_calls
          break;
        // Skip tool_call entries as they are included with assistant
      }
    }

    // Insert history messages after the system message
    this.messages.splice(1, 0, ...historyMessages);

    // Update token count in system message
    const currentTokens = this.tokenCounter.countTokens(
      this.messages.map(m => typeof m.content === 'string' ? m.content : '').join('')
    );
    if (this.messages.length > 0 && this.messages[0].role === 'system' && typeof this.messages[0].content === 'string') {
      this.messages[0].content = this.messages[0].content.replace(/Current conversation token usage: .*/, `Current conversation token usage: ${currentTokens}`);
    }
  }

  private async initializeMCP(debugLogFile?: string): Promise<void> {
    // Initialize MCP in the background without blocking
    Promise.resolve().then(async () => {
      try {
        const config = loadMCPConfig();
        if (config.servers.length > 0) {
          await initializeMCPServers(debugLogFile);
        }
      } catch (error) {
        console.warn("MCP initialization failed:", error);
      } finally {
        this.mcpInitialized = true;
      }
    });
  }

  private isGrokModel(): boolean {
    const currentModel = this.grokClient.getCurrentModel();
    return currentModel.toLowerCase().includes("grok");
  }

  // Heuristic: enable web search only when likely needed
  private shouldUseSearchFor(message: string): boolean {
    const q = message.toLowerCase();
    const keywords = [
      "today",
      "latest",
      "news",
      "trending",
      "breaking",
      "current",
      "now",
      "recent",
      "x.com",
      "twitter",
      "tweet",
      "what happened",
      "as of",
      "update on",
      "release notes",
      "changelog",
      "price",
    ];
    if (keywords.some((k) => q.includes(k))) return true;
    // crude date pattern (e.g., 2024/2025) may imply recency
    if (/(20\d{2})/.test(q)) return true;
    return false;
  }

  async processUserMessage(message: string): Promise<ChatEntry[]> {
    // Add user message to conversation
    const userEntry: ChatEntry = {
      type: "user",
      content: message,
      timestamp: new Date(),
    };
    this.chatHistory.push(userEntry);
    this.messages.push({ role: "user", content: message });
    await this.emitContextChange();

    const newEntries: ChatEntry[] = [userEntry];
    const maxToolRounds = this.maxToolRounds; // Prevent infinite loops
    let toolRounds = 0;
    let consecutiveNonToolResponses = 0;

    try {
      // For first message, fetch tools fresh on each API call to catch MCP servers as they initialize
      // For subsequent messages, fetch once and cache for the entire message processing
      const shouldRefreshTools = !this.firstMessageProcessed;
      const tools = shouldRefreshTools ? null : await getAllGrokTools();

      let currentResponse = await this.grokClient.chat(
        this.messages,
        shouldRefreshTools ? await getAllGrokTools() : tools!,
        undefined,
        this.isGrokModel() && this.shouldUseSearchFor(message)
          ? { search_parameters: { mode: "auto" } }
          : { search_parameters: { mode: "off" } },
        this.temperature,
        this.abortController?.signal,
        this.maxTokens
      );

      // Agent loop - continue until no more tool calls or max rounds reached
      while (toolRounds < maxToolRounds) {
        const assistantMessage = currentResponse.choices[0]?.message;

        if (!assistantMessage) {
          throw new Error("No response from Grok");
        }

        // Handle tool calls
        if (
          assistantMessage.tool_calls &&
          assistantMessage.tool_calls.length > 0
        ) {
          toolRounds++;
          consecutiveNonToolResponses = 0; // Reset counter when AI makes tool calls

          // Add assistant message with tool calls
          const assistantEntry: ChatEntry = {
            type: "assistant",
            content: assistantMessage.content,
            timestamp: new Date(),
            tool_calls: assistantMessage.tool_calls,
          };
          this.chatHistory.push(assistantEntry);
          newEntries.push(assistantEntry);

          // Add assistant message to conversation
          this.messages.push({
            role: "assistant",
            content: assistantMessage.content || "", // Ensure content is never null/undefined
            tool_calls: assistantMessage.tool_calls,
          } as any);

          // Create initial tool call entries to show tools are being executed
          assistantMessage.tool_calls.forEach((toolCall) => {
            const toolCallEntry: ChatEntry = {
              type: "tool_call",
              content: "Executing...",
              timestamp: new Date(),
              toolCall: toolCall,
            };
            this.chatHistory.push(toolCallEntry);
            newEntries.push(toolCallEntry);
          });

          // Execute tool calls and update the entries
          let toolIndex = 0;
          const completedToolCallIds = new Set<string>();

          try {
            for (const toolCall of assistantMessage.tool_calls) {
              // Check for cancellation before executing each tool
              if (this.abortController?.signal.aborted) {
                console.error(`Tool execution cancelled after ${toolIndex}/${assistantMessage.tool_calls.length} tools`);

                // Add cancelled responses for remaining uncompleted tools
                for (let i = toolIndex; i < assistantMessage.tool_calls.length; i++) {
                  const remainingToolCall = assistantMessage.tool_calls[i];
                  this.messages.push({
                    role: "tool",
                    content: "[Cancelled by user]",
                    tool_call_id: remainingToolCall.id,
                  });
                  completedToolCallIds.add(remainingToolCall.id);
                }

                throw new Error("Operation cancelled by user");
              }

              const result = await this.executeTool(toolCall);

            // Update the existing tool_call entry with the result
            const entryIndex = this.chatHistory.findIndex(
              (entry) =>
                entry.type === "tool_call" && entry.toolCall?.id === toolCall.id
            );

            if (entryIndex !== -1) {
              const updatedEntry: ChatEntry = {
                ...this.chatHistory[entryIndex],
                type: "tool_result",
                content: result.success
                  ? result.output || "Success"
                  : result.error || "Error occurred",
                toolResult: result,
              };
              this.chatHistory[entryIndex] = updatedEntry;

              // Also update in newEntries for return value
              const newEntryIndex = newEntries.findIndex(
                (entry) =>
                  entry.type === "tool_call" &&
                  entry.toolCall?.id === toolCall.id
              );
              if (newEntryIndex !== -1) {
                newEntries[newEntryIndex] = updatedEntry;
              }
            }

            // Add tool result to messages with proper format (needed for AI context)
            this.messages.push({
              role: "tool",
              content: result.success
                ? result.output || "Success"
                : result.error || "Error",
              tool_call_id: toolCall.id,
            });
            completedToolCallIds.add(toolCall.id);
            await this.emitContextChange();

            toolIndex++;
          }
          } finally {
            // Ensure ALL tool calls in this.messages have results, even if we crashed/errored
            for (const toolCall of assistantMessage.tool_calls) {
              if (!completedToolCallIds.has(toolCall.id)) {
                this.messages.push({
                  role: "tool",
                  content: "[Error: Tool execution interrupted]",
                  tool_call_id: toolCall.id,
                });
              }
            }
          }

          // Get next response - this might contain more tool calls
          currentResponse = await this.grokClient.chat(
            this.messages,
            shouldRefreshTools ? await getAllGrokTools() : tools!,
            undefined,
            this.isGrokModel() && this.shouldUseSearchFor(message)
              ? { search_parameters: { mode: "auto" } }
              : { search_parameters: { mode: "off" } },
            this.temperature,
            this.abortController?.signal,
            this.maxTokens
          );
        } else {
          // No tool calls in this response - only add it if there's actual content
          const trimmedContent = assistantMessage.content?.trim();
          if (trimmedContent) {
            const responseEntry: ChatEntry = {
              type: "assistant",
              content: trimmedContent,
              timestamp: new Date(),
            };
            this.chatHistory.push(responseEntry);
            this.messages.push({
              role: "assistant",
              content: trimmedContent,
            });
            newEntries.push(responseEntry);
          }

          // TODO: HACK - This is a temporary fix to prevent duplicate responses.
          // We need a proper way for the bot to signal task completion, such as:
          // - A special tool call like "taskComplete()"
          // - A finish_reason indicator in the API response
          // - A structured response format that explicitly marks completion
          // For now, we break immediately after a substantial response to avoid
          // the cascade of duplicate responses caused by "give it one more chance" logic.

          // If the AI provided a substantial response (>50 chars), task is complete
          if (assistantMessage.content && assistantMessage.content.trim().length > 50) {
            break; // Task complete - bot gave a full response
          }

          // Short/empty response, give AI another chance
          currentResponse = await this.grokClient.chat(
            this.messages,
            shouldRefreshTools ? await getAllGrokTools() : tools!,
            undefined,
            this.isGrokModel() && this.shouldUseSearchFor(message)
              ? { search_parameters: { mode: "auto" } }
              : { search_parameters: { mode: "off" } },
            this.temperature,
            this.abortController?.signal,
            this.maxTokens
          );

          const followupMessage = currentResponse.choices[0]?.message;
          if (!followupMessage?.tool_calls || followupMessage.tool_calls.length === 0) {
            break; // AI doesn't want to continue
          }
        }
      }

      if (toolRounds >= maxToolRounds) {
        const warningEntry: ChatEntry = {
          type: "assistant",
          content:
            "Maximum tool execution rounds reached. Stopping to prevent infinite loops.",
          timestamp: new Date(),
        };
        this.chatHistory.push(warningEntry);
        newEntries.push(warningEntry);
      }

      // Mark first message as processed so subsequent messages use cached tools
      this.firstMessageProcessed = true;

      return newEntries;
    } catch (error: any) {
      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Sorry, I encountered an error: ${error.message}`,
        timestamp: new Date(),
      };
      this.chatHistory.push(errorEntry);

      // Mark first message as processed even on error
      this.firstMessageProcessed = true;

      return [userEntry, errorEntry];
    }
  }

  private messageReducer(previous: any, item: any): any {
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

  async *processUserMessageStream(
    message: string
  ): AsyncGenerator<StreamingChunk, void, unknown> {
    // Create new abort controller for this request
    this.abortController = new AbortController();

    // Add user message to both API conversation and chat history
    const userEntry: ChatEntry = {
      type: "user",
      content: message,
      timestamp: new Date(),
    };
    this.chatHistory.push(userEntry);
    this.messages.push({ role: "user", content: message });
    await this.emitContextChange();

    // Yield user message so UI can display it immediately
    yield {
      type: "user_message",
      userEntry: userEntry,
    };

    // Calculate input tokens
    let inputTokens = this.tokenCounter.countMessageTokens(
      this.messages as any
    );
    yield {
      type: "token_count",
      tokenCount: inputTokens,
    };

    const maxToolRounds = this.maxToolRounds; // Prevent infinite loops
    let toolRounds = 0;
    let totalOutputTokens = 0;
    let lastTokenUpdate = 0;
    let consecutiveNonToolResponses = 0;

    try {
      // For first message, fetch tools fresh on each API call to catch MCP servers as they initialize
      // For subsequent messages, fetch once and cache for the entire message processing
      const shouldRefreshTools = !this.firstMessageProcessed;
      const tools = shouldRefreshTools ? null : await getAllGrokTools();

      // Agent loop - continue until no more tool calls or max rounds reached
      while (toolRounds < maxToolRounds) {
        // Check if operation was cancelled
        if (this.abortController?.signal.aborted) {
          yield {
            type: "content",
            content: "\n\n[Operation cancelled by user]",
          };
          yield { type: "done" };
          return;
        }

        // Update system message with current token count
        if (this.messages.length > 0 && this.messages[0].role === 'system' && typeof this.messages[0].content === 'string') {
          this.messages[0].content = this.messages[0].content.replace(/Current conversation token usage: .*/, `Current conversation token usage: ${inputTokens}`);
        }

        // Stream response and accumulate
        const stream = this.grokClient.chatStream(
          this.messages,
          shouldRefreshTools ? await getAllGrokTools() : tools!,
          undefined,
          this.isGrokModel() && this.shouldUseSearchFor(message)
            ? { search_parameters: { mode: "auto" } }
            : { search_parameters: { mode: "off" } },
          this.temperature,
          this.abortController?.signal,
          this.maxTokens
        );
        let accumulatedMessage: any = {};
        let accumulatedContent = "";
        let tool_calls_yielded = false;
        let streamFinished = false;

        try {
          for await (const chunk of stream) {
            // Check for cancellation in the streaming loop
            if (this.abortController?.signal.aborted) {
              yield {
                type: "content",
                content: "\n\n[Operation cancelled by user]",
              };
              yield { type: "done" };
              return;
            }

            if (!chunk.choices?.[0]) continue;

            // Check if stream is finished (Venice sends garbage after this)
            if (chunk.choices[0].finish_reason === "stop" || chunk.choices[0].finish_reason === "tool_calls") {
              streamFinished = true;
            }

            // Accumulate the message using reducer
            accumulatedMessage = this.messageReducer(accumulatedMessage, chunk);

            // Check for tool calls - yield when we have complete tool calls with function names
            if (!tool_calls_yielded && accumulatedMessage.tool_calls?.length > 0) {
              // Check if we have at least one complete tool call with a function name
              const hasCompleteTool = accumulatedMessage.tool_calls.some(
                (tc: any) => tc.function?.name
              );
              if (hasCompleteTool) {
                yield {
                  type: "tool_calls",
                  tool_calls: accumulatedMessage.tool_calls,
                };
                tool_calls_yielded = true;
              }
            }

            // Stream content as it comes (but ignore content after stream is finished to avoid Venice garbage)
            if (chunk.choices[0].delta?.content && !streamFinished) {
              let deltaContent = chunk.choices[0].delta.content;

              // Strip out thinking tags and NO_RESPONSE tokens (Ollama/DeepSeek send these even with think: false)
              deltaContent = deltaContent
                .replace(/<think>[\s\S]*?<\/think>/g, '') // Remove <think>...</think> blocks
                .replace(/<\/think>/g, '') // Remove stray closing tags
                .replace(/NO_RESPONSE/g, ''); // Remove NO_RESPONSE tokens

              // Skip completely empty chunks after filtering (but keep spaces!)
              if (deltaContent === '') continue;

              accumulatedContent += deltaContent;

              // Update token count in real-time including accumulated content and any tool calls
              const currentOutputTokens =
                this.tokenCounter.estimateStreamingTokens(accumulatedContent) +
                (accumulatedMessage.tool_calls
                  ? this.tokenCounter.countTokens(
                      JSON.stringify(accumulatedMessage.tool_calls)
                    )
                  : 0);
              totalOutputTokens = currentOutputTokens;

              yield {
                type: "content",
                content: deltaContent,
              };

              // Emit token count update
              const now = Date.now();
              if (now - lastTokenUpdate > 250) {
                lastTokenUpdate = now;
                yield {
                  type: "token_count",
                  tokenCount: inputTokens + totalOutputTokens,
                };
              }
            }
          }
        } catch (streamError: any) {
          // Check if stream was aborted
          if (this.abortController?.signal.aborted || streamError.name === 'AbortError' || streamError.code === 'ABORT_ERR') {
            yield {
              type: "content",
              content: "\n\n[Operation cancelled by user]",
            };
            yield { type: "done" };
            return;
          }
          // Re-throw other errors to be caught by outer catch
          throw streamError;
        }

        // Add accumulated message to conversation for API context
        this.messages.push({
          role: "assistant",
          content: accumulatedMessage.content || "", // Ensure content is never null/undefined
          tool_calls: accumulatedMessage.tool_calls,
        } as any);

        // Add assistant message to chat history
        const assistantEntry: ChatEntry = {
          type: "assistant",
          content: accumulatedMessage.content || "",
          timestamp: new Date(),
          tool_calls: accumulatedMessage.tool_calls,
        };
        this.chatHistory.push(assistantEntry);

        await this.emitContextChange();

        // Handle tool calls if present
        if (accumulatedMessage.tool_calls?.length > 0) {
          toolRounds++;

          // Only yield tool_calls if we haven't already yielded them during streaming
          if (!tool_calls_yielded) {
            yield {
              type: "tool_calls",
              tool_calls: accumulatedMessage.tool_calls,
            };
          }

          // Add tool_call entries to chatHistory so they persist through UI sync
          accumulatedMessage.tool_calls.forEach((toolCall) => {
            const toolCallEntry: ChatEntry = {
              type: "tool_call",
              content: "Executing...",
              timestamp: new Date(),
              toolCall: toolCall,
            };
            this.chatHistory.push(toolCallEntry);
          });

          // Execute tools
          let toolIndex = 0;
          const completedToolCallIds = new Set<string>();

          try {
            for (const toolCall of accumulatedMessage.tool_calls) {
              // Check for cancellation before executing each tool
              if (this.abortController?.signal.aborted) {
                console.error(`Tool execution cancelled after ${toolIndex}/${accumulatedMessage.tool_calls.length} tools`);

                // Add cancelled responses for remaining uncompleted tools
                for (let i = toolIndex; i < accumulatedMessage.tool_calls.length; i++) {
                  const remainingToolCall = accumulatedMessage.tool_calls[i];
                  this.messages.push({
                    role: "tool",
                    content: "[Cancelled by user]",
                    tool_call_id: remainingToolCall.id,
                  });
                  completedToolCallIds.add(remainingToolCall.id);
                }

                yield {
                  type: "content",
                  content: "\n\n[Operation cancelled by user]",
                };
                yield { type: "done" };
                return;
              }

              const result = await this.executeTool(toolCall);

            yield {
              type: "tool_result",
              toolCall,
              toolResult: result,
            };

            // Update the tool_call entry in chatHistory to tool_result
            const entryIndex = this.chatHistory.findIndex(
              (entry) => entry.type === "tool_call" && entry.toolCall?.id === toolCall.id
            );
            if (entryIndex !== -1) {
              this.chatHistory[entryIndex] = {
                ...this.chatHistory[entryIndex],
                type: "tool_result",
                content: result.success
                  ? (result.output?.trim() || "Success")
                  : (result.error?.trim() || "Error occurred"),
                toolResult: result,
              };
            }

            // Add tool result with proper format (needed for AI context)
            this.messages.push({
              role: "tool",
              content: result.success
                ? result.output || "Success"
                : result.error || "Error",
              tool_call_id: toolCall.id,
            });
            completedToolCallIds.add(toolCall.id);

            toolIndex++;
          }
          } finally {
            // Ensure ALL tool calls in this.messages have results, even if we crashed/errored
            for (const toolCall of accumulatedMessage.tool_calls) {
              if (!completedToolCallIds.has(toolCall.id)) {
                this.messages.push({
                  role: "tool",
                  content: "[Error: Tool execution interrupted]",
                  tool_call_id: toolCall.id,
                });
              }
            }
          }

          // Update token count after processing all tool calls to include tool results
          inputTokens = this.tokenCounter.countMessageTokens(
            this.messages as any
          );
          // Final token update after tools processed
          yield {
            type: "token_count",
            tokenCount: inputTokens + totalOutputTokens,
          };

          // Continue the loop to get the next response (which might have more tool calls)
        } else {
          // No tool calls, we're done
          break;
        }
      }

      if (toolRounds >= maxToolRounds) {
        yield {
          type: "content",
          content:
            "\n\nMaximum tool execution rounds reached. Stopping to prevent infinite loops.",
        };
      }

      // Mark first message as processed so subsequent messages use cached tools
      this.firstMessageProcessed = true;

      yield { type: "done" };
    } catch (error: any) {
      // Check if this was a cancellation (check both abort signal and error name)
      if (this.abortController?.signal.aborted || error.name === 'AbortError' || error.code === 'ABORT_ERR') {
        yield {
          type: "content",
          content: "\n\n[Operation cancelled by user]",
        };
        yield { type: "done" };
        return;
      }

      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Sorry, I encountered an error: ${error.message}`,
        timestamp: new Date(),
      };
      this.chatHistory.push(errorEntry);
      yield {
        type: "content",
        content: errorEntry.content,
      };

      // Mark first message as processed even on error
      this.firstMessageProcessed = true;

      yield { type: "done" };
    } finally {
      // Clean up abort controller
      this.abortController = null;
    }
  }

  /**
   * Apply default parameter values for tools
   * This ensures the approval hook sees the same parameters that will be used during execution
   */
  private applyToolParameterDefaults(toolName: string, params: any): any {
    // Handle null/undefined params (can happen if API sends "null" as arguments string)
    const result = { ...(params || {}) };

    switch (toolName) {
      case "listFiles":
        // dirname defaults to current directory
        if (!result.dirname) {
          result.dirname = ".";
        }
        break;

      // Add other tools with defaults here as needed
    }

    return result;
  }

  private async executeTool(toolCall: GrokToolCall): Promise<ToolResult> {
    try {
      // Parse arguments - handle empty string as empty object for parameter-less tools
      const argsString = toolCall.function.arguments?.trim() || "{}";
      let args = JSON.parse(argsString);

      // Handle multiple layers of JSON encoding (API bug)
      // Keep parsing until we get an object, not a string
      let parseCount = 0;
      while (typeof args === 'string' && parseCount < 5) {
        parseCount++;
        try {
          args = JSON.parse(args);
        } catch (e) {
          // If parse fails, the string isn't valid JSON - stop trying
          break;
        }
      }

      // Log if we had to fix encoding
      if (parseCount > 0) {
        const bugMsg = `[BUG] Tool ${toolCall.function.name} had ${parseCount} extra layer(s) of JSON encoding`;
        console.warn(bugMsg);

        const systemMsg = `Warning: Tool arguments for ${toolCall.function.name} had ${parseCount} extra encoding layer(s) - this is an API bug`;
        this.messages.push({
          role: 'system',
          content: systemMsg
        });
        this.chatHistory.push({
          type: 'system',
          content: systemMsg,
          timestamp: new Date()
        });
      }

      // Ensure args is always an object (API might send null)
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        args = {};
      }

      // Apply parameter defaults before approval hook and execution
      args = this.applyToolParameterDefaults(toolCall.function.name, args);

      // Task tools (startActiveTask, transitionActiveTaskStatus, stopActiveTask) have their own
      // dedicated task approval hook, so skip the general tool approval hook for them
      const isTaskTool = ['startActiveTask', 'transitionActiveTaskStatus', 'stopActiveTask'].includes(toolCall.function.name);

      // Check tool approval hook if configured (skip for task tools)
      const settings = getSettingsManager();
      const toolApprovalHook = settings.getToolApprovalHook();

      if (toolApprovalHook && !isTaskTool) {
        const approvalResult = await executeToolApprovalHook(
          toolApprovalHook,
          toolCall.function.name,
          args,
          30000, // 30 second timeout
          this.getCurrentTokenCount(),
          this.getMaxContextSize()
        );

        if (!approvalResult.approved) {
          const reason = approvalResult.reason || "Tool execution denied by approval hook";

          // Process rejection commands (SYSTEM messages)
          if (approvalResult.commands) {
            const results = applyHookCommands(approvalResult.commands);
            if (results.system) {
              this.messages.push({
                role: 'system',
                content: results.system,
              });
              this.chatHistory.push({
                type: 'system',
                content: results.system,
                timestamp: new Date(),
              });
            }
          }

          return {
            success: false,
            error: `Tool execution blocked: ${reason}`,
          };
        }

        if (approvalResult.timedOut) {
          // Log timeout for debugging (don't block)
          console.warn(`Tool approval hook timed out for ${toolCall.function.name} (auto-approved)`);
        }

        // Process hook commands (ENV, TOOL_RESULT, BACKEND, MODEL, SYSTEM)
        if (approvalResult.commands) {
          const results = applyHookCommands(approvalResult.commands);

          // TOOL_RESULT is for tool return values, not used by approval hook

          // Add SYSTEM message if present
          if (results.system) {
            this.messages.push({
              role: "system",
              content: results.system,
            });
            this.chatHistory.push({
              type: "system",
              content: results.system,
              timestamp: new Date(),
            });
          }

          // ENV variables are already applied to process.env by applyHookCommands
          // They can affect tool behavior if tools read from process.env
        }
      }

      switch (toolCall.function.name) {
        case "viewFile":
          { let range: [number, number] | undefined;
          range = args.start_line && args.end_line
            ? [args.start_line, args.end_line]
            : undefined;
          return await this.textEditor.viewFile(args.filename, range); }

        case "createNewFile":
          return await this.textEditor.createNewFile(args.filename, args.content);

        case "strReplace":
          return await this.textEditor.strReplace(
            args.filename,
            args.old_str,
            args.new_str,
            args.replace_all
          );

        case "editFile":
          if (!this.morphEditor) {
            return {
              success: false,
              error:
                "Morph Fast Apply not available. Please set MORPH_API_KEY environment variable to use this feature.",
            };
          }
          return await this.morphEditor.editFile(
            args.filename,
            args.instructions,
            args.code_edit
          );

        case "execute":
          return await this.zsh.execute(args.command);

        case "listFiles":
          return await this.zsh.listFiles(args.dirname);

        case "universalSearch":
          return await this.search.universalSearch(args.query, {
            searchType: args.search_type,
            includePattern: args.include_pattern,
            excludePattern: args.exclude_pattern,
            caseSensitive: args.case_sensitive,
            wholeWord: args.whole_word,
            regex: args.regex,
            maxResults: args.max_results,
            fileTypes: args.file_types,
            includeHidden: args.include_hidden,
          });

        case "getEnv":
          return await this.env.getEnv(args.variable);

        case "getAllEnv":
          return await this.env.getAllEnv();

        case "searchEnv":
          return await this.env.searchEnv(args.pattern);

        case "introspect":
          return await this.introspect.introspect(args.target);

        case "clearCache":
          return await this.clearCacheTool.clearCache(args.confirmationCode);

        case "setPersona":
          return await this.characterTool.setPersona(args.persona, args.color);

        case "setMood":
          return await this.characterTool.setMood(args.mood, args.color);

        case "getPersona":
          return await this.characterTool.getPersona();

        case "getMood":
          return await this.characterTool.getMood();

        case "getAvailablePersonas":
          return await this.characterTool.getAvailablePersonas();

        case "startActiveTask":
          return await this.taskTool.startActiveTask(args.activeTask, args.action, args.color);

        case "transitionActiveTaskStatus":
          return await this.taskTool.transitionActiveTaskStatus(args.action, args.color);

        case "stopActiveTask":
          return await this.taskTool.stopActiveTask(args.reason, args.documentationFile, args.color);

        case "insertLines":
          return await this.textEditor.insertLines(args.filename, args.insert_line, args.new_str);

        case "replaceLines":
          return await this.textEditor.replaceLines(args.filename, args.start_line, args.end_line, args.new_str);

        case "undoEdit":
          return await this.textEditor.undoEdit();

        case "chdir":
          return this.zsh.chdir(args.dirname);

        case "pwdir":
          return this.zsh.pwdir();

        case "downloadFile":
          return await this.internetTool.downloadFile(args.url);

        case "generateImage":
          return await this.imageTool.generateImage(
            args.prompt,
            args.negativePrompt,
            args.width,
            args.height,
            args.model,
            args.sampler,
            args.configScale,
            args.numSteps,
            args.nsfw,
            args.name,
            args.move,
            args.seed
          );

        case "captionImage":
          return await this.imageTool.captionImage(args.filename, args.prompt);

        case "pngInfo":
          return await this.imageTool.pngInfo(args.filename);

        case "readXlsx":
          return await this.fileConversionTool.readXlsx(
            args.filename,
            args.sheetName,
            args.outputFormat,
            args.output
          );

        case "listXlsxSheets":
          return await this.fileConversionTool.listXlsxSheets(args.filename);

        default:
          // Check if this is an MCP tool
          if (toolCall.function.name.startsWith("mcp__")) {
            return await this.executeMCPTool(toolCall.function.name, args);
          }

          return {
            success: false,
            error: `Unknown tool: ${toolCall.function.name}`,
          };
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Tool execution error: ${error.message}`,
      };
    }
  }

  private async executeMCPTool(toolName: string, args: any): Promise<ToolResult> {
    try {
      const mcpManager = getMCPManager();

      const result = await mcpManager.callTool(toolName, args);

      if (result.isError) {
        return {
          success: false,
          error: (result.content[0] as any)?.text || "MCP tool error",
        };
      }

      // Extract content from result
      const output = result.content
        .map((item) => {
          if (item.type === "text") {
            return item.text;
          } else if (item.type === "resource") {
            return `Resource: ${item.resource?.uri || "Unknown"}`;
          }
          return String(item);
        })
        .join("\n");

      return {
        success: true,
        output: output || "Success",
      };
    } catch (error: any) {
      return {
        success: false,
        error: `MCP tool execution error: ${error.message}`,
      };
    }
  }

  getChatHistory(): ChatEntry[] {
    return [...this.chatHistory];
  }

  setChatHistory(history: ChatEntry[]): void {
    // UI chatHistory already includes system prompts, so just replace entirely
    this.chatHistory = [...history];
  }

  getMessages(): any[] {
    return [...this.messages];
  }

  getCurrentTokenCount(): number {
    return this.tokenCounter.countMessageTokens(this.messages as any);
  }

  getMaxContextSize(): number {
    // TODO: Make this model-specific when different models have different context windows
    // For now, return the standard Grok context window size
    return 128000;
  }

  getContextUsagePercent(): number {
    const current = this.getCurrentTokenCount();
    const max = this.getMaxContextSize();
    return (current / max) * 100;
  }

  /**
   * Convert context messages to markdown format for viewing
   * Format: (N) Name (role) - timestamp
   */
  async convertContextToMarkdown(): Promise<string> {
    const lines: string[] = [];

    // Header
    const { ChatHistoryManager } = await import("../utils/chat-history-manager.js");
    const historyManager = ChatHistoryManager.getInstance();
    const contextFilePath = historyManager.getContextFilePath();

    lines.push("# Conversation Context");
    lines.push(`Context File: ${contextFilePath}`);
    lines.push(`Session: ${process.env.ZDS_AI_AGENT_SESSION || "N/A"}`);
    lines.push(`Tokens: ${this.getCurrentTokenCount()} / ${this.getMaxContextSize()} (${this.getContextUsagePercent().toFixed(1)}%)`);
    lines.push("");
    lines.push("---");
    lines.push("");

    // Get agent name from environment or default
    const agentName = process.env.ZDS_AI_AGENT_BOT_NAME || "Assistant";
    const userName = process.env.ZDS_AI_AGENT_MESSAGE_AUTHOR || "User";

    // Process messages
    this.chatHistory.forEach((entry, index) => {
      const msgNum = index + 1;
      const timestamp = entry.timestamp.toLocaleTimeString();

      if (entry.type === 'user') {
        lines.push(`(${msgNum}) ${userName} (user) - ${timestamp}`);
        lines.push(entry.content || "");
        lines.push("");
      } else if (entry.type === 'assistant') {
        lines.push(`(${msgNum}) ${agentName} (assistant) - ${timestamp}`);
        lines.push(entry.content || "");
        lines.push("");
      } else if (entry.type === 'system') {
        lines.push(`(${msgNum}) System (system) - ${timestamp}`);
        lines.push(entry.content || "");
        lines.push("");
      } else if (entry.type === 'tool_call') {
        const toolCall = entry.toolCall;
        const toolName = toolCall?.function?.name || "unknown";
        const params = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
        lines.push(`(${msgNum}) ${agentName} (tool_call: ${toolName}) - ${timestamp}`);
        lines.push(`Parameters: ${JSON.stringify(params, null, 2)}`);
        lines.push("");
      } else if (entry.type === 'tool_result') {
        const toolCall = entry.toolCall;
        const toolName = toolCall?.function?.name || "unknown";
        lines.push(`(${msgNum}) System (tool_result: ${toolName}) - ${timestamp}`);
        lines.push(entry.content || "");
        lines.push("");
      }
    });

    return lines.join("\n");
  }

  getPersona(): string {
    return this.persona;
  }

  getPersonaColor(): string {
    return this.personaColor;
  }

  getMood(): string {
    return this.mood;
  }

  getMoodColor(): string {
    return this.moodColor;
  }

  getActiveTask(): string {
    return this.activeTask;
  }

  getActiveTaskAction(): string {
    return this.activeTaskAction;
  }

  getActiveTaskColor(): string {
    return this.activeTaskColor;
  }

  setPendingContextEdit(tmpJsonPath: string, contextFilePath: string): void {
    this.pendingContextEdit = { tmpJsonPath, contextFilePath };
  }

  getPendingContextEdit(): { tmpJsonPath: string; contextFilePath: string } | null {
    return this.pendingContextEdit;
  }

  clearPendingContextEdit(): void {
    this.pendingContextEdit = null;
  }

  async setPersona(persona: string, color?: string): Promise<{ success: boolean; error?: string }> {
    // Execute hook if configured
    const settings = getSettingsManager();
    const hookPath = settings.getPersonaHook();
    const hookMandatory = settings.isPersonaHookMandatory();

    if (!hookPath && hookMandatory) {
      const reason = "Persona hook is mandatory but not configured";
      this.messages.push({
        role: 'system',
        content: `Failed to change persona to "${persona}": ${reason}`
      });
      return {
        success: false,
        error: reason
      };
    }

    if (hookPath) {
      const hookResult = await executeOperationHook(
        hookPath,
        "setPersona",
        {
          persona_old: this.persona || "",
          persona_new: persona,
          persona_color: color || "white"
        },
        30000,
        hookMandatory,
        this.getCurrentTokenCount(),
        this.getMaxContextSize()
      );

      if (!hookResult.approved) {
        const reason = hookResult.reason || "Hook rejected persona change";

        // Process rejection commands (SYSTEM messages)
        if (hookResult.commands) {
          const results = applyHookCommands(hookResult.commands);
          if (results.system) {
            this.messages.push({
              role: 'system',
              content: results.system,
            });
            this.chatHistory.push({
              type: 'system',
              content: results.system,
              timestamp: new Date(),
            });
          }
        }

        this.messages.push({
          role: 'system',
          content: `Failed to change persona to "${persona}": ${reason}`
        });
        return {
          success: false,
          error: reason
        };
      }

      if (hookResult.timedOut) {
        this.messages.push({
          role: 'system',
          content: `Persona hook timed out (auto-approved)`
        });
      }

      // Process hook commands (ENV, OUTPUT, SYSTEM)
      if (hookResult.commands) {
        const results = applyHookCommands(hookResult.commands);

        // Check for persona transformation via ENV
        if (results.env.ZDS_AI_AGENT_PERSONA) {
          persona = results.env.ZDS_AI_AGENT_PERSONA;
        }

        // Add SYSTEM message if present
        if (results.system) {
          this.messages.push({
            role: "system",
            content: results.system,
          });
          this.chatHistory.push({
            type: "system",
            content: results.system,
            timestamp: new Date(),
          });
        }
      }
    }

    const oldPersona = this.persona;
    const oldColor = this.personaColor;
    this.persona = persona;
    this.personaColor = color || "white";
    process.env.ZDS_AI_AGENT_PERSONA = persona;

    // Add system message for recordkeeping
    let systemContent: string;
    if (oldPersona) {
      const oldColorStr = oldColor && oldColor !== "white" ? ` (${oldColor})` : "";
      const newColorStr = this.personaColor && this.personaColor !== "white" ? ` (${this.personaColor})` : "";
      systemContent = `Assistant changed the persona from "${oldPersona}"${oldColorStr} to "${this.persona}"${newColorStr}`;
    } else {
      const colorStr = this.personaColor && this.personaColor !== "white" ? ` (${this.personaColor})` : "";
      systemContent = `Assistant set the persona to "${this.persona}"${colorStr}`;
    }

    this.messages.push({
      role: 'system',
      content: systemContent
    });

    // Also add to chat history for persistence
    this.chatHistory.push({
      type: 'system',
      content: systemContent,
      timestamp: new Date()
    });

    this.emit('personaChange', {
      persona: this.persona,
      color: this.personaColor
    });

    return { success: true };
  }

  async setMood(mood: string, color?: string): Promise<{ success: boolean; error?: string }> {
    // Execute hook if configured
    const settings = getSettingsManager();
    const hookPath = settings.getMoodHook();
    const hookMandatory = settings.isMoodHookMandatory();

    if (!hookPath && hookMandatory) {
      const reason = "Mood hook is mandatory but not configured";
      this.messages.push({
        role: 'system',
        content: `Failed to change mood to "${mood}": ${reason}`
      });
      return {
        success: false,
        error: reason
      };
    }

    if (hookPath) {
      const hookResult = await executeOperationHook(
        hookPath,
        "setMood",
        {
          mood_old: this.mood || "",
          mood_new: mood,
          mood_color: color || "white"
        },
        30000,
        hookMandatory,
        this.getCurrentTokenCount(),
        this.getMaxContextSize()
      );

      if (!hookResult.approved) {
        const reason = hookResult.reason || "Hook rejected mood change";

        // Process rejection commands (SYSTEM messages)
        if (hookResult.commands) {
          const results = applyHookCommands(hookResult.commands);
          if (results.system) {
            this.messages.push({
              role: 'system',
              content: results.system,
            });
            this.chatHistory.push({
              type: 'system',
              content: results.system,
              timestamp: new Date(),
            });
          }
        }

        this.messages.push({
          role: 'system',
          content: `Failed to change mood to "${mood}": ${reason}`
        });
        return {
          success: false,
          error: reason
        };
      }

      if (hookResult.timedOut) {
        this.messages.push({
          role: 'system',
          content: `Mood hook timed out (auto-approved)`
        });
      }

      // Process hook commands (ENV, OUTPUT, SYSTEM)
      if (hookResult.commands) {
        const results = applyHookCommands(hookResult.commands);

        // Check for mood transformation via ENV
        if (results.env.ZDS_AI_AGENT_MOOD) {
          mood = results.env.ZDS_AI_AGENT_MOOD;
        }

        // Add SYSTEM message if present
        if (results.system) {
          this.messages.push({
            role: "system",
            content: results.system,
          });
          this.chatHistory.push({
            type: "system",
            content: results.system,
            timestamp: new Date(),
          });
        }
      }
    }

    const oldMood = this.mood;
    const oldColor = this.moodColor;
    this.mood = mood;
    this.moodColor = color || "white";
    process.env.ZDS_AI_AGENT_MOOD = mood;

    // Add system message for recordkeeping
    let systemContent: string;
    if (oldMood) {
      const oldColorStr = oldColor && oldColor !== "white" ? ` (${oldColor})` : "";
      const newColorStr = this.moodColor && this.moodColor !== "white" ? ` (${this.moodColor})` : "";
      systemContent = `Assistant changed the mood from "${oldMood}"${oldColorStr} to "${this.mood}"${newColorStr}`;
    } else {
      const colorStr = this.moodColor && this.moodColor !== "white" ? ` (${this.moodColor})` : "";
      systemContent = `Assistant set the mood to "${this.mood}"${colorStr}`;
    }

    this.messages.push({
      role: 'system',
      content: systemContent
    });

    // Also add to chat history for persistence
    this.chatHistory.push({
      type: 'system',
      content: systemContent,
      timestamp: new Date()
    });

    this.emit('moodChange', {
      mood: this.mood,
      color: this.moodColor
    });

    return { success: true };
  }

  async startActiveTask(activeTask: string, action: string, color?: string): Promise<{ success: boolean; error?: string }> {
    // Cannot start new task if one already exists
    if (this.activeTask) {
      return {
        success: false,
        error: `Cannot start new task "${activeTask}". Active task "${this.activeTask}" must be stopped first.`
      };
    }

    // Execute hook if configured
    const settings = getSettingsManager();
    const hookPath = settings.getTaskApprovalHook();

    if (hookPath) {
      const hookResult = await executeOperationHook(
        hookPath,
        "startActiveTask",
        {
          activetask: activeTask,
          action: action,
          color: color || "white"
        },
        30000,
        false,  // Task hook is not mandatory
        this.getCurrentTokenCount(),
        this.getMaxContextSize()
      );

      // Process hook commands (SYSTEM messages, ENV variables) for both approval and rejection
      if (hookResult.commands) {
        const results = applyHookCommands(hookResult.commands);
        if (results.system) {
          this.messages.push({
            role: 'system',
            content: results.system,
          });
          this.chatHistory.push({
            type: 'system',
            content: results.system,
            timestamp: new Date(),
          });
        }
      }

      if (!hookResult.approved) {
        const reason = hookResult.reason || "Hook rejected task start";

        this.messages.push({
          role: 'system',
          content: `Failed to start task "${activeTask}": ${reason}`
        });
        return {
          success: false,
          error: reason
        };
      }

      if (hookResult.timedOut) {
        this.messages.push({
          role: 'system',
          content: `Task start hook timed out (auto-approved)`
        });
      }
    }

    // Set the task
    this.activeTask = activeTask;
    this.activeTaskAction = action;
    this.activeTaskColor = color || "white";

    // Add system message
    const colorStr = this.activeTaskColor && this.activeTaskColor !== "white" ? ` (${this.activeTaskColor})` : "";
    this.messages.push({
      role: 'system',
      content: `Assistant changed task status for "${this.activeTask}" to ${this.activeTaskAction}${colorStr}`
    });

    // Emit event
    this.emit('activeTaskChange', {
      activeTask: this.activeTask,
      action: this.activeTaskAction,
      color: this.activeTaskColor
    });

    return { success: true };
  }

  async transitionActiveTaskStatus(action: string, color?: string): Promise<{ success: boolean; error?: string }> {
    // Cannot transition if no active task
    if (!this.activeTask) {
      return {
        success: false,
        error: "Cannot transition task status. No active task is currently running."
      };
    }

    // Execute hook if configured
    const settings = getSettingsManager();
    const hookPath = settings.getTaskApprovalHook();

    if (hookPath) {
      const hookResult = await executeOperationHook(
        hookPath,
        "transitionActiveTaskStatus",
        {
          action: action,
          color: color || "white"
        },
        30000,
        false,  // Task hook is not mandatory
        this.getCurrentTokenCount(),
        this.getMaxContextSize()
      );

      // Process hook commands (SYSTEM messages, ENV variables) for both approval and rejection
      if (hookResult.commands) {
        const results = applyHookCommands(hookResult.commands);
        if (results.system) {
          this.messages.push({
            role: 'system',
            content: results.system,
          });
          this.chatHistory.push({
            type: 'system',
            content: results.system,
            timestamp: new Date(),
          });
        }
      }

      if (!hookResult.approved) {
        const reason = hookResult.reason || "Hook rejected task status transition";

        this.messages.push({
          role: 'system',
          content: `Failed to transition task "${this.activeTask}" from ${this.activeTaskAction} to ${action}: ${reason}`
        });
        return {
          success: false,
          error: reason
        };
      }

      if (hookResult.timedOut) {
        this.messages.push({
          role: 'system',
          content: `Task transition hook timed out (auto-approved)`
        });
      }
    }

    // Store old action for system message
    const oldAction = this.activeTaskAction;

    // Update the action and color
    this.activeTaskAction = action;
    this.activeTaskColor = color || this.activeTaskColor;

    // Add system message
    const colorStr = this.activeTaskColor && this.activeTaskColor !== "white" ? ` (${this.activeTaskColor})` : "";
    this.messages.push({
      role: 'system',
      content: `Assistant changed task status for "${this.activeTask}" from ${oldAction} to ${this.activeTaskAction}${colorStr}`
    });

    // Emit event
    this.emit('activeTaskChange', {
      activeTask: this.activeTask,
      action: this.activeTaskAction,
      color: this.activeTaskColor
    });

    return { success: true };
  }

  async stopActiveTask(reason: string, documentationFile: string, color?: string): Promise<{ success: boolean; error?: string }> {
    // Cannot stop if no active task
    if (!this.activeTask) {
      return {
        success: false,
        error: "Cannot stop task. No active task is currently running."
      };
    }

    // Record the start time for 3-second minimum
    const startTime = Date.now();

    // Execute hook if configured
    const settings = getSettingsManager();
    const hookPath = settings.getTaskApprovalHook();

    if (hookPath) {
      const hookResult = await executeOperationHook(
        hookPath,
        "stopActiveTask",
        {
          reason: reason,
          documentation_file: documentationFile,
          color: color || "white"
        },
        30000,
        false,  // Task hook is not mandatory
        this.getCurrentTokenCount(),
        this.getMaxContextSize()
      );

      // Process hook commands (SYSTEM messages, ENV variables) for both approval and rejection
      if (hookResult.commands) {
        const results = applyHookCommands(hookResult.commands);
        if (results.system) {
          this.messages.push({
            role: 'system',
            content: results.system,
          });
          this.chatHistory.push({
            type: 'system',
            content: results.system,
            timestamp: new Date(),
          });
        }
      }

      if (!hookResult.approved) {
        const hookReason = hookResult.reason || "Hook rejected task stop";

        this.messages.push({
          role: 'system',
          content: `Failed to stop task "${this.activeTask}": ${hookReason}`
        });
        return {
          success: false,
          error: hookReason
        };
      }

      if (hookResult.timedOut) {
        this.messages.push({
          role: 'system',
          content: `Task stop hook timed out (auto-approved)`
        });
      }
    }

    // Calculate remaining time to meet 3-second minimum
    const elapsed = Date.now() - startTime;
    const minimumDelay = 3000;
    const remainingDelay = Math.max(0, minimumDelay - elapsed);

    // Wait for remaining time if needed
    if (remainingDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, remainingDelay));
    }

    // Store task info for system message before clearing
    const stoppedTask = this.activeTask;
    const stoppedAction = this.activeTaskAction;

    // Clear the task
    this.activeTask = "";
    this.activeTaskAction = "";
    this.activeTaskColor = "white";

    // Add system message
    const colorStr = color && color !== "white" ? ` (${color})` : "";
    this.messages.push({
      role: 'system',
      content: `Assistant stopped task "${stoppedTask}" (was ${stoppedAction}) with reason: ${reason}${colorStr}`
    });

    // Emit event to clear widget
    this.emit('activeTaskChange', {
      activeTask: "",
      action: "",
      color: "white"
    });

    return { success: true };
  }

  private async emitContextChange(): Promise<void> {
    const percent = this.getContextUsagePercent();

    this.emit('contextChange', {
      current: this.getCurrentTokenCount(),
      max: this.getMaxContextSize(),
      percent
    });

    // Add system warnings based on context usage (may auto-clear at 100%)
    await this.addContextWarningIfNeeded(percent);
  }

  private async addContextWarningIfNeeded(percent: number): Promise<void> {
    let warning: string | null = null;
    const roundedPercent = Math.round(percent);

    if (percent >= 100) {
      // Auto-clear at 100%+ to prevent exceeding context limits
      warning = `CONTEXT LIMIT REACHED: You are at ${roundedPercent}% context capacity!  Automatically clearing cache to prevent context overflow...`;
      this.messages.push({
        role: 'system',
        content: warning
      });

      // Perform automatic cache clear
      await this.clearCache();
      return;
    }

    if (percent >= 95) {
      // Very stern warning at 95%+ (every time)
      warning = `CRITICAL CONTEXT WARNING: You are at ${roundedPercent}% context capacity!  You MUST immediately save any notes and lessons learned, then run the 'clearCache' tool to reset the conversation context.  The conversation will fail if you do not take action now.`;
    } else if (percent >= 90 && !this.contextWarningAt90) {
      // Dire warning at 90% (one time only)
      this.contextWarningAt90 = true;
      warning = `URGENT CONTEXT WARNING: You are at ${roundedPercent}% context capacity!  Perform your final tasks or responses and prepare to be reset.`;
    } else if (percent >= 80 && !this.contextWarningAt80) {
      // Initial warning at 80% (one time only)
      this.contextWarningAt80 = true;
      warning = `Context Warning: You are at ${roundedPercent}% context capacity!  You are approaching the limit.  Be concise and avoid lengthy outputs.`;
    }

    if (warning) {
      // Add as a system message
      this.messages.push({
        role: 'system',
        content: warning
      });
    }
  }

  async executeCommand(command: string, skipConfirmation: boolean = false): Promise<ToolResult> {
    return await this.zsh.execute(command, 30000, skipConfirmation);
  }

  getCurrentModel(): string {
    return this.grokClient.getCurrentModel();
  }

  setModel(model: string): void {
    this.grokClient.setModel(model);
    // Update token counter for new model
    this.tokenCounter.dispose();
    this.tokenCounter = createTokenCounter(model);
  }

  getBackend(): string {
    // Just return the backend name from the client (no detection)
    return this.grokClient.getBackendName();
  }

  abortCurrentOperation(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  async clearCache(): Promise<void> {
    const { ChatHistoryManager } = await import("../utils/chat-history-manager.js");
    const { executeStartupHook } = await import("../utils/startup-hook.js");
    const { executeOperationHook, applyHookCommands } = await import("../utils/hook-executor.js");
    const historyManager = ChatHistoryManager.getInstance();

    // Backup current context to timestamped files
    historyManager.backupHistory();

    // Clear the context
    this.chatHistory = [];
    this.messages = [];
    this.contextWarningAt80 = false;
    this.contextWarningAt90 = false;
    this.firstMessageProcessed = false;

    // Add temporary system message (will be replaced by initialize())
    this.messages.push({
      role: "system",
      content: "Initializing...",
    });
    this.chatHistory.push({
      type: "system",
      content: "Initializing...",
      timestamp: new Date(),
    });

    try {
      // Re-execute startup hook to get fresh output
      this.startupHookOutput = await executeStartupHook();

      // Reinitialize with system message and startup hook
      // Instance hook runs automatically at end of initialize()
      await this.initialize();
    } catch (error) {
      console.error("Error during initialize() in clearCache():", error);
      // Continue anyway - we still want to save the cleared state
    }

    // Save the cleared state FIRST before emitting (in case emit causes exit)
    historyManager.saveHistory(this.chatHistory);
    historyManager.saveMessages(this.messages);

    // Emit context change WITHOUT calling addContextWarningIfNeeded (to avoid recursive clearCache)
    const percent = this.getContextUsagePercent();
    this.emit('contextChange', {
      current: this.getCurrentTokenCount(),
      max: this.getMaxContextSize(),
      percent
    });
    // Note: Intentionally NOT calling addContextWarningIfNeeded here to prevent recursion
  }

  /**
   * Get current session state for persistence
   */
  getSessionState() {
    return {
      session: process.env.ZDS_AI_AGENT_SESSION || "",
      persona: this.persona,
      personaColor: this.personaColor,
      mood: this.mood,
      moodColor: this.moodColor,
      activeTask: this.activeTask,
      activeTaskAction: this.activeTaskAction,
      activeTaskColor: this.activeTaskColor,
      cwd: process.cwd(),
      contextCurrent: this.getCurrentTokenCount(),
      contextMax: this.getMaxContextSize(),
    };
  }

  /**
   * Restore session state from persistence
   */
  async restoreSessionState(state: {
    session?: string;
    persona: string;
    personaColor: string;
    mood: string;
    moodColor: string;
    activeTask: string;
    activeTaskAction: string;
    activeTaskColor: string;
    cwd: string;
    contextCurrent?: number;
    contextMax?: number;
  }): Promise<void> {
    // Restore session
    if (state.session) {
      process.env.ZDS_AI_AGENT_SESSION = state.session;
    }

    // Restore persona
    if (state.persona) {
      this.persona = state.persona;
      this.personaColor = state.personaColor;
      process.env.ZDS_AI_AGENT_PERSONA = state.persona;
      this.emit('personaChange', {
        persona: this.persona,
        color: this.personaColor
      });
    }

    // Restore mood
    if (state.mood) {
      this.mood = state.mood;
      this.moodColor = state.moodColor;
      process.env.ZDS_AI_AGENT_MOOD = state.mood;
      this.emit('moodChange', {
        mood: this.mood,
        color: this.moodColor
      });
    }

    // Restore active task
    if (state.activeTask) {
      this.activeTask = state.activeTask;
      this.activeTaskAction = state.activeTaskAction;
      this.activeTaskColor = state.activeTaskColor;
      this.emit('activeTaskChange', {
        activeTask: this.activeTask,
        action: this.activeTaskAction,
        color: this.activeTaskColor
      });
    }

    // Restore cwd
    if (state.cwd) {
      try {
        process.chdir(state.cwd);
      } catch (error) {
        console.warn(`Failed to restore working directory to ${state.cwd}:`, error);
      }
    }
  }

  /**
   * Get all tool instances and their class names for display purposes
   */
  getToolClassInfo(): Array<{ className: string; methods: string[] }> {
    const toolInstances = this.getToolInstances();

    return toolInstances.map(({ instance, className }) => ({
      className,
      methods: instance.getHandledToolNames ? instance.getHandledToolNames() : []
    }));
  }

  /**
   * Get all tool instances via reflection
   */
  private getToolInstances(): Array<{ instance: any; className: string }> {
    const instances: Array<{ instance: any; className: string }> = [];

    // Use reflection to find all tool instance properties
    const propertyNames = Object.getOwnPropertyNames(this);

    for (const propName of propertyNames) {
      const propValue = (this as any)[propName];

      // Check if this property is a tool instance (has getHandledToolNames method)
      if (propValue &&
          typeof propValue === 'object' &&
          typeof propValue.getHandledToolNames === 'function') {

        instances.push({
          instance: propValue,
          className: propValue.constructor.name
        });
      }
    }

    return instances;
  }
}
