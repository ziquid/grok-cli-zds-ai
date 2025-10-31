# Tool Validation Test

## Bug Description
When Ollama LLMs return duplicate JSON tool arguments (e.g., `{"persona":"X"}{"persona":"X"}`), the duplicate-JSON fix extracts the first object correctly, but if the tool was called with wrong parameters, Ollama returns `400 invalid tool call arguments`.

## Example Case
- LLM calls `getAvailablePersonas` with `{"persona":"romantic-partner-family"}`
- `getAvailablePersonas` accepts NO parameters
- After duplicate-JSON fix, we send this invalid tool call back to Ollama
- Ollama validates and rejects with 400 error

## Fix
Added tool argument validation in `src/agent/grok-agent.ts`:

1. **`validateToolArguments()` method (lines 1153-1199)**:
   - Fetches tool schema from `getAllGrokTools()`
   - Checks if tool accepts no parameters but received some
   - Checks for unknown parameters not in schema
   - Checks for missing required parameters
   - Returns error message if invalid, null if valid

2. **Validation call in `executeTool()` (lines 1297-1318)**:
   - Called after argument parsing and defaults applied
   - Before tool approval hook
   - If validation fails:
     - Logs validation error to console
     - Adds system message to chat explaining error
     - Returns error result without executing tool
     - Allows LLM to try again with correct parameters

## Expected Behavior After Fix

**Before:**
```
⏺ setPersona
  ⎿ Executing...
🔧 System: Warning: Tool arguments for getAvailablePersonas had duplicate JSON objects
⏺ Sorry, I encountered an error: ollama API error: 400 invalid tool call arguments
```

**After:**
```
⏺ setPersona
  ⎿ Executing...
🔧 System: Warning: Tool arguments for getAvailablePersonas had duplicate JSON objects
🔧 System: Tool call validation failed: Tool getAvailablePersonas accepts no parameters, but received: {"persona":"romantic-partner-family"}
[LLM tries again with correct tool/parameters]
```

## Testing

To test with Binti's case, the LLM needs to:
1. Return duplicate JSON (already happens with Ollama)
2. Call wrong tool or use wrong parameters

The validation will catch this and provide clear feedback without hitting Ollama's 400 error.

## Files Modified
- `src/agent/grok-agent.ts`: Added `validateToolArguments()` method and validation logic in `executeTool()`
