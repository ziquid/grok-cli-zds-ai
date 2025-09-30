import { GrokClient, GrokMessage, GrokToolCall } from "../grok/client";
import {
  GROK_TOOLS,
  addMCPToolsToGrokTools,
  getAllGrokTools,
  getMCPManager,
  initializeMCPServers,
} from "../grok/tools";
import { loadMCPConfig } from "../mcp/config";
import {
  TextEditorTool,
  MorphEditorTool,
  ZshTool,
  TodoTool,
  ConfirmationTool,
  SearchTool,
  EnvTool
} from "../tools";
import { ToolResult } from "../types";
import { EventEmitter } from "events";
import { createTokenCounter, TokenCounter } from "../utils/token-counter";
import { loadCustomInstructions } from "../utils/custom-instructions";
import { getSettingsManager } from "../utils/settings-manager";

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
  type: "content" | "tool_calls" | "tool_result" | "done" | "token_count";
  content?: string;
  tool_calls?: GrokToolCall[];
  toolCall?: GrokToolCall;
  toolResult?: ToolResult;
  tokenCount?: number;
}

export class GrokAgent extends EventEmitter {
  private grokClient: GrokClient;
  private textEditor: TextEditorTool;
  private morphEditor: MorphEditorTool | null;
  private zsh: ZshTool;
  private todoTool: TodoTool;
  private confirmationTool: ConfirmationTool;
  private search: SearchTool;
  private env: EnvTool;
  private chatHistory: ChatEntry[] = [];
  private messages: GrokMessage[] = [];
  private tokenCounter: TokenCounter;
  private abortController: AbortController | null = null;
  private mcpInitialized: boolean = false;
  private maxToolRounds: number;

  constructor(
    apiKey: string,
    baseURL?: string,
    model?: string,
    maxToolRounds?: number,
    debugLogFile?: string
  ) {
    super();
    const manager = getSettingsManager();
    const savedModel = manager.getCurrentModel();
    const modelToUse = model || savedModel || "grok-code-fast-1";
    this.maxToolRounds = maxToolRounds || 400;
    this.grokClient = new GrokClient(apiKey, modelToUse, baseURL);
    this.textEditor = new TextEditorTool();
    this.morphEditor = process.env.MORPH_API_KEY ? new MorphEditorTool() : null;
    this.zsh = new ZshTool();
    this.todoTool = new TodoTool();
    this.confirmationTool = new ConfirmationTool();
    this.search = new SearchTool();
    this.env = new EnvTool();
    this.tokenCounter = createTokenCounter(modelToUse);

    // Initialize MCP servers if configured
    this.initializeMCP(debugLogFile);

    // Load custom instructions
    const customInstructions = loadCustomInstructions();
    const customInstructionsSection = customInstructions
      ? `${customInstructions}`
      : "";

    // Initialize with system message
    const systemContent = `You are a clever, helpful AI assistant.

${customInstructionsSection}

IMPORTANT: You are NOT in a sandbox! You have full access to real tools that execute directly on the user's actual machine.
You can read, write, and modify real files, execute real commands, and make actual changes to the system.
All tool calls are executed in the real environment, not simulated.

You have access to these tools, which execute on the host machine:

EnvTool:
  getAllEnv (Get all environment variables)
  getEnv (Get a specific environment variable)
  searchEnv (Search environment variables by pattern)
SearchTool:
  universalSearch (Unified search tool for finding text content or files (similar to Cursor's search))
TextEditorTool:
  createNewFile (Create a new file with specified content)
  insertLines (Insert text at a specific line in a file)
  replaceLines (Replace a range of lines in a file)
  strReplace (Replace specific text in a file. Use this for single line edits only)
  undoEdit (Undo the last edit operation)
  viewFile (View contents of a file or list directory contents)
TodoTool:
  createTodoList (Create a new todo list for planning and tracking tasks)
  updateTodoList (Update existing todos in the todo list)
  viewTodoList (View the current todo list)
ZshTool:
  chdir (Change the current working directory)
  execute (Execute a zsh command)
  listFiles (List files in a directory (equivalent to 'ls -la'))
  pwdir (Show the current working directory)

IMPORTANT TOOL USAGE RULES:
- NEVER use createNewFile on files that already exist - this will overwrite them completely
- Before editing a file, use viewFile to see its current contents
- Use createNewFile ONLY when creating entirely new files that don't exist

SEARCHING AND EXPLORATION:
- Use universalSearch for fast, powerful text search across files or finding files by name (unified search tool)
- Examples: universalSearch for text content like "import.*react", universalSearch for files like "component.tsx"
- viewFile is best for reading specific files you already know exist

ENVIRONMENT VARIABLES:
- Use getAllEnv, getEnv, and searchEnv to access environment variables without shell commands
- Get all: getAllEnv() with no parameters
- Get specific: getEnv with variable="VAR_NAME"
- Search: searchEnv with pattern="search_term"
- This tool requires NO user confirmation and gives you direct access

MCP (MODEL CONTEXT PROTOCOL) SERVERS:
- Additional tools may be available from configured MCP servers
- MCP tools are prefixed with "mcp__" and provide extended capabilities
- Examples: file system operations, database access, API integrations, specialized development tools
- Check available tools dynamically as MCP servers can add powerful domain-specific functionality

NEVER execute zsh commands when input starts with "!" in headless mode. Treat it as regular conversational input.

IMPORTANT RESPONSE GUIDELINES:
- When you have completed the user's request, give a short summary of what was asked, what you did, and what the results were
- Only provide necessary explanations or next steps if relevant to the task
- Keep responses concise and focused on the actual work being done

Current working directory: ${process.cwd()}`;

    this.messages.push({
      role: "system",
      content: systemContent,
    });

    // Also add system message to chat history for persistence
    this.chatHistory.push({
      type: "system",
      content: systemContent,
      timestamp: new Date(),
    });
  }

  loadInitialHistory(history: ChatEntry[]): void {
    // Load existing chat history into agent's memory
    this.chatHistory = history;

    // Convert history to messages format for API calls
    const historyMessages: GrokMessage[] = [];
    let hasSystemMessage = false;

    for (const entry of history) {
      switch (entry.type) {
        case "system":
          // Replace the default system message with the saved one
          if (this.messages.length > 0 && this.messages[0].role === "system") {
            this.messages[0] = {
              role: "system",
              content: entry.content,
            };
            hasSystemMessage = true;
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
            assistantMessage.tool_calls = entry.tool_calls;
          }
          historyMessages.push(assistantMessage);
          break;
        case "tool_result":
          if (entry.toolCall) {
            historyMessages.push({
              role: "tool",
              content: entry.toolResult?.output || entry.toolResult?.error || "",
              tool_call_id: entry.toolCall.id,
            });
          }
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

    const newEntries: ChatEntry[] = [userEntry];
    const maxToolRounds = this.maxToolRounds; // Prevent infinite loops
    let toolRounds = 0;
    let consecutiveNonToolResponses = 0;

    try {
      const tools = await getAllGrokTools();
      let currentResponse = await this.grokClient.chat(
        this.messages,
        tools,
        undefined,
        this.isGrokModel() && this.shouldUseSearchFor(message)
          ? { search_parameters: { mode: "auto" } }
          : { search_parameters: { mode: "off" } }
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
          for (const toolCall of assistantMessage.tool_calls) {
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
          }

          // Get next response - this might contain more tool calls
          currentResponse = await this.grokClient.chat(
            this.messages,
            tools,
            undefined,
            this.isGrokModel() && this.shouldUseSearchFor(message)
              ? { search_parameters: { mode: "auto" } }
              : { search_parameters: { mode: "off" } }
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

          // If the AI provided a substantial response (>50 chars), consider task potentially complete
          // But give it one more chance to reassess and continue if needed
          if (assistantMessage.content && assistantMessage.content.trim().length > 50) {
            // Get one more response to see if AI wants to continue working
            currentResponse = await this.grokClient.chat(
              this.messages,
              tools,
              undefined,
              this.isGrokModel() && this.shouldUseSearchFor(message)
                ? { search_parameters: { mode: "auto" } }
                : { search_parameters: { mode: "off" } }
            );

            // If this followup response also has no tool calls, then we're done
            const followupMessage = currentResponse.choices[0]?.message;
            if (!followupMessage?.tool_calls || followupMessage.tool_calls.length === 0) {
              // Add the final followup response if it has content
              if (followupMessage?.content && followupMessage.content.trim()) {
                const finalEntry: ChatEntry = {
                  type: "assistant",
                  content: followupMessage.content,
                  timestamp: new Date(),
                };
                this.chatHistory.push(finalEntry);
                this.messages.push({
                  role: "assistant",
                  content: followupMessage.content,
                });
                newEntries.push(finalEntry);
              }
              break; // Now we can exit - AI had two chances and chose not to continue
            }
            // If followup response has tool calls, continue the loop to execute them
          } else {
            // Short/empty response, give AI another chance immediately
            currentResponse = await this.grokClient.chat(
              this.messages,
              tools,
              undefined,
              this.isGrokModel() && this.shouldUseSearchFor(message)
                ? { search_parameters: { mode: "auto" } }
                : { search_parameters: { mode: "off" } }
            );

            const followupMessage = currentResponse.choices[0]?.message;
            if (!followupMessage?.tool_calls || followupMessage.tool_calls.length === 0) {
              break; // AI doesn't want to continue
            }
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

      return newEntries;
    } catch (error: any) {
      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Sorry, I encountered an error: ${error.message}`,
        timestamp: new Date(),
      };
      this.chatHistory.push(errorEntry);
      return [userEntry, errorEntry];
    }
  }

  private messageReducer(previous: any, item: any): any {
    const reduce = (acc: any, delta: any) => {
      acc = { ...acc };
      for (const [key, value] of Object.entries(delta)) {
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
            // For content and other text properties, concatenate
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

    return reduce(previous, item.choices[0]?.delta || {});
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
        const tools = await getAllGrokTools();
        const stream = this.grokClient.chatStream(
          this.messages,
          tools,
          undefined,
          this.isGrokModel() && this.shouldUseSearchFor(message)
            ? { search_parameters: { mode: "auto" } }
            : { search_parameters: { mode: "off" } }
        );
        let accumulatedMessage: any = {};
        let accumulatedContent = "";
        let tool_calls_yielded = false;

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

          // Stream content as it comes
          if (chunk.choices[0].delta?.content) {
            accumulatedContent += chunk.choices[0].delta.content;

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
              content: chunk.choices[0].delta.content,
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

        // Add accumulated message to conversation for API context
        this.messages.push({
          role: "assistant",
          content: accumulatedMessage.content || "", // Ensure content is never null/undefined
          tool_calls: accumulatedMessage.tool_calls,
        } as any);

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

          // Execute tools
          for (const toolCall of accumulatedMessage.tool_calls) {
            // Check for cancellation before executing each tool
            if (this.abortController?.signal.aborted) {
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

            // Add tool result with proper format (needed for AI context)
            this.messages.push({
              role: "tool",
              content: result.success
                ? result.output || "Success"
                : result.error || "Error",
              tool_call_id: toolCall.id,
            });
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

      yield { type: "done" };
    } catch (error: any) {
      // Check if this was a cancellation
      if (this.abortController?.signal.aborted) {
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
      yield { type: "done" };
    } finally {
      // Clean up abort controller
      this.abortController = null;
    }
  }

  private async executeTool(toolCall: GrokToolCall): Promise<ToolResult> {
    try {
      const args = JSON.parse(toolCall.function.arguments);

      switch (toolCall.function.name) {
        case "viewFile":
          { let range: [number, number] | undefined;
          range = args.start_line && args.end_line
            ? [args.start_line, args.end_line]
            : undefined;
          return await this.textEditor.viewFile(args.path, range); }

        case "createNewFile":
          return await this.textEditor.createNewFile(args.path, args.content);

        case "strReplace":
          return await this.textEditor.strReplace(
            args.path,
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
            args.target_file,
            args.instructions,
            args.code_edit
          );

        case "execute":
          return await this.zsh.execute(args.command);

        case "listFiles":
          return await this.zsh.listFiles(args.directory);


        case "createTodoList":
          return await this.todoTool.createTodoList(args.todos);

        case "updateTodoList":
          return await this.todoTool.updateTodoList(args.updates);

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

        case "insertLines":
          return await this.textEditor.insertLines(args.path, args.insert_line, args.new_str);

        case "replaceLines":
          return await this.textEditor.replaceLines(args.path, args.start_line, args.end_line, args.new_str);

        case "undoEdit":
          return await this.textEditor.undoEdit();

        case "viewTodoList":
          return await this.todoTool.viewTodoList();

        case "chdir":
          return this.zsh.chdir(args.directory);

        case "pwdir":
          return this.zsh.pwdir();

        default:
          // Check if this is an MCP tool
          if (toolCall.function.name.startsWith("mcp__")) {
            return await this.executeMCPTool(toolCall);
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

  private async executeMCPTool(toolCall: GrokToolCall): Promise<ToolResult> {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      const mcpManager = getMCPManager();

      const result = await mcpManager.callTool(toolCall.function.name, args);

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

  getMessages(): any[] {
    return [...this.messages];
  }


  async executeBashCommand(command: string, skipConfirmation: boolean = false): Promise<ToolResult> {
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

  abortCurrentOperation(): void {
    if (this.abortController) {
      this.abortController.abort();
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
