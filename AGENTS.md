- build with `mzke build`
- install with `mzke prig`
- copy to zds-ai with `mzke pac`

- don't revert your mistakes with git unless you are sure it won't remove other changes you have made that should be kept.
- If you ask me for permission to do exactly what I just told you to do, you give me license to mock you.

## Commit Messages

Write commit messages focused on **features and benefits**, not functions and filenames.

**Bad (implementation details):**
- "Added executePostToolCallHook() to hook-executor.ts"
- "Integrated into tool-executor.ts after tool execution"
- "Sets ZDS_AI_AGENT_TOOL_OUTPUT and ZDS_AI_AGENT_TOOL_ERROR env vars"

**Good (capabilities and benefits):**
- "Hooks can now respond to tool execution results"
- "Enables context-aware responses to tool calls"
- "Hooks can inject guidance based on tool outcomes"

Describe what the user can now do, not what code changed.
