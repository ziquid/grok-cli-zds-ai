#!/usr/bin/env bun

import React from "react";
import { render } from "ink";
import { program } from "commander";
import * as dotenv from "dotenv";
import { GrokAgent } from "./agent/grok-agent";
import ChatInterface from "./ui/components/chat-interface";
import { getSettingsManager } from "./utils/settings-manager";
import { ConfirmationService } from "./utils/confirmation-service";
import { ChatHistoryManager } from "./utils/chat-history-manager";
import { createMCPCommand } from "./commands/mcp";
import type { ChatCompletionMessageParam } from "openai/resources/chat";

// Load environment variables
dotenv.config();

// Disable default SIGINT handling to let Ink handle Ctrl+C
// We'll handle exit through the input system instead

process.on("SIGTERM", () => {
  // Restore terminal to normal mode before exit
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    try {
      process.stdin.setRawMode(false);
    } catch (e) {
      // Ignore errors when setting raw mode
    }
  }
  console.log("\nGracefully shutting down...");
  process.exit(0);
});

// Handle uncaught exceptions to prevent hanging
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Ensure user settings are initialized
function ensureUserSettingsDirectory(): void {
  try {
    const manager = getSettingsManager();
    // This will create default settings if they don't exist
    manager.loadUserSettings();
  } catch (error) {
    // Silently ignore errors during setup
  }
}

// Load API key from user settings if not in environment
function loadApiKey(): string | undefined {
  const manager = getSettingsManager();
  return manager.getApiKey();
}

// Load base URL from user settings if not in environment
function loadBaseURL(): string {
  const manager = getSettingsManager();
  return manager.getBaseURL();
}

// Save command line API key to user settings file (baseURL is not saved - it's for override only)
async function saveCommandLineSettings(
  apiKey?: string
): Promise<void> {
  try {
    const manager = getSettingsManager();

    // Update with command line values
    if (apiKey) {
      manager.updateUserSetting("apiKey", apiKey);
      console.log("✅ API key saved to ~/.grok/user-settings.json");
    }
  } catch (error) {
    console.warn(
      "⚠️ Could not save settings to file:",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

// Load model from user settings if not in environment
function loadModel(): string | undefined {
  // First check environment variables
  let model = process.env.GROK_MODEL;

  if (!model) {
    // Use the unified model loading from settings manager
    try {
      const manager = getSettingsManager();
      model = manager.getCurrentModel();
    } catch (error) {
      // Ignore errors, model will remain undefined
    }
  }

  return model;
}

// Handle commit-and-push command in headless mode
async function handleCommitAndPushHeadless(
  apiKey: string,
  baseURL?: string,
  model?: string,
  maxToolRounds?: number
): Promise<void> {
  try {
    const agent = new GrokAgent(apiKey, baseURL, model, maxToolRounds);

    // Configure confirmation service for headless mode (auto-approve all operations)
    const confirmationService = ConfirmationService.getInstance();
    confirmationService.setSessionFlag("allOperations", true);

    console.log("🤖 Processing commit and push...\n");
    console.log("> /commit-and-push\n");

    // First check if there are any changes at all
    const initialStatusResult = await agent.executeBashCommand(
      "git status --porcelain"
    );

    if (!initialStatusResult.success || !initialStatusResult.output?.trim()) {
      console.log("❌ No changes to commit. Working directory is clean.");
      process.exit(1);
    }

    console.log("✅ git status: Changes detected");

    // Add all changes
    const addResult = await agent.executeBashCommand("git add .");

    if (!addResult.success) {
      console.log(
        `❌ git add: ${addResult.error || "Failed to stage changes"}`
      );
      process.exit(1);
    }

    console.log("✅ git add: Changes staged");

    // Get staged changes for commit message generation
    const diffResult = await agent.executeBashCommand("git diff --cached");

    // Generate commit message using AI
    const commitPrompt = `Generate a concise, professional git commit message for these changes:

Git Status:
${initialStatusResult.output}

Git Diff (staged changes):
${diffResult.output || "No staged changes shown"}

Follow conventional commit format (feat:, fix:, docs:, etc.) and keep it under 72 characters.
Respond with ONLY the commit message, no additional text.`;

    console.log("🤖 Generating commit message...");

    const commitMessageEntries = await agent.processUserMessage(commitPrompt);
    let commitMessage = "";

    // Extract the commit message from the AI response
    for (const entry of commitMessageEntries) {
      if (entry.type === "assistant" && entry.content.trim()) {
        commitMessage = entry.content.trim();
        break;
      }
    }

    if (!commitMessage) {
      console.log("❌ Failed to generate commit message");
      process.exit(1);
    }

    // Clean the commit message
    const cleanCommitMessage = commitMessage.replace(/^["']|["']$/g, "");
    console.log(`✅ Generated commit message: "${cleanCommitMessage}"`);

    // Execute the commit
    const commitCommand = `git commit -m "${cleanCommitMessage}"`;
    const commitResult = await agent.executeBashCommand(commitCommand);

    if (commitResult.success) {
      console.log(
        `✅ git commit: ${
          commitResult.output?.split("\n")[0] || "Commit successful"
        }`
      );

      // If commit was successful, push to remote
      // First try regular push, if it fails try with upstream setup
      let pushResult = await agent.executeBashCommand("git push");

      if (
        !pushResult.success &&
        pushResult.error?.includes("no upstream branch")
      ) {
        console.log("🔄 Setting upstream and pushing...");
        pushResult = await agent.executeBashCommand("git push -u origin HEAD");
      }

      if (pushResult.success) {
        console.log(
          `✅ git push: ${
            pushResult.output?.split("\n")[0] || "Push successful"
          }`
        );
      } else {
        console.log(`❌ git push: ${pushResult.error || "Push failed"}`);
        process.exit(1);
      }
    } else {
      console.log(`❌ git commit: ${commitResult.error || "Commit failed"}`);
      process.exit(1);
    }
  } catch (error: any) {
    console.error("❌ Error during commit and push:", error.message);
    process.exit(1);
  }
}

// Headless mode processing function
async function processPromptHeadless(
  prompt: string,
  apiKey: string,
  baseURL?: string,
  model?: string,
  maxToolRounds?: number,
  fresh?: boolean
): Promise<void> {
  try {
    const agent = new GrokAgent(apiKey, baseURL, model, maxToolRounds);

    // Configure confirmation service for headless mode (auto-approve all operations)
    const confirmationService = ConfirmationService.getInstance();
    confirmationService.setSessionFlag("allOperations", true);

    // Load existing chat history unless fresh session
    if (!fresh) {
      const { ChatHistoryManager } = await import("./utils/chat-history-manager");
      const historyManager = ChatHistoryManager.getInstance();
      const existingHistory = historyManager.loadHistory();
      agent.loadInitialHistory(existingHistory);
    }

    // Process the user message
    const chatEntries = await agent.processUserMessage(prompt);

    // Find the final assistant response (last assistant message)
    let finalResponse = "";
    for (let i = chatEntries.length - 1; i >= 0; i--) {
      const entry = chatEntries[i];
      if (entry.type === "assistant" && entry.content.trim()) {
        finalResponse = entry.content;
        break;
      }
    }

    // Save updated chat history
    const { ChatHistoryManager } = await import("./utils/chat-history-manager");
    const historyManager = ChatHistoryManager.getInstance();
    const currentHistory = agent.getChatHistory();
    historyManager.saveHistory(currentHistory);

    // Output the final assistant response content
    console.log(finalResponse);
  } catch (error: any) {
    // Output error as plain text
    console.log(`Error: ${error.message}`);
    process.exit(1);
  }
}

program
  .name("grok")
  .description(
    "A conversational AI CLI tool powered by Grok with text editor capabilities"
  )
  .version("1.0.1")
  .argument("[message...]", "Initial message to send to Grok")
  .option("-d, --directory <dir>", "set working directory", process.cwd())
  .option("-k, --api-key <key>", "Grok API key (or set GROK_API_KEY env var)")
  .option(
    "-u, --base-url <url>",
    "Grok API base URL (or set GROK_BASE_URL env var)"
  )
  .option(
    "-m, --model <model>",
    "AI model to use (e.g., grok-code-fast-1, grok-4-latest) (or set GROK_MODEL env var)"
  )
  .option(
    "-p, --prompt [prompt]",
    "process a single prompt and exit (headless mode). If no prompt provided, reads from stdin"
  )
  .option(
    "--max-tool-rounds <rounds>",
    "maximum number of tool execution rounds (default: 400)",
    "400"
  )
  .option(
    "--fresh",
    "start with a fresh session (don't load previous chat history)"
  )
  .option(
    "--auto-approve",
    "auto-approve all operations without confirmation prompts"
  )
  .option(
    "-c, --context <file>",
    "path to context persistence file (default: ~/.grok/chat-history.json)"
  )
  .option(
    '--no-ink',
    'disable Ink UI and use plain console input/output'
  )
  .action(async (message, options) => {
    if (options.directory) {
      try {
        process.chdir(options.directory);
      } catch (error: any) {
        console.error(
          `Error changing directory to ${options.directory}:`,
          error.message
        );
        process.exit(1);
      }
    }

    try {
      // Get API key from options, environment, or user settings
      const apiKey = options.apiKey || loadApiKey();
      const baseURL = options.baseUrl || loadBaseURL();
      const model = options.model || loadModel();
      const maxToolRounds = parseInt(options.maxToolRounds) || 400;

      if (!apiKey) {
        console.error(
          "❌ Error: API key required. Set GROK_API_KEY environment variable, use --api-key flag, or save to ~/.grok/user-settings.json"
        );
        process.exit(1);
      }

      // Save API key to user settings if provided via command line (baseURL is override only)
      if (options.apiKey) {
        await saveCommandLineSettings(options.apiKey);
      }

      // Common initialization for both modes
      const agent = new GrokAgent(apiKey, baseURL, model, maxToolRounds);

      // Configure confirmation service if auto-approve is enabled
      if (options.autoApprove) {
        const confirmationService = ConfirmationService.getInstance();
        confirmationService.setSessionFlag("allOperations", true);
      }

      ensureUserSettingsDirectory();

      // Set custom context file path if provided
      if (options.context) {
        const { ChatHistoryManager } = await import("./utils/chat-history-manager");
        ChatHistoryManager.setCustomHistoryPath(options.context);
      }

      // Headless mode: process prompt and exit
      if (options.prompt !== undefined) {
        let prompt = options.prompt;

        // If prompt is empty or just whitespace, read from stdin
        if (!prompt || !prompt.trim()) {
          const stdinData = await new Promise<string>((resolve, reject) => {
            let data = '';
            process.stdin.on('data', (chunk) => {
              data += chunk;
            });
            process.stdin.on('end', () => {
              resolve(data);
            });
            process.stdin.on('error', (err) => {
              reject(err);
            });
          });
          prompt = stdinData.trim();
        }

        if (!prompt) {
          console.error("Error: No prompt provided via argument or stdin");
          process.exit(1);
        }

        await processPromptHeadless(
          prompt,
          apiKey,
          baseURL,
          model,
          maxToolRounds,
          options.fresh
        );
        return;
      }

      // Interactive mode: launch UI

      // Clear terminal screen if fresh session is requested
      if (options.fresh) {
        process.stdout.write('\x1b[2J\x1b[0f');
      }

      console.log("🤖 Starting Grok CLI Conversational Assistant...\n");

      // Support variadic positional arguments for multi-word initial message
      const initialMessage = Array.isArray(message)
        ? message.join(" ")
        : message;

      if (!options.ink) {
        // Plain console mode
        const prompts = await import('prompts');

        // Process initial message if provided
        if (initialMessage) {
          console.log(`> ${initialMessage}`);

          try {

            for await (const chunk of agent.processUserMessageStream(initialMessage)) {
              switch (chunk.type) {
                case 'content':
                  if (chunk.content) {
                    process.stdout.write(chunk.content);
                  }
                  break;
                case 'tool_calls':
                  if (chunk.toolCalls) {
                    chunk.toolCalls.forEach(toolCall => {
                      console.log(`\n🔧 ${toolCall.function.name}...`);
                    });
                  }
                  break;
                case 'tool_result':
                  // Tool results are usually not shown to user, just processed
                  break;
                case 'done':
                  console.log(); // Add newline after response
                  break;
              }
            }
          } catch (error) {
            console.log('DEBUG: Error in streaming:', error);
          }
        }

        // Interactive loop
        while (true) {
          try {
            // Write our own prompt without symbols
            process.stdout.write('> ');

            const result = await prompts.default({
              type: 'text',
              name: 'input',
              message: '',
              initial: ''
            }, {
              onCancel: () => process.exit(0)
            });

            if (result.input === undefined) {
              break;
            }

            if (!result.input) {
              if (process.stdin.isTTY) {
                // Blank line: treat as 'continue'
                result.input = 'continue';
              } else {
                continue;
              }
            }

            const input = result.input.trim();
            if (input === 'exit' || input === 'quit') {
              console.log('👋 Goodbye!');
              process.exit(0);
            }

            if (input) {
              for await (const chunk of agent.processUserMessageStream(input)) {
                switch (chunk.type) {
                  case 'content':
                    if (chunk.content) {
                      process.stdout.write(chunk.content);
                    }
                    break;
                  case 'tool_calls':
                    if (chunk.toolCalls) {
                      chunk.toolCalls.forEach(toolCall => {
                        console.log(`\n🔧 ${toolCall.function.name}...`);
                      });
                    }
                    break;
                  case 'tool_result':
                    // Tool results are usually not shown to user, just processed
                    break;
                  case 'done':
                    console.log(); // Add newline after response
                    break;
                }
              }
            }
          } catch (error) {
            // Handle Ctrl+C or other interruptions
            console.log('\n👋 Goodbye!');
            process.exit(0);
          }
        }
      }

      render(React.createElement(ChatInterface, {
        agent,
        initialMessage,
        fresh: options.fresh
      }));
    } catch (error: any) {
      console.error("❌ Error initializing Grok CLI:", error.message);
      process.exit(1);
    }
  });

// Git subcommand
const gitCommand = program
  .command("git")
  .description("Git operations with AI assistance");

gitCommand
  .command("commit-and-push")
  .description("Generate AI commit message and push to remote")
  .option("-d, --directory <dir>", "set working directory", process.cwd())
  .option("-k, --api-key <key>", "Grok API key (or set GROK_API_KEY env var)")
  .option(
    "-u, --base-url <url>",
    "Grok API base URL (or set GROK_BASE_URL env var)"
  )
  .option(
    "-m, --model <model>",
    "AI model to use (e.g., grok-code-fast-1, grok-4-latest) (or set GROK_MODEL env var)"
  )
  .option(
    "--max-tool-rounds <rounds>",
    "maximum number of tool execution rounds (default: 400)",
    "400"
  )
  .action(async (options) => {
    if (options.directory) {
      try {
        process.chdir(options.directory);
      } catch (error: any) {
        console.error(
          `Error changing directory to ${options.directory}:`,
          error.message
        );
        process.exit(1);
      }
    }

    try {
      // Get API key from options, environment, or user settings
      const apiKey = options.apiKey || loadApiKey();
      const baseURL = options.baseUrl || loadBaseURL();
      const model = options.model || loadModel();
      const maxToolRounds = parseInt(options.maxToolRounds) || 400;

      if (!apiKey) {
        console.error(
          "❌ Error: API key required. Set GROK_API_KEY environment variable, use --api-key flag, or save to ~/.grok/user-settings.json"
        );
        process.exit(1);
      }

      // Save API key to user settings if provided via command line (baseURL is override only)
      if (options.apiKey) {
        await saveCommandLineSettings(options.apiKey);
      }

      await handleCommitAndPushHeadless(apiKey, baseURL, model, maxToolRounds);
    } catch (error: any) {
      console.error("❌ Error during commit and push:", error.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
