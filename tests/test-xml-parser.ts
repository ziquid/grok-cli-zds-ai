/**
 * Test script for XML tool call parsing
 * Run with: bun run test-xml-parser.ts
 */

interface GrokToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

function parseXMLToolCalls(message: any): any {
  if (!message.content || typeof message.content !== 'string') {
    return message;
  }

  const content = message.content;
  const xmlToolCallRegex = /<xai:function_call\s+name="([^"]+)">([\s\S]*?)<\/xai:function_call>/g;
  const matches = Array.from(content.matchAll(xmlToolCallRegex));

  if (matches.length === 0) {
    return message;
  }

  // Parse each XML tool call
  const toolCalls: GrokToolCall[] = [];
  let cleanedContent = content;

  for (const match of matches) {
    const functionName = match[1];
    const paramsXML = match[2];

    // Parse parameters
    const paramRegex = /<parameter\s+name="([^"]+)">([^<]*)<\/parameter>/g;
    const paramMatches = Array.from(paramsXML.matchAll(paramRegex));

    const args: Record<string, any> = {};
    for (const paramMatch of paramMatches) {
      args[paramMatch[1]] = paramMatch[2];
    }

    // Generate a unique ID for this tool call
    const toolCallId = `call_xml_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    toolCalls.push({
      id: toolCallId,
      type: "function",
      function: {
        name: functionName,
        arguments: JSON.stringify(args)
      }
    });

    // Remove this XML block from content
    cleanedContent = cleanedContent.replace(match[0], '');
  }

  // Trim any extra whitespace
  cleanedContent = cleanedContent.trim();

  // Return modified message with tool_calls and cleaned content
  return {
    ...message,
    content: cleanedContent || null,
    tool_calls: [...(message.tool_calls || []), ...toolCalls]
  };
}

// Test cases
console.log("Testing XML tool call parser...\n");

// Test 1: Single parameter tool call
const test1 = {
  role: "assistant",
  content: `I'll run that command for you.

<xai:function_call name="execute">
  <parameter name="command">dig A mail.ai.zds.group</parameter>
</xai:function_call>`
};

console.log("Test 1: Single parameter");
console.log("Input:", test1.content);
const result1 = parseXMLToolCalls(test1);
console.log("Parsed tool calls:", JSON.stringify(result1.tool_calls, null, 2));
console.log("Cleaned content:", result1.content);
console.log();

// Test 2: Multiple parameters
const test2 = {
  role: "assistant",
  content: `Let me search for that file.

<xai:function_call name="search">
  <parameter name="path">/home/user</parameter>
  <parameter name="pattern">*.txt</parameter>
  <parameter name="recursive">true</parameter>
</xai:function_call>`
};

console.log("Test 2: Multiple parameters");
console.log("Input:", test2.content);
const result2 = parseXMLToolCalls(test2);
console.log("Parsed tool calls:", JSON.stringify(result2.tool_calls, null, 2));
console.log("Cleaned content:", result2.content);
console.log();

// Test 3: Multiple tool calls
const test3 = {
  role: "assistant",
  content: `I'll run both commands.

<xai:function_call name="execute">
  <parameter name="command">ls -la</parameter>
</xai:function_call>

<xai:function_call name="execute">
  <parameter name="command">pwd</parameter>
</xai:function_call>`
};

console.log("Test 3: Multiple tool calls");
console.log("Input:", test3.content);
const result3 = parseXMLToolCalls(test3);
console.log("Parsed tool calls:", JSON.stringify(result3.tool_calls, null, 2));
console.log("Cleaned content:", result3.content);
console.log();

// Test 4: No XML (passthrough)
const test4 = {
  role: "assistant",
  content: "This is a regular response with no tool calls."
};

console.log("Test 4: No XML (should pass through unchanged)");
console.log("Input:", test4.content);
const result4 = parseXMLToolCalls(test4);
console.log("Tool calls:", result4.tool_calls);
console.log("Content:", result4.content);
console.log();

console.log("All tests complete!");
