- build with `mzke build`
- install with `mzke prig`
- copy to zds-ai with `mzke pac`
- test locally (without installing) with `PATH=~/sca/zai-cli/bin-wrapper:$PATH zai t bot <command>`

- don't revert your mistakes with git unless you are sure it won't remove other changes you have made that should be kept.
- If you ask me for permission to do exactly what I just told you to do, you give me license to mock you.

## Commit Messages

Write commit messages focused on **features and benefits**, not functions and filenames.  Describe what the user can now do, not what code changed.

**Bad (implementation details):**
- "Added executePostToolCallHook() to hook-executor.ts"
- "Integrated into tool-executor.ts after tool execution"
- "Sets ZDS_AI_AGENT_TOOL_OUTPUT and ZDS_AI_AGENT_TOOL_ERROR env vars"

**Good (capabilities and benefits):**
- "Hooks can now respond to tool execution results"
- "Enables context-aware responses to tool calls"
- "Hooks can inject guidance based on tool outcomes"

## LLM Message Flow

**Where LLM API Calls Are Made:**

File: `src/agent/llm-agent.ts`

**LLM call locations:**
- **Line ~852**: Main path in `processUserMessageStream()` method
- **Line ~1077**: Debug/retry path in same method
- **Line ~1147**: Short/empty response retry path in same method

All call: `this.llmClient.chat(this.messages, tools, ...)`

**System Message Rendering:**

System message is rendered dynamically just before each LLM call via `renderSystemMessage()` (line ~532).  This ensures the system prompt reflects current variable state including values set by hooks.

**Rendering locations:**
- File: `src/agent/llm-agent.ts`
  - Line ~849: Main chat call in processUserMessage()
  - Line ~1075: Debug/retry chat call in processUserMessage()
  - Line ~1145: Short response retry chat call in processUserMessage()
  - Line ~1394: chatStream call in processUserMessageStream()
  - Line ~1866: Automatic render in getSystemPrompt()
- File: `src/agent/hook-manager.ts`
  - Line ~546: testModel() chat call
  - Line ~656: testBackendModelChange() chat call

**Why Dynamic Rendering:**
- Instance hook sets variables AFTER initialize() completes
- Fresh sessions need instance hook variables in system prompt
- Enables isNew notifications for info-only variables at call time
- System prompt always reflects current state
- `getSystemPrompt()` always returns current rendered state

