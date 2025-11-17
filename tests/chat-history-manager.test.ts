/**
 * Unit tests for ChatHistoryManager
 *
 * Tests for timestamp serialization fix (Nov 2025):
 * - serializeChatEntries() must handle both Date objects and ISO string timestamps
 * - Prevents "entry.timestamp.toISOString is not a function" crash on Ctrl+C
 *
 * Run with: npm test -- tests/chat-history-manager.test.ts
 */

import { ChatHistoryManager, SessionState } from '../src/utils/chat-history-manager.js';
import { ChatEntry } from '../src/agent/grok-agent.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Helper to create a minimal valid SessionState for testing
function createTestSessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    session: 'test-session',
    persona: 'default',
    personaColor: '#ffffff',
    mood: 'neutral',
    moodColor: '#ffffff',
    activeTask: '',
    activeTaskAction: '',
    activeTaskColor: '#ffffff',
    cwd: process.cwd(),
    contextCurrent: 0,
    contextMax: 100000,
    backend: 'test',
    baseUrl: 'http://localhost',
    apiKeyEnvVar: 'TEST_API_KEY',
    model: 'test-model',
    ...overrides
  };
}

describe('ChatHistoryManager.serializeChatEntries', () => {
  let manager: ChatHistoryManager;
  let tempDir: string;
  let originalHistoryPath: string;

  beforeEach(() => {
    // Create a temporary directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-test-'));
    manager = ChatHistoryManager.getInstance();
    // Save original path to restore later (cast to any to access private property)
    originalHistoryPath = (manager as any).historyFilePath;
    // Point manager to temp file
    (manager as any).historyFilePath = path.join(tempDir, 'test.context.json');
  });

  afterEach(() => {
    // Restore original path
    (manager as any).historyFilePath = originalHistoryPath;
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('timestamp type handling', () => {
    it('should serialize Date object timestamps to ISO strings', () => {
      const dateTimestamp = new Date('2025-11-16T10:00:00.000Z');
      const entries: ChatEntry[] = [
        {
          type: 'user',
          content: 'test message',
          timestamp: dateTimestamp
        }
      ];

      manager.saveContext('test system prompt', entries, createTestSessionState());

      const saved = JSON.parse(fs.readFileSync((manager as any).historyFilePath, 'utf-8'));
      expect(saved.chatHistory[0].timestamp).toBe('2025-11-16T10:00:00.000Z');
      expect(typeof saved.chatHistory[0].timestamp).toBe('string');
    });

    it('should preserve string timestamps as-is', () => {
      const stringTimestamp = '2025-11-16T12:30:45.123Z';
      const entries = [
        {
          type: 'assistant' as const,
          content: 'response',
          timestamp: stringTimestamp as any // Simulate already-serialized timestamp
        }
      ];

      manager.saveContext('test system prompt', entries as ChatEntry[], createTestSessionState());

      const saved = JSON.parse(fs.readFileSync((manager as any).historyFilePath, 'utf-8'));
      expect(saved.chatHistory[0].timestamp).toBe('2025-11-16T12:30:45.123Z');
    });

    it('should handle mixed Date and string timestamps in same array', () => {
      const entries = [
        {
          type: 'user' as const,
          content: 'user message',
          timestamp: new Date('2025-11-16T10:00:00.000Z')
        },
        {
          type: 'assistant' as const,
          content: 'assistant response',
          timestamp: '2025-11-16T10:01:00.000Z' as any // String timestamp
        },
        {
          type: 'system' as const,
          content: 'system notification',
          timestamp: new Date('2025-11-16T10:02:00.000Z')
        }
      ];

      // This should NOT throw "entry.timestamp.toISOString is not a function"
      expect(() => {
        manager.saveContext('test system prompt', entries as ChatEntry[], createTestSessionState());
      }).not.toThrow();

      const saved = JSON.parse(fs.readFileSync((manager as any).historyFilePath, 'utf-8'));
      expect(saved.chatHistory.length).toBe(3);
      expect(saved.chatHistory[0].timestamp).toBe('2025-11-16T10:00:00.000Z');
      expect(saved.chatHistory[1].timestamp).toBe('2025-11-16T10:01:00.000Z');
      expect(saved.chatHistory[2].timestamp).toBe('2025-11-16T10:02:00.000Z');

      // All timestamps should be strings in the saved JSON
      saved.chatHistory.forEach((entry: any) => {
        expect(typeof entry.timestamp).toBe('string');
      });
    });

    it('should not crash on Ctrl+C scenario with loaded history', () => {
      // Simulate scenario: history loaded from JSON (string timestamps) and saved on exit
      const loadedEntries = [
        {
          type: 'user' as const,
          content: 'old message',
          timestamp: '2025-11-16T09:00:00.000Z' as any // Loaded from JSON - string
        },
        {
          type: 'assistant' as const,
          content: 'old response',
          timestamp: '2025-11-16T09:01:00.000Z' as any // Loaded from JSON - string
        }
      ];

      // New message added during session (Date object)
      const newEntry = {
        type: 'user' as const,
        content: 'new message',
        timestamp: new Date() // Fresh Date object
      };

      const combinedHistory = [...loadedEntries, newEntry] as ChatEntry[];

      // This is what happens on Ctrl+C - should not throw
      expect(() => {
        manager.saveContext('system prompt', combinedHistory, createTestSessionState());
      }).not.toThrow();
    });
  });

  describe('full context save/load cycle', () => {
    it('should preserve all entry fields through serialization', () => {
      const entries: ChatEntry[] = [
        {
          type: 'user',
          content: 'test content',
          timestamp: new Date('2025-11-16T10:00:00.000Z')
        },
        {
          type: 'assistant',
          content: 'response with tools',
          timestamp: new Date('2025-11-16T10:01:00.000Z'),
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'testTool',
                arguments: '{"arg": "value"}'
              }
            }
          ]
        },
        {
          type: 'tool_result',
          content: 'tool output',
          timestamp: new Date('2025-11-16T10:02:00.000Z'),
          toolCall: {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'testTool',
              arguments: '{"arg": "value"}'
            }
          },
          toolResult: {
            success: true,
            output: 'Success!'
          }
        }
      ];

      const sessionState = createTestSessionState({
        persona: 'test-persona',
        mood: 'focused',
        activeTask: 'testing',
        cwd: '/test/dir'
      });

      manager.saveContext('System prompt content', entries, sessionState);

      const saved = JSON.parse(fs.readFileSync((manager as any).historyFilePath, 'utf-8'));

      // Verify structure
      expect(saved.systemPrompt).toBe('System prompt content');
      expect(saved.chatHistory.length).toBe(3);
      expect(saved.sessionState.persona).toBe('test-persona');
      expect(saved.sessionState.mood).toBe('focused');

      // Verify entry types preserved
      expect(saved.chatHistory[0].type).toBe('user');
      expect(saved.chatHistory[1].type).toBe('assistant');
      expect(saved.chatHistory[2].type).toBe('tool_result');

      // Verify tool_calls preserved
      expect(saved.chatHistory[1].tool_calls).toBeDefined();
      expect(saved.chatHistory[1].tool_calls[0].id).toBe('call_123');

      // Verify toolResult preserved
      expect(saved.chatHistory[2].toolResult.success).toBe(true);
      expect(saved.chatHistory[2].toolResult.output).toBe('Success!');
    });
  });
});
