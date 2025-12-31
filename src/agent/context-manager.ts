import { ChatEntry } from "./llm-agent.js";
import { TokenCounter } from "../utils/token-counter.js";
import { LLMMessage } from "../grok/client.js";

/**
 * Dependencies required by ContextManager for managing conversation context
 */
export interface ContextManagerDependencies {
  /** Chat history entries for display */
  chatHistory: ChatEntry[];
  /** LLM API messages array */
  messages: LLMMessage[];
  /** Token counter instance */
  tokenCounter: TokenCounter;
  /** Get current token count */
  getCurrentTokenCount: () => number;
  /** Get maximum context size */
  getMaxContextSize: () => number;
  /** Emit events */
  emit: (event: string, data: any) => void;
  /** Clear cache when context limit reached */
  clearCache: () => Promise<void>;
}

/**
 * Manages conversation context size, warnings, and compaction
 * 
 * Handles:
 * - Context usage monitoring and warnings
 * - Automatic cache clearing at 100% capacity
 * - Context compaction when size limits exceeded
 * - Event emission for context changes
 */
export class ContextManager {
  /** Warning flag for 80% context usage (one-time) */
  private contextWarningAt80: boolean = false;
  /** Warning flag for 90% context usage (one-time) */
  private contextWarningAt90: boolean = false;

  constructor(private deps: ContextManagerDependencies) {}

  /**
   * Emit context change event and add warnings if needed
   * Called after message additions to monitor context usage
   */
  async emitContextChange(): Promise<void> {
    const percent = this.getContextUsagePercent();

    this.deps.emit('contextChange', {
      current: this.deps.getCurrentTokenCount(),
      max: this.deps.getMaxContextSize(),
      percent
    });

    await this.addContextWarningIfNeeded(percent);
  }

  /**
   * Add system warnings based on context usage percentage
   * - 80%: Initial warning (one-time)
   * - 90%: Urgent warning (one-time) 
   * - 95%: Critical warning (every time)
   * - 100%: Auto-clear cache
   */
  private async addContextWarningIfNeeded(percent: number): Promise<void> {
    let warning: string | null = null;
    const roundedPercent = Math.round(percent);

    if (percent >= 100) {
      warning = `CONTEXT LIMIT REACHED: You are at ${roundedPercent}% context capacity!  Automatically clearing cache to prevent context overflow...`;
      this.deps.messages.push({
        role: 'system',
        content: warning
      });
      await this.deps.clearCache();
      return;
    }

    if (percent >= 95) {
      warning = `CRITICAL CONTEXT WARNING: You are at ${roundedPercent}% context capacity!  You MUST immediately save any notes and lessons learned, then run the 'clearCache' tool to reset the conversation context.  The conversation will fail if you do not take action now.`;
    } else if (percent >= 90 && !this.contextWarningAt90) {
      this.contextWarningAt90 = true;
      warning = `URGENT CONTEXT WARNING: You are at ${roundedPercent}% context capacity!  Perform your final tasks or responses and prepare to be reset.`;
    } else if (percent >= 80 && !this.contextWarningAt80) {
      this.contextWarningAt80 = true;
      warning = `Context Warning: You are at ${roundedPercent}% context capacity!  You are approaching the limit.  Be concise and avoid lengthy outputs.`;
    }

    if (warning) {
      this.deps.messages.push({
        role: 'system',
        content: warning
      });
    }
  }

  /**
   * Calculate current context usage as percentage
   * @returns Percentage of context capacity used (0-100+)
   */
  getContextUsagePercent(): number {
    const current = this.deps.getCurrentTokenCount();
    const max = this.deps.getMaxContextSize();
    return (current / max) * 100;
  }

  /**
   * Compact context by keeping only the last N messages
   * Used when context becomes too large for backend to handle
   * 
   * @param keepLastMessages Number of recent messages to retain
   * @returns Number of messages removed
   */
  compactContext(keepLastMessages: number = 20): number {
    if (this.deps.chatHistory.length <= keepLastMessages) {
      return 0;
    }

    const removedCount = this.deps.chatHistory.length - keepLastMessages;
    const keptMessages = this.deps.chatHistory.slice(-keepLastMessages);

    this.deps.chatHistory.length = 0;
    this.deps.chatHistory.push(...keptMessages);
    this.deps.messages.length = 0;

    const compactionNote: ChatEntry = {
      type: 'system',
      content: `Context compacted: removed ${removedCount} older messages, keeping last ${keepLastMessages} messages.`,
      timestamp: new Date()
    };
    this.deps.chatHistory.push(compactionNote);

    for (const entry of this.deps.chatHistory) {
      if (entry.type === 'system') {
        this.deps.messages.push({
          role: 'system',
          content: entry.content as string
        });
      } else if (entry.type === 'user') {
        this.deps.messages.push({
          role: 'user',
          content: entry.content!
        });
      } else if (entry.type === 'assistant') {
        this.deps.messages.push({
          role: 'assistant',
          content: entry.content as string
        });
      } else if (entry.type === 'tool_result') {
        this.deps.messages.push({
          role: 'tool',
          tool_call_id: entry.toolResult!.output || '',
          content: JSON.stringify(entry.toolResult)
        });
      }
    }

    return removedCount;
  }

  /**
   * Reset context warning flags
   * Called when cache is cleared to allow warnings to trigger again
   */
  resetContextWarnings(): void {
    this.contextWarningAt80 = false;
    this.contextWarningAt90 = false;
  }
}