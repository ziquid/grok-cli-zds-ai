import { GrokClient, GrokMessage, GrokToolCall } from '../grok/client';
import { GROK_TOOLS } from '../grok/tools';
import { TextEditorTool, BashTool, TodoTool, ConfirmationTool } from '../tools';
import { ToolResult } from '../types';
import { EventEmitter } from 'events';
import { createTokenCounter, TokenCounter } from '../utils/token-counter';

export interface ChatEntry {
  type: 'user' | 'assistant' | 'tool_result';
  content: string;
  timestamp: Date;
  toolCalls?: GrokToolCall[];
  toolCall?: GrokToolCall;
  toolResult?: { success: boolean; output?: string; error?: string };
  isStreaming?: boolean;
}

export interface StreamingChunk {
  type: 'content' | 'tool_calls' | 'tool_result' | 'done' | 'token_count';
  content?: string;
  toolCalls?: GrokToolCall[];
  toolCall?: GrokToolCall;
  toolResult?: ToolResult;
  tokenCount?: number;
}

export class GrokAgent extends EventEmitter {
  private grokClient: GrokClient;
  private textEditor: TextEditorTool;
  private bash: BashTool;
  private todoTool: TodoTool;
  private confirmationTool: ConfirmationTool;
  private chatHistory: ChatEntry[] = [];
  private messages: GrokMessage[] = [];
  private tokenCounter: TokenCounter;

  constructor(apiKey: string) {
    super();
    this.grokClient = new GrokClient(apiKey);
    this.textEditor = new TextEditorTool();
    this.bash = new BashTool();
    this.todoTool = new TodoTool();
    this.confirmationTool = new ConfirmationTool();
    this.tokenCounter = createTokenCounter('grok-4-latest');
    
    // Initialize with system message
    this.messages.push({
      role: 'system',
      content: `You are Grok CLI, an AI assistant that helps with file editing, coding tasks, and system operations. 

You have access to these tools:
- view_file: View file contents or directory listings
- create_file: Create new files with content (ONLY use this for files that don't exist yet)
- str_replace_editor: Replace text in existing files (ALWAYS use this to edit or update existing files)
- bash: Execute bash commands
- create_todo_list: Create a visual todo list for planning and tracking tasks
- update_todo_list: Update existing todos in your todo list
- request_confirmation: Request user confirmation before performing operations
- check_session_acceptance: Check if user has accepted operations for this session

IMPORTANT TOOL USAGE RULES:
- NEVER use create_file on files that already exist - this will overwrite them completely
- ALWAYS use str_replace_editor to modify existing files, even for small changes
- Before editing a file, use view_file to see its current contents
- Use create_file ONLY when creating entirely new files that don't exist

When a user asks you to edit, update, modify, or change an existing file:
1. First use view_file to see the current contents
2. Then use str_replace_editor to make the specific changes
3. Never use create_file for existing files

When a user asks you to create a new file that doesn't exist:
1. Use create_file with the full content

TASK PLANNING WITH TODO LISTS:
- For complex requests with multiple steps, ALWAYS create a todo list first to plan your approach
- Use create_todo_list to break down tasks into manageable items with priorities
- Mark tasks as 'in_progress' when you start working on them (only one at a time)
- Mark tasks as 'completed' immediately when finished
- Use update_todo_list to track your progress throughout the task
- Todo lists provide visual feedback with colors: ✅ Green (completed), 🔄 Cyan (in progress), ⏳ Yellow (pending)
- Always create todos with priorities: 'high' (🔴), 'medium' (🟡), 'low' (🟢)

MANDATORY USER CONFIRMATION SYSTEM:
CRITICAL: You MUST follow this confirmation protocol for ALL file operations and bash commands:

1. BEFORE performing ANY file operation (create_file, str_replace_editor) or bash command:
   - First use check_session_acceptance to see if the user has already accepted operations for this session
   - If the response shows hasAnyAcceptance: true for the relevant operation type, you may proceed without additional confirmation
   - If hasAnyAcceptance: false or the specific operation type is not accepted, you MUST use request_confirmation before proceeding

2. Session acceptance tracking:
   - fileOperationsAccepted: true means user accepted "don't ask again" for file operations
   - bashCommandsAccepted: true means user accepted "don't ask again" for bash commands  
   - allOperationsAccepted: true means user accepted "don't ask again" for all operations
   - hasAnyAcceptance: true means user has accepted at least one type of operation

3. Confirmation workflow:
   - Use request_confirmation with operation type, filename/command, and optional description
   - If confirmation is rejected, DO NOT proceed with the operation
   - If confirmation is accepted, proceed with the file operation or bash command
   - The confirmation system will automatically track "don't ask again" preferences

4. Operation types for confirmation:
   - "Create file" for create_file operations
   - "Edit file" for str_replace_editor operations
   - "Run bash command" for bash operations

NEVER bypass the confirmation system - it is a critical security feature that protects users from unintended operations.

Be helpful, direct, and efficient. Always explain what you're doing and show the results.

IMPORTANT RESPONSE GUIDELINES:
- After using tools, do NOT respond with pleasantries like "Thanks for..." or "Great!"
- Only provide necessary explanations or next steps if relevant to the task
- Keep responses concise and focused on the actual work being done
- If a tool execution completes the user's request, you can remain silent or give a brief confirmation

Current working directory: ${process.cwd()}`
    });
  }

  async processUserMessage(message: string): Promise<ChatEntry[]> {
    // Add user message to conversation
    const userEntry: ChatEntry = {
      type: 'user',
      content: message,
      timestamp: new Date()
    };
    this.chatHistory.push(userEntry);
    this.messages.push({ role: 'user', content: message });

    const newEntries: ChatEntry[] = [userEntry];
    const maxToolRounds = 10; // Prevent infinite loops
    let toolRounds = 0;

    try {
      let currentResponse = await this.grokClient.chat(this.messages, GROK_TOOLS);
      
      // Agent loop - continue until no more tool calls or max rounds reached
      while (toolRounds < maxToolRounds) {
        const assistantMessage = currentResponse.choices[0]?.message;

        if (!assistantMessage) {
          throw new Error('No response from Grok');
        }

        // Handle tool calls
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
          toolRounds++;
          
          // Add assistant message with tool calls
          const assistantEntry: ChatEntry = {
            type: 'assistant',
            content: assistantMessage.content || 'Using tools to help you...',
            timestamp: new Date(),
            toolCalls: assistantMessage.tool_calls
          };
          this.chatHistory.push(assistantEntry);
          newEntries.push(assistantEntry);

          // Add assistant message to conversation
          this.messages.push({
            role: 'assistant',
            content: assistantMessage.content || '',
            tool_calls: assistantMessage.tool_calls
          } as any);

          // Execute tool calls
          for (const toolCall of assistantMessage.tool_calls) {
            const result = await this.executeTool(toolCall);
            const toolResultEntry: ChatEntry = {
              type: 'tool_result',
              content: result.success ? result.output || 'Success' : result.error || 'Error occurred',
              timestamp: new Date(),
              toolCall: toolCall,
              toolResult: result
            };
            this.chatHistory.push(toolResultEntry);
            newEntries.push(toolResultEntry);

            // Add tool result to messages with proper format
            this.messages.push({
              role: 'tool',
              content: result.success ? (result.output || 'Success') : (result.error || 'Error'),
              tool_call_id: toolCall.id
            });
          }

          // Get next response - this might contain more tool calls
          currentResponse = await this.grokClient.chat(this.messages, GROK_TOOLS);
        } else {
          // No more tool calls, add final response
          const finalEntry: ChatEntry = {
            type: 'assistant',
            content: assistantMessage.content || 'I understand, but I don\'t have a specific response.',
            timestamp: new Date()
          };
          this.chatHistory.push(finalEntry);
          this.messages.push({ role: 'assistant', content: assistantMessage.content || '' });
          newEntries.push(finalEntry);
          break; // Exit the loop
        }
      }

      if (toolRounds >= maxToolRounds) {
        const warningEntry: ChatEntry = {
          type: 'assistant',
          content: 'Maximum tool execution rounds reached. Stopping to prevent infinite loops.',
          timestamp: new Date()
        };
        this.chatHistory.push(warningEntry);
        newEntries.push(warningEntry);
      }

      return newEntries;
    } catch (error: any) {
      const errorEntry: ChatEntry = {
        type: 'assistant',
        content: `Sorry, I encountered an error: ${error.message}`,
        timestamp: new Date()
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
        } else if (typeof acc[key] === 'string' && typeof value === 'string') {
          (acc[key] as string) += value;
        } else if (Array.isArray(acc[key]) && Array.isArray(value)) {
          const accArray = acc[key] as any[];
          for (let i = 0; i < value.length; i++) {
            if (!accArray[i]) accArray[i] = {};
            accArray[i] = reduce(accArray[i], value[i]);
          }
        } else if (typeof acc[key] === 'object' && typeof value === 'object') {
          acc[key] = reduce(acc[key], value);
        }
      }
      return acc;
    };
    
    return reduce(previous, item.choices[0]?.delta || {});
  }

  async *processUserMessageStream(message: string): AsyncGenerator<StreamingChunk, void, unknown> {
    // Add user message to conversation
    const userEntry: ChatEntry = {
      type: 'user',
      content: message,
      timestamp: new Date()
    };
    this.chatHistory.push(userEntry);
    this.messages.push({ role: 'user', content: message });

    // Calculate input tokens
    const inputTokens = this.tokenCounter.countMessageTokens(this.messages as any);
    yield {
      type: 'token_count',
      tokenCount: inputTokens
    };

    const maxToolRounds = 10; // Prevent infinite loops
    let toolRounds = 0;
    let totalOutputTokens = 0;

    try {
      // Agent loop - continue until no more tool calls or max rounds reached
      while (toolRounds < maxToolRounds) {
        // Stream response and accumulate
        const stream = this.grokClient.chatStream(this.messages, GROK_TOOLS);
        let accumulatedMessage: any = {};
        let accumulatedContent = '';
        let toolCallsYielded = false;
        
        for await (const chunk of stream) {
          if (!chunk.choices?.[0]) continue;
          
          // Accumulate the message using reducer
          accumulatedMessage = this.messageReducer(accumulatedMessage, chunk);
          
          // Check for tool calls - yield when we have complete tool calls with function names
          if (!toolCallsYielded && accumulatedMessage.tool_calls?.length > 0) {
            // Check if we have at least one complete tool call with a function name
            const hasCompleteTool = accumulatedMessage.tool_calls.some((tc: any) => tc.function?.name);
            if (hasCompleteTool) {
              yield {
                type: 'tool_calls',
                toolCalls: accumulatedMessage.tool_calls
              };
              toolCallsYielded = true;
            }
          }
          
          // Stream content as it comes
          if (chunk.choices[0].delta?.content) {
            accumulatedContent += chunk.choices[0].delta.content;
            
            // Update token count in real-time
            const currentOutputTokens = this.tokenCounter.estimateStreamingTokens(accumulatedContent);
            totalOutputTokens = currentOutputTokens;
            
            yield {
              type: 'content',
              content: chunk.choices[0].delta.content
            };
            
            // Emit token count update
            yield {
              type: 'token_count',
              tokenCount: inputTokens + totalOutputTokens
            };
          }
        }

        // Add assistant entry to history
        const assistantEntry: ChatEntry = {
          type: 'assistant',
          content: accumulatedMessage.content || 'Using tools to help you...',
          timestamp: new Date(),
          toolCalls: accumulatedMessage.tool_calls || undefined
        };
        this.chatHistory.push(assistantEntry);

        // Add accumulated message to conversation
        this.messages.push({
          role: 'assistant',
          content: accumulatedMessage.content || '',
          tool_calls: accumulatedMessage.tool_calls
        } as any);

        // Handle tool calls if present
        if (accumulatedMessage.tool_calls?.length > 0) {
          toolRounds++;
          
          // Only yield tool_calls if we haven't already yielded them during streaming
          if (!toolCallsYielded) {
            yield {
              type: 'tool_calls',
              toolCalls: accumulatedMessage.tool_calls
            };
          }

          // Execute tools
          for (const toolCall of accumulatedMessage.tool_calls) {
            const result = await this.executeTool(toolCall);
            
            const toolResultEntry: ChatEntry = {
              type: 'tool_result',
              content: result.success ? result.output || 'Success' : result.error || 'Error occurred',
              timestamp: new Date(),
              toolCall: toolCall,
              toolResult: result
            };
            this.chatHistory.push(toolResultEntry);
            
            yield {
              type: 'tool_result',
              toolCall,
              toolResult: result
            };

            // Add tool result with proper format
            this.messages.push({
              role: 'tool',
              content: result.success ? (result.output || 'Success') : (result.error || 'Error'),
              tool_call_id: toolCall.id
            });
          }

          // Continue the loop to get the next response (which might have more tool calls)
        } else {
          // No tool calls, we're done
          break;
        }
      }

      if (toolRounds >= maxToolRounds) {
        yield {
          type: 'content',
          content: '\n\nMaximum tool execution rounds reached. Stopping to prevent infinite loops.'
        };
      }

      yield { type: 'done' };
    } catch (error: any) {
      const errorEntry: ChatEntry = {
        type: 'assistant',
        content: `Sorry, I encountered an error: ${error.message}`,
        timestamp: new Date()
      };
      this.chatHistory.push(errorEntry);
      yield {
        type: 'content',
        content: errorEntry.content
      };
      yield { type: 'done' };
    }
  }


  private async executeTool(toolCall: GrokToolCall): Promise<ToolResult> {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      
      switch (toolCall.function.name) {
        case 'view_file':
          const range: [number, number] | undefined = args.start_line && args.end_line ? [args.start_line, args.end_line] : undefined;
          return await this.textEditor.view(args.path, range);
          
        case 'create_file':
          return await this.textEditor.create(args.path, args.content);
          
        case 'str_replace_editor':
          return await this.textEditor.strReplace(args.path, args.old_str, args.new_str);
          
        case 'bash':
          return await this.bash.execute(args.command);
          
        case 'create_todo_list':
          return await this.todoTool.createTodoList(args.todos);
          
        case 'update_todo_list':
          return await this.todoTool.updateTodoList(args.updates);
          
        case 'request_confirmation':
          return await this.confirmationTool.requestConfirmation({
            operation: args.operation,
            filename: args.filename,
            description: args.description,
            showVSCodeOpen: args.showVSCodeOpen
          });
          
        case 'check_session_acceptance':
          return await this.confirmationTool.checkSessionAcceptance();
          
        default:
          return {
            success: false,
            error: `Unknown tool: ${toolCall.function.name}`
          };
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Tool execution error: ${error.message}`
      };
    }
  }

  getChatHistory(): ChatEntry[] {
    return [...this.chatHistory];
  }

  getCurrentDirectory(): string {
    return this.bash.getCurrentDirectory();
  }

  async executeBashCommand(command: string): Promise<ToolResult> {
    return await this.bash.execute(command);
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
}