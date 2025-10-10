import { GrokTool } from "./client.js";
import { MCPManager, MCPTool } from "../mcp/client.js";
import { loadMCPConfig } from "../mcp/config.js";
import fs from "fs";

const BASE_GROK_TOOLS: GrokTool[] = [
  {
    type: "function",
    function: {
      name: "viewFile",
      description: "View contents of a file or list directory contents",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to file or directory to view",
          },
          start_line: {
            type: "number",
            description:
              "Starting line number for partial file view (optional)",
          },
          end_line: {
            type: "number",
            description: "Ending line number for partial file view (optional)",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createNewFile",
      description: "Create a new file with specified content",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path where the file should be created",
          },
          content: {
            type: "string",
            description: "Content to write to the file",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "strReplace",
      description: "Replace specific text in a file. Use this for single line edits only",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file to edit",
          },
          old_str: {
            type: "string",
            description:
              "Text to replace (must match exactly, or will use fuzzy matching for multi-line strings)",
          },
          new_str: {
            type: "string",
            description: "Text to replace with",
          },
          replace_all: {
            type: "boolean",
            description:
              "Replace all occurrences (default: false, only replaces first occurrence)",
          },
        },
        required: ["path", "old_str", "new_str"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "execute",
      description: "Execute a zsh command",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The zsh command to execute",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listFiles",
      description: "List files in a directory (equivalent to 'ls -la')",
      parameters: {
        type: "object",
        properties: {
          directory: {
            type: "string",
            description: "Directory to list files from (default: current directory)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "universalSearch",
      description:
        "Unified search tool for finding text content or files (similar to Cursor's search)",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Text to search for or file name/path pattern",
          },
          search_type: {
            type: "string",
            enum: ["text", "files", "both"],
            description:
              "Type of search: 'text' for content search, 'files' for file names, 'both' for both (default: 'both')",
          },
          include_pattern: {
            type: "string",
            description:
              "Glob pattern for files to include (e.g. '*.ts', '*.js')",
          },
          exclude_pattern: {
            type: "string",
            description:
              "Glob pattern for files to exclude (e.g. '*.log', 'node_modules')",
          },
          case_sensitive: {
            type: "boolean",
            description:
              "Whether search should be case sensitive (default: false)",
          },
          whole_word: {
            type: "boolean",
            description: "Whether to match whole words only (default: false)",
          },
          regex: {
            type: "boolean",
            description: "Whether query is a regex pattern (default: false)",
          },
          max_results: {
            type: "number",
            description: "Maximum number of results to return (default: 50)",
          },
          file_types: {
            type: "array",
            items: { type: "string" },
            description: "File types to search (e.g. ['js', 'ts', 'py'])",
          },
          include_hidden: {
            type: "boolean",
            description: "Whether to include hidden files (default: false)",
          },
        },
        required: ["query"],
      },
    },
  },
  // {
  //   type: "function",
  //   function: {
  //     name: "createTodoList",
  //     description: "Create a new todo list for planning and tracking tasks",
  //     parameters: {
  //       type: "object",
  //       properties: {
  //         todos: {
  //           type: "array",
  //           description: "Array of todo items",
  //           items: {
  //             type: "object",
  //             properties: {
  //               id: {
  //                 type: "string",
  //                 description: "Unique identifier for the todo item",
  //               },
  //               content: {
  //                 type: "string",
  //                 description: "Description of the todo item",
  //               },
  //               status: {
  //                 type: "string",
  //                 enum: ["pending", "in_progress", "completed"],
  //                 description: "Current status of the todo item",
  //               },
  //               priority: {
  //                 type: "string",
  //                 enum: ["high", "medium", "low"],
  //                 description: "Priority level of the todo item",
  //               },
  //             },
  //             required: ["id", "content", "status", "priority"],
  //           },
  //         },
  //       },
  //       required: ["todos"],
  //     },
  //   },
  // },
  // {
  //   type: "function",
  //   function: {
  //     name: "updateTodoList",
  //     description: "Update existing todos in the todo list",
  //     parameters: {
  //       type: "object",
  //       properties: {
  //         updates: {
  //           type: "array",
  //           description: "Array of todo updates",
  //           items: {
  //             type: "object",
  //             properties: {
  //               id: {
  //                 type: "string",
  //                 description: "ID of the todo item to update",
  //               },
  //               status: {
  //                 type: "string",
  //                   enum: ["pending", "in_progress", "completed"],
  //                 description: "New status for the todo item",
  //               },
  //               content: {
  //                 type: "string",
  //                 description: "New content for the todo item",
  //               },
  //               priority: {
  //                 type: "string",
  //                 enum: ["high", "medium", "low"],
  //                 description: "New priority for the todo item",
  //               },
  //             },
  //             required: ["id"],
  //           },
  //         },
  //       },
  //       required: ["updates"],
  //     },
  //   },
  // },
  {
    type: "function",
    function: {
      name: "getEnv",
      description: "Get a specific environment variable",
      parameters: {
        type: "object",
        properties: {
          variable: {
            type: "string",
            description: "Name of environment variable to get",
          },
        },
        required: ["variable"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getAllEnv",
      description: "Get all environment variables",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "searchEnv",
      description: "Search environment variables by pattern",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Pattern to search for in variable names or values",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "introspect",
      description: "Introspect available tools and system information",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "What to introspect. Available: 'tools' - list all available tools (internal and MCP), 'env' - show ZDS_AI_AGENT_* environment variables, 'context' - show context/token usage, 'all' - show all introspection data",
            enum: ["tools", "env", "context", "all"],
          },
        },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clearCache",
      description: "Clear the conversation cache/context and reset to initial state. Requires a two-step confirmation process to ensure notes are saved first. First call generates a confirmation code. Second call with the code clears the cache.",
      parameters: {
        type: "object",
        properties: {
          confirmationCode: {
            type: "string",
            description: "The confirmation code provided in the first call (6-letter code). Leave empty for initial call.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "setPersona",
      description: "Set status bar persona text",
      parameters: {
        type: "object",
        properties: {
          persona: {
            type: "string",
            description: "The persona text to display (e.g., 'Debugging Mode', 'Code Review', 'Planning')",
          },
          color: {
            type: "string",
            description: "Optional color for the text (e.g., 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', '#FF5733', etc.)",
          },
        },
        required: ["persona"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "setMood",
      description: "Set status bar mood text",
      parameters: {
        type: "object",
        properties: {
          mood: {
            type: "string",
            description: "The mood text to display (e.g., 'focused', 'tired', 'excited')",
          },
          color: {
            type: "string",
            description: "Optional color for the text (e.g., 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', '#FF5733', etc.)",
          },
        },
        required: ["mood"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "startActiveTask",
      description: "Start a new active task",
      parameters: {
        type: "object",
        properties: {
          activeTask: {
            type: "string",
            description: "The task description (e.g., 'fix bug in parser', 'implement feature X', 'chatting')",
          },
          action: {
            type: "string",
            description: "Required action describing what you're doing (e.g., 'coding', 'testing', 'researching', 'planning')",
          },
          color: {
            type: "string",
            description: "Optional color for the text (e.g., 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', '#FF5733', etc.)",
          },
        },
        required: ["activeTask", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "transitionActiveTaskStatus",
      description: "Change active task status or action",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "New action/status (e.g., 'coding', 'testing', 'blocked', 'error', 'finished')",
          },
          color: {
            type: "string",
            description: "Optional color for the text (e.g., 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', '#FF5733', etc.)",
          },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stopActiveTask",
      description: "Stop the current active task",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Reason for stopping (e.g., 'finished', 'blocked', 'error', 'preempted')",
          },
          documentationFile: {
            type: "string",
            description: "Path to documentation file (.md or .txt) proving progress was documented. File must have been modified recently.",
          },
          color: {
            type: "string",
            description: "Optional color for the text (e.g., 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', '#FF5733', etc.)",
          },
        },
        required: ["reason", "documentationFile"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "insertLines",
      description: "Insert text at a specific line in a file",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file to edit",
          },
          insert_line: {
            type: "number",
            description: "Line number to insert at",
          },
          new_str: {
            type: "string",
            description: "Text to insert",
          },
        },
        required: ["path", "insert_line", "new_str"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replaceLines",
      description: "Replace a range of lines in a file",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file to edit",
          },
          start_line: {
            type: "number",
            description: "Starting line number",
          },
          end_line: {
            type: "number",
            description: "Ending line number",
          },
          new_str: {
            type: "string",
            description: "Replacement text",
          },
        },
        required: ["path", "start_line", "end_line", "new_str"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "undoEdit",
      description: "Undo the last edit operation",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  // {
  //   type: "function",
  //   function: {
  //     name: "viewTodoList",
  //     description: "View the current todo list",
  //     parameters: {
  //       type: "object",
  //       properties: {},
  //       required: [],
  //     },
  //   },
  // },
  {
    type: "function",
    function: {
      name: "chdir",
      description: "Change the current working directory",
      parameters: {
        type: "object",
        properties: {
          directory: {
            type: "string",
            description: "Directory path to change to",
          },
        },
        required: ["directory"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pwdir",
      description: "Show the current working directory",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

// Morph Fast Apply tool (conditional)
const MORPH_EDIT_TOOL: GrokTool = {
  type: "function",
  function: {
    name: "editFile",
    description: "Use this tool to make an edit to an existing file.\n\nThis will be read by a less intelligent model, which will quickly apply the edit. You should make it clear what the edit is, while also minimizing the unchanged code you write.\nWhen writing the edit, you should specify each edit in sequence, with the special comment // ... existing code ... to represent unchanged code in between edited lines.\n\nFor example:\n\n// ... existing code ...\nFIRST_EDIT\n// ... existing code ...\nSECOND_EDIT\n// ... existing code ...\nTHIRD_EDIT\n// ... existing code ...\n\nYou should still bias towards repeating as few lines of the original file as possible to convey the change.\nBut, each edit should contain sufficient context of unchanged lines around the code you're editing to resolve ambiguity.\nDO NOT omit spans of pre-existing code (or comments) without using the // ... existing code ... comment to indicate its absence. If you omit the existing code comment, the model may inadvertently delete these lines.\nIf you plan on deleting a section, you must provide context before and after to delete it. If the initial code is ```code \\n Block 1 \\n Block 2 \\n Block 3 \\n code```, and you want to remove Block 2, you would output ```// ... existing code ... \\n Block 1 \\n  Block 3 \\n // ... existing code ...```.\nMake sure it is clear what the edit should be, and where it should be applied.\nMake edits to a file in a single edit_file call instead of multiple edit_file calls to the same file. The apply model can handle many distinct edits at once.",
    parameters: {
      type: "object",
      properties: {
        target_file: {
          type: "string",
          description: "The target file to modify."
        },
        instructions: {
          type: "string",
          description: "A single sentence instruction describing what you are going to do for the sketched edit. This is used to assist the less intelligent model in applying the edit. Use the first person to describe what you are going to do. Use it to disambiguate uncertainty in the edit."
        },
        code_edit: {
          type: "string",
          description: "Specify ONLY the precise lines of code that you wish to edit. NEVER specify or write out unchanged code. Instead, represent all unchanged code using the comment of the language you're editing in - example: // ... existing code ..."
        }
      },
      required: ["target_file", "instructions", "code_edit"]
    }
  }
};

// Function to build tools array conditionally
function buildGrokTools(): GrokTool[] {
  const tools = [...BASE_GROK_TOOLS];

  // Add Morph Fast Apply tool if API key is available
  if (process.env.MORPH_API_KEY) {
    tools.splice(3, 0, MORPH_EDIT_TOOL); // Insert after str_replace_editor
  }

  return tools;
}

// Export dynamic tools array
export const GROK_TOOLS: GrokTool[] = buildGrokTools();

// Global MCP manager instance
let mcpManager: MCPManager | null = null;

export function getMCPManager(): MCPManager {
  if (!mcpManager) {
    mcpManager = new MCPManager();
  }
  return mcpManager;
}

export async function initializeMCPServers(debugLogFile?: string): Promise<void> {
  const manager = getMCPManager();
  const config = loadMCPConfig();

  // Pass debug log file to manager for per-server stream redirection
  if (debugLogFile) {
    manager.setDebugLogFile(debugLogFile);
  }

  for (const serverConfig of config.servers) {
    try {
      await manager.addServer(serverConfig);
    } catch (error) {
      // Only log to debug file if configured, otherwise suppress
      if (debugLogFile) {
        const fs = await import('fs');
        const message = `Failed to initialize MCP server ${serverConfig.name}: ${error}\n`;
        fs.appendFileSync(debugLogFile, message);
      }
      // Silently ignore initialization failures
    }
  }
}

export function convertMCPToolToGrokTool(mcpTool: MCPTool): GrokTool {
  // Normalize schema to ensure OpenAI compatibility
  let parameters = mcpTool.inputSchema || {
    type: "object",
    properties: {},
    required: []
  };

  // OpenAI requires objects to have properties field
  if (parameters.type === "object" && !parameters.properties) {
    parameters = {
      ...parameters,
      properties: {}
    };
  }

  return {
    type: "function",
    function: {
      name: mcpTool.name,
      description: mcpTool.description,
      parameters
    }
  };
}

export function addMCPToolsToGrokTools(baseTools: GrokTool[]): GrokTool[] {
  if (!mcpManager) {
    
    fs.appendFileSync('/tmp/grok-api-tools.log', `${new Date().toISOString()} - addMCPToolsToGrokTools: mcpManager is null\n`);
    return baseTools;
  }

  const mcpTools = mcpManager.getTools();
  
  fs.appendFileSync('/tmp/grok-api-tools.log', `${new Date().toISOString()} - addMCPToolsToGrokTools: ${mcpTools.length} MCP tools from manager\n`);
  const grokMCPTools = mcpTools.map(convertMCPToolToGrokTool);

  return [...baseTools, ...grokMCPTools];
}

export async function getAllGrokTools(): Promise<GrokTool[]> {
  const manager = getMCPManager();
  // Try to initialize servers if not already done, but don't block
  manager.ensureServersInitialized().catch(() => {
    // Ignore initialization errors to avoid blocking
  });
  return addMCPToolsToGrokTools(GROK_TOOLS);
}
