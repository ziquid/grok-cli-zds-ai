#!/usr/bin/env node

import React from "react";
import { render } from "ink";
import { program } from "commander";
import * as dotenv from "dotenv";
import { GrokAgent } from "./agent/grok-agent";
import ChatInterface from "./ui/components/chat-interface";

// Load environment variables
dotenv.config();

program
  .name("grok")
  .description(
    "A conversational AI CLI tool powered by Grok-3 with text editor capabilities"
  )
  .version("1.0.0")
  .option("-d, --directory <dir>", "set working directory", process.cwd())
  .option("-k, --api-key <key>", "Grok API key (or set GROK_API_KEY env var)")
  .action((options) => {
    // Get API key from options or environment
    const apiKey = options.apiKey || process.env.GROK_API_KEY;

    if (!apiKey) {
      console.error("❌ Error: Grok API key is required");
      console.error(
        "   Set GROK_API_KEY environment variable or use --api-key option"
      );
      console.error("   Copy .env.example to .env and add your API key");
      process.exit(1);
    }

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
      const agent = new GrokAgent(apiKey);

      console.log("🤖 Starting Grok CLI Conversational Assistant...\n");

      render(React.createElement(ChatInterface, { agent }));
    } catch (error: any) {
      console.error("❌ Error initializing Grok CLI:", error.message);
      process.exit(1);
    }
  });

program.parse();
