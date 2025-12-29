import { exec } from "child_process";
import { promisify } from "util";
import { ToolResult } from "../types/index.js";
import { ToolDiscovery, getHandledToolNames } from "./tool-discovery.js";
import type { LLMAgent } from "../agent/llm-agent";
// import type { StreamingLLMAgent } from "../agent/streaming-agent";

const execAsync = promisify(exec);

export class AudioTool implements ToolDiscovery {
  private agent: LLMAgent; // Reference to the LLMAgent

  setAgent(agent: LLMAgent) {
    this.agent = agent;
  }

  getHandledToolNames(): string[] {
    return getHandledToolNames(this);
  }

  /**
   * Extract text from audio files using speech-to-text (STT) transcription.
   * Uses extract-text-from-audio.sh script with OpenAI Whisper or similar.
   */
  async extractTextFromAudio(
    filename: string
  ): Promise<ToolResult> {
    try {
      // Execute audio transcription
      const command = `extract-text.sh "${filename}"`;
      const { stdout, stderr } = await execAsync(command, {
        timeout: 60000, // 60 second timeout for audio transcription
        shell: '/bin/zsh'
      });

      // Clean up output
      const extractedText = stdout.trim();
      const lineCount = extractedText.split('\n').length;
      const wordCount = extractedText.split(/\s+/).filter(word => word.length > 0).length;

      return {
        success: true,
        output: extractedText,
        displayOutput: `Audio transcription complete (${wordCount} words, ${lineCount} lines)`,
        data: {
          file: filename,
          textLength: extractedText.length,
          wordCount: wordCount,
          lineCount: lineCount
        }
      };

    } catch (error: any) {
      // Extract error details
      const errorMessage = error.message || "Unknown error";
      const stderr = error.stderr || "";
      const stdout = error.stdout || "";

      return {
        success: false,
        error: `Audio transcription failed (code ${error.code || 'unknown'}): ${errorMessage}${stderr ? '\nstderr: ' + stderr : ''}${stdout ? '\nstdout: ' + stdout : ''}`,
        output: `Error code: ${error.code || 'unknown'}\n${errorMessage}${stderr ? '\nstderr: ' + stderr : ''}${stdout ? '\nstdout: ' + stdout : ''}`
      };
    }
  }
}
