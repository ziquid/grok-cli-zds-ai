import { GrokAgent, ChatEntry } from "../agent/grok-agent.js";
import { ConfirmationService } from "./confirmation-service.js";

/**
 * Interface for slash command handlers
 * Allows different contexts (UI vs headless) to provide their own implementations
 */
export interface SlashCommandContext {
  agent: GrokAgent;
  addChatEntry: (entry: ChatEntry) => void;
  clearInput?: () => void;
  resetHistory?: () => void;
  setProcessingStates?: (states: {
    isProcessing?: boolean;
    isStreaming?: boolean;
    tokenCount?: number;
    processingTime?: number;
  }) => void;
  setTotalTokenUsage?: (updater: number | ((prev: number) => number)) => void;
  isHeadless?: boolean;
  isInkMode?: boolean;
}

/**
 * Process slash commands
 * Returns true if command was handled, false if it should be processed as normal input
 */
export async function processSlashCommand(
  input: string,
  context: SlashCommandContext
): Promise<boolean> {
  const { agent, addChatEntry, clearInput, resetHistory, setProcessingStates, setTotalTokenUsage, isHeadless, isInkMode } = context;
  const trimmedInput = input.trim();

  // !<command> - execute shell command in interactive modes only
  // In headless mode, pass to LLM unmodified
  if (trimmedInput.startsWith("!")) {
    // In headless mode, don't handle - let it pass to LLM
    if (isHeadless) {
      return false;
    }

    // Interactive modes (Ink and no-ink): execute the command
    const command = trimmedInput.substring(1).trim();
    if (command) {
      // Execute the command
      const result = await agent.executeCommand(command, true); // skip confirmation

      // Add user message and tool result to chat history
      const userEntry: ChatEntry = {
        type: "user",
        content: trimmedInput,
        timestamp: new Date(),
      };
      addChatEntry(userEntry);

      const commandEntry: ChatEntry = {
        type: "tool_result",
        content: result.success
          ? result.output || "Command completed"
          : result.error || "Command failed",
        timestamp: new Date(),
        toolCall: {
          id: `user_execute_${Date.now()}`,
          type: "function",
          function: {
            name: "execute",
            arguments: JSON.stringify({ command: command }),
          },
        },
        toolResult: result,
      };
      addChatEntry(commandEntry);

      if (clearInput) clearInput();

      // Return true - command executed, don't send to LLM as prompt
      return true;
    }
    return true; // Empty command after !
  }

  // /clear command
  if (trimmedInput === "/clear") {
    try {
      // Set processing state if available
      if (setProcessingStates) {
        setProcessingStates({ isProcessing: true });
      }

      // Clear agent's internal context
      await agent.clearCache();

      // Reset confirmation service session flags
      const confirmationService = ConfirmationService.getInstance();
      confirmationService.resetSession();

      // Reset states
      if (setProcessingStates) {
        setProcessingStates({
          isProcessing: false,
          isStreaming: false,
          tokenCount: 0,
          processingTime: 0,
        });
      }

      // Reset total token usage
      if (setTotalTokenUsage) {
        setTotalTokenUsage(0);
      }

      // Clear input and history if available
      if (clearInput) clearInput();
      if (resetHistory) resetHistory();

      // In headless mode, just output confirmation
      if (isHeadless) {
        console.log("Chat history cleared");
      }

      return true;
    } catch (error) {
      const errorMessage = `ERROR: Failed to clear cache: ${error instanceof Error ? error.message : String(error)}`;

      if (isHeadless) {
        console.error(errorMessage);
      } else {
        const errorEntry: ChatEntry = {
          type: "system",
          content: errorMessage,
          timestamp: new Date(),
        };
        addChatEntry(errorEntry);
      }

      if (setProcessingStates) {
        setProcessingStates({
          isProcessing: false,
          isStreaming: false,
        });
      }

      return true;
    }
  }

  // /introspect command
  if (trimmedInput.startsWith("/introspect")) {
    const parts = trimmedInput.split(" ");
    const target = parts[1] || "help";

    const toolResult = await agent["introspect"].introspect(target);
    const content = toolResult.success ? toolResult.output! : toolResult.error!;

    if (isHeadless) {
      console.log(content);
    } else {
      const introspectEntry: ChatEntry = {
        type: "assistant",
        content,
        timestamp: new Date(),
        preserveFormatting: true,
      };
      addChatEntry(introspectEntry);
      if (clearInput) clearInput();
    }

    return true;
  }

  // /help command
  if (trimmedInput === "/help") {
    const helpText = `Grok CLI Help:

Built-in Commands:
  /clear      - Clear chat history (current session + persisted)
  /context    - Show context usage info
  /context view - View full context in pager (markdown format)
  /context edit - Edit context JSON file (opens in $EDITOR)
  /help       - Show this help
  /ink        - Switch to Ink UI mode (restart required)
  /introspect - Show available tools (internal and MCP)
  /models     - Switch between available models
  /no-ink     - Switch to plain console mode (restart required)
  /restart    - Restart the application (exit code 51)
  /exit       - Exit application
  exit, quit  - Exit application

CLI Options:
  --fresh     - Start with a fresh session (don't load previous history)

Git Commands:
  /commit-and-push - AI-generated commit + push to remote

Enhanced Input Features:
  ↑/↓ Arrow   - Navigate command history
  Ctrl+C      - Clear input (press twice to exit)
  Ctrl+D      - Exit on blank line
  Ctrl+←/→    - Move by word
  Ctrl+A/E    - Move to line start/end
  Ctrl+W      - Delete word before cursor
  Ctrl+K      - Delete to end of line
  Ctrl+U      - Delete to start of line
  ESC         - Cancel current action / close menus
  ESC (twice) - Clear input line
  Shift+Tab   - Toggle auto-edit mode (bypass confirmations)

Direct Commands (executed immediately):
  !command    - Execute any shell command directly
  ls [path]   - List directory contents
  pwd         - Show current directory
  cd <path>   - Change directory
  cat <file>  - View file contents
  mkdir <dir> - Create directory
  touch <file>- Create empty file

Model Configuration:
  Edit ~/.grok/models.json to add custom models (Claude, GPT, Gemini, etc.)

History Persistence:
  Chat history is automatically saved and restored between sessions.
  Use /clear to reset both current and persisted history.

For complex operations, just describe what you want in natural language.
Examples:
  "edit package.json and add a new script"
  "create a new React component called Header"
  "show me all TypeScript files in this project"`;

    if (isHeadless) {
      console.log(helpText);
    } else {
      const helpEntry: ChatEntry = {
        type: "assistant",
        content: helpText,
        timestamp: new Date(),
      };
      addChatEntry(helpEntry);
      if (clearInput) clearInput();
    }

    return true;
  }

  // /restart command
  if (trimmedInput === "/restart") {
    // Call the restart tool which exits with code 51
    await agent["restartTool"].restart();
    return true; // This line won't be reached but TypeScript needs it
  }

  // /ink command - switch to Ink UI mode
  if (trimmedInput === "/ink") {
    if (isHeadless) {
      console.error("ERROR: /ink requires interactive mode");
      return true;
    }

    // Check if already in ink mode
    if (isInkMode) {
      const alreadyEntry: ChatEntry = {
        type: "system",
        content: "You are already in Ink UI mode",
        timestamp: new Date(),
      };
      addChatEntry(alreadyEntry);
      if (clearInput) clearInput();
      return true;
    }

    const switchEntry: ChatEntry = {
      type: "assistant",
      content: "Switching to Ink UI mode...",
      timestamp: new Date(),
    };
    addChatEntry(switchEntry);

    // Exit with code 52 - wrapper will add --no-ink=false or remove --no-ink and restart
    process.exit(52);
    return true;
  }

  // /no-ink command - switch to plain console mode
  if (trimmedInput === "/no-ink") {
    if (isHeadless) {
      console.error("ERROR: /no-ink requires interactive mode");
      return true;
    }

    // Check if already in plain console mode
    if (!isInkMode) {
      const alreadyEntry: ChatEntry = {
        type: "system",
        content: "You are already in plain console mode",
        timestamp: new Date(),
      };
      addChatEntry(alreadyEntry);
      if (clearInput) clearInput();
      return true;
    }

    const switchEntry: ChatEntry = {
      type: "assistant",
      content: "Switching to plain console mode...",
      timestamp: new Date(),
    };
    addChatEntry(switchEntry);

    // Exit with code 53 - wrapper will add --no-ink and restart
    process.exit(53);
    return true;
  }

  // /exit command
  if (trimmedInput === "/exit") {
    process.exit(0);
    return true;
  }

  // /context command
  if (trimmedInput.startsWith("/context")) {
    const parts = trimmedInput.split(" ");
    const subcommand = parts[1];

    if (subcommand === "view" || subcommand === "edit") {
      // These commands require interactive mode
      if (isHeadless) {
        console.error(`ERROR: /context ${subcommand} requires interactive mode`);
        return true;
      }
      // In interactive mode, let the UI handler deal with it
      return false;
    } else {
      // Default: show context usage info (redirect to /introspect context)
      const toolResult = await agent["introspect"].introspect("context");
      const content = toolResult.success ? toolResult.output! : toolResult.error!;

      if (isHeadless) {
        console.log(content);
      } else {
        const contextEntry: ChatEntry = {
          type: "assistant",
          content,
          timestamp: new Date(),
        };
        addChatEntry(contextEntry);
        if (clearInput) clearInput();
      }

      return true;
    }
  }

  // /persona command
  if (trimmedInput.startsWith("/persona")) {
    const parts = trimmedInput.split(" ");
    if (parts.length < 2) {
      const helpText = "Usage: /persona <text> [color]\nExample: /persona debugging red";

      if (isHeadless) {
        console.log(helpText);
      } else {
        const helpEntry: ChatEntry = {
          type: "assistant",
          content: helpText,
          timestamp: new Date(),
        };
        addChatEntry(helpEntry);
        if (clearInput) clearInput();
      }

      return true;
    }

    const persona = parts[1];
    const color = parts[2];
    const result = await agent.setPersona(persona, color);

    const confirmText = result.success
      ? `Persona set to: ${persona}${color ? ` (${color})` : ''}`
      : `Failed to set persona: ${result.error || 'Unknown error'}`;

    if (isHeadless) {
      console.log(confirmText);
    } else {
      const confirmEntry: ChatEntry = {
        type: "assistant",
        content: confirmText,
        timestamp: new Date(),
      };
      addChatEntry(confirmEntry);
      if (clearInput) clearInput();
    }

    return true;
  }

  // /mood command
  if (trimmedInput.startsWith("/mood")) {
    const parts = trimmedInput.split(" ");
    if (parts.length < 2) {
      const helpText = "Usage: /mood <text> [color]\nExample: /mood focused green";

      if (isHeadless) {
        console.log(helpText);
      } else {
        const helpEntry: ChatEntry = {
          type: "assistant",
          content: helpText,
          timestamp: new Date(),
        };
        addChatEntry(helpEntry);
        if (clearInput) clearInput();
      }

      return true;
    }

    const mood = parts[1];
    const color = parts[2];
    const result = await agent.setMood(mood, color);

    const confirmText = result.success
      ? `Mood set to: ${mood}${color ? ` (${color})` : ''}`
      : `Failed to set mood: ${result.error || 'Unknown error'}`;

    if (isHeadless) {
      console.log(confirmText);
    } else {
      const confirmEntry: ChatEntry = {
        type: "assistant",
        content: confirmText,
        timestamp: new Date(),
      };
      addChatEntry(confirmEntry);
      if (clearInput) clearInput();
    }

    return true;
  }

  // /models command - interactive selection not supported in headless
  if (trimmedInput === "/models") {
    if (isHeadless) {
      console.error("ERROR: /models requires interactive mode or use /models <model-name>");
      return true;
    }
    // Let UI handler show the interactive menu
    return false;
  }

  // /models <model> command with argument
  if (trimmedInput.startsWith("/models ")) {
    const modelArg = trimmedInput.split(" ")[1];
    const { loadModelConfig } = await import("./model-config.js");
    const availableModels = loadModelConfig();
    const modelNames = availableModels.map((m) => m.model);

    if (modelNames.includes(modelArg)) {
      agent.setModel(modelArg);

      // Update project current model if not headless
      if (!isHeadless) {
        const { updateCurrentModel } = await import("./model-config.js");
        updateCurrentModel(modelArg);
      }

      const confirmText = `✓ Switched to model: ${modelArg}`;

      if (isHeadless) {
        console.log(confirmText);
      } else {
        const confirmEntry: ChatEntry = {
          type: "assistant",
          content: confirmText,
          timestamp: new Date(),
        };
        addChatEntry(confirmEntry);
        if (clearInput) clearInput();
      }
    } else {
      const errorText = `Invalid model: ${modelArg}\n\nAvailable models: ${modelNames.join(", ")}`;

      if (isHeadless) {
        console.error(errorText);
      } else {
        const errorEntry: ChatEntry = {
          type: "assistant",
          content: errorText,
          timestamp: new Date(),
        };
        addChatEntry(errorEntry);
        if (clearInput) clearInput();
      }
    }

    return true;
  }

  // /commit-and-push command - not well suited for headless but let it through
  if (trimmedInput === "/commit-and-push") {
    if (isHeadless) {
      console.error("ERROR: /commit-and-push not supported in headless mode");
      return true;
    }
    // Let UI handler deal with the streaming response
    return false;
  }

  // Not a recognized slash command
  return false;
}
