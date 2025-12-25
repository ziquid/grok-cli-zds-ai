import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ChatEntry } from "../agent/llm-agent";
import { getTextContent } from "./content-utils.js";

const HISTORY_FILE_NAME = "chat-history.json";
const HISTORY_DIR = path.join(os.homedir(), ".grok");

export interface SessionState {
  session: string;
  persona: string;
  personaColor: string;
  mood: string;
  moodColor: string;
  activeTask: string;
  activeTaskAction: string;
  activeTaskColor: string;
  cwd: string;
  contextCurrent: number;
  contextMax: number;
  backend: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  model: string;
  supportsVision?: boolean;
}

export interface ContextData {
  systemPrompt: string;
  chatHistory: ChatEntry[];
  sessionState?: SessionState;
}

/**
 * Manages chat history persistence to ~/.grok/chat-history.json or custom path
 */
export class ChatHistoryManager {
  private static instance: ChatHistoryManager;
  private static customHistoryFilePath: string | null = null;
  private historyFilePath: string;

  private constructor() {
    this.historyFilePath = ChatHistoryManager.customHistoryFilePath || path.join(HISTORY_DIR, HISTORY_FILE_NAME);
    this.ensureHistoryDirExists();
  }

  /**
   * Set a custom history file path (must be called before getInstance)
   */
  static setCustomHistoryPath(filePath: string): void {
    ChatHistoryManager.customHistoryFilePath = filePath;
  }

  static getInstance(): ChatHistoryManager {
    if (!ChatHistoryManager.instance) {
      ChatHistoryManager.instance = new ChatHistoryManager();
    }
    return ChatHistoryManager.instance;
  }

  /**
   * Get the context file path (main history JSON file)
   */
  getContextFilePath(): string {
    return this.historyFilePath;
  }

  private ensureHistoryDirExists(): void {
    const dir = path.dirname(this.historyFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Deserialize chat entries from parsed JSON
   */
  private deserializeChatEntries(entries: any[]): ChatEntry[] {
    return entries
      .map((entry: any) => {
        try {
          if (!entry.type || !entry.timestamp) {
            console.warn("Skipping invalid chat entry:", entry);
            return null;
          }
          return {
            ...entry,
            timestamp: new Date(entry.timestamp),
          };
        } catch (entryError) {
          console.warn("Failed to parse chat entry:", entry, entryError);
          return null;
        }
      })
      .filter((entry): entry is ChatEntry => entry !== null);
  }

  /**
   * Load context (system prompt + chat history)
   * Supports both old format (array) and new format (object)
   */
  loadContext(): ContextData {
    try {
      if (!fs.existsSync(this.historyFilePath)) {
        return { systemPrompt: "", chatHistory: [] };
      }

      const data = fs.readFileSync(this.historyFilePath, "utf-8");
      const parsed = JSON.parse(data);

      // New format: {systemPrompt: string, chatHistory: ChatEntry[], sessionState?: SessionState}
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'systemPrompt' in parsed) {
        const contextData: ContextData = {
          systemPrompt: parsed.systemPrompt || "",
          chatHistory: this.deserializeChatEntries(parsed.chatHistory || []),
        };

        // Load session state from context if present, otherwise try .state.json
        if (parsed.sessionState) {
          contextData.sessionState = parsed.sessionState;
        } else {
          const legacySessionState = this.loadSessionState();
          if (legacySessionState) {
            contextData.sessionState = legacySessionState;
          }
        }

        return contextData;
      }

      // Old format: array of ChatEntry (system message at index 0 is systemPrompt)
      if (Array.isArray(parsed)) {
        const entries = this.deserializeChatEntries(parsed);
        const contextData: ContextData = {
          systemPrompt: "",
          chatHistory: entries,
        };

        // Only extract system prompt if it's at index 0
        if (entries.length > 0 && entries[0].type === "system") {
          contextData.systemPrompt = getTextContent(entries[0].content);
          contextData.chatHistory = entries.slice(1); // Everything after index 0
        }

        // Load session state from .state.json for backward compatibility
        const legacySessionState = this.loadSessionState();
        if (legacySessionState) {
          contextData.sessionState = legacySessionState;
        }

        return contextData;
      }

      console.warn("Unknown context file format");
      return { systemPrompt: "", chatHistory: [] };

    } catch (error) {
      console.warn("Failed to load context:", error);
      return { systemPrompt: "", chatHistory: [] };
    }
  }

  /**
   * Serialize chat entries for JSON storage
   */
  private serializeChatEntries(entries: ChatEntry[]): any[] {
    return entries.map(entry => ({
      ...entry,
      timestamp: entry.timestamp instanceof Date
        ? entry.timestamp.toISOString()
        : entry.timestamp, // Already a string
    }));
  }

  /**
   * Save context (system prompt + chat history + session state) in new format
   */
  saveContext(systemPrompt: string, chatHistory: ChatEntry[], sessionState?: SessionState): void {
    try {
      const contextData: any = {
        systemPrompt,
        chatHistory: this.serializeChatEntries(chatHistory),
      };

      // Include session state if provided
      if (sessionState) {
        contextData.sessionState = sessionState;
      }

      fs.writeFileSync(this.historyFilePath, JSON.stringify(contextData, null, 2));
    } catch (error) {
      console.warn("Failed to save context:", error);
    }
  }

  /**
   * Save raw messages log to file (OpenAI format messages)
   */
  saveMessages(messages: any[]): void {
    try {
      const messagesFilePath = this.historyFilePath.replace('.json', '.messages.json');
      fs.writeFileSync(messagesFilePath, JSON.stringify(messages, null, 2));
    } catch (error) {
      console.warn("Failed to save messages log:", error);
    }
  }

  /**
   * Create a backup of all session files (history, messages, state, debug log)
   */
  backupHistory(): string | null {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

      // Create context-backup subdirectory
      const contextDir = path.dirname(this.historyFilePath);
      const backupDir = path.join(contextDir, 'context-backup');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      let backupPath: string | null = null;

      // Backup main history file
      if (fs.existsSync(this.historyFilePath)) {
        const baseFileName = path.basename(this.historyFilePath, '.json');
        backupPath = path.join(backupDir, `${baseFileName}.${timestamp}.json`);
        fs.copyFileSync(this.historyFilePath, backupPath);
      }

      // Backup messages file
      const messagesFilePath = this.historyFilePath.replace('.json', '.messages.json');
      if (fs.existsSync(messagesFilePath)) {
        const baseFileName = path.basename(messagesFilePath, '.json');
        const messagesBackupPath = path.join(backupDir, `${baseFileName}.${timestamp}.json`);
        fs.copyFileSync(messagesFilePath, messagesBackupPath);
      }

      // Backup state file
      const stateFilePath = this.historyFilePath.replace('.json', '.state.json');
      if (fs.existsSync(stateFilePath)) {
        const baseFileName = path.basename(stateFilePath, '.json');
        const stateBackupPath = path.join(backupDir, `${baseFileName}.${timestamp}.json`);
        fs.copyFileSync(stateFilePath, stateBackupPath);
      }

      // Backup debug log file
      const debugLogPath = this.historyFilePath.replace('.json', '.debug.log');
      if (fs.existsSync(debugLogPath)) {
        const baseFileName = path.basename(debugLogPath, '.log');
        const debugBackupPath = path.join(backupDir, `${baseFileName}.${timestamp}.log`);
        fs.copyFileSync(debugLogPath, debugBackupPath);
      }

      return backupPath;
    } catch (error) {
      console.warn("Failed to backup chat history:", error);
      return null;
    }
  }

  /**
   * Clear all session files (history, messages, state, debug log) with automatic backup
   */
  clearHistory(): void {
    try {
      // First, create a backup
      const backupPath = this.backupHistory();

      // Then clear the files
      if (fs.existsSync(this.historyFilePath)) {
        fs.unlinkSync(this.historyFilePath);
      }
      const messagesFilePath = this.historyFilePath.replace('.json', '.messages.json');
      if (fs.existsSync(messagesFilePath)) {
        fs.unlinkSync(messagesFilePath);
      }
      // Also clear session state
      const stateFilePath = this.historyFilePath.replace('.json', '.state.json');
      if (fs.existsSync(stateFilePath)) {
        fs.unlinkSync(stateFilePath);
      }
      // Also clear debug log
      const debugLogPath = this.historyFilePath.replace('.json', '.debug.log');
      if (fs.existsSync(debugLogPath)) {
        fs.unlinkSync(debugLogPath);
      }
    } catch (error) {
      console.warn("Failed to clear chat history:", error);
    }
  }

  /**
   * Save session state (persona, mood, task, cwd) to file
   */
  saveSessionState(state: SessionState): void {
    try {
      const stateFilePath = this.historyFilePath.replace('.json', '.state.json');
      fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2) + '\n');
    } catch (error) {
      console.warn("Failed to save session state:", error);
    }
  }

  /**
   * Load session state from file
   */
  loadSessionState(): SessionState | null {
    try {
      const stateFilePath = this.historyFilePath.replace('.json', '.state.json');
      if (!fs.existsSync(stateFilePath)) {
        return null;
      }

      const data = fs.readFileSync(stateFilePath, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      console.warn("Failed to load session state:", error);
      return null;
    }
  }

  /**
   * Get the debug log file path based on the context file
   */
  getDebugLogPath(): string {
    return this.historyFilePath.replace('.json', '.debug.log');
  }

  /**
   * Static method to get debug log path (for use before agent is created)
   */
  static getDebugLogPath(): string {
    const instance = ChatHistoryManager.getInstance();
    return instance.getDebugLogPath();
  }
}