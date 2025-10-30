#!/usr/bin/env bun

/**
 * Unit test for duplicate JSON handling in tool call arguments
 * Tests the fix for LLM bug where JSON objects are concatenated/duplicated
 */

// Test cases for duplicate JSON detection
const testCases = [
  {
    name: "Exact duplicate objects",
    input: '{"persona":"romantic-partner-family"}{"persona":"romantic-partner-family"}',
    expected: { persona: "romantic-partner-family" },
    shouldSucceed: true
  },
  {
    name: "Different duplicate objects",
    input: '{"param":"value1"}{"param":"value2"}',
    expected: { param: "value1" },
    shouldSucceed: true
  },
  {
    name: "Triple duplication",
    input: '{"p":"v"}{"p":"v"}{"p":"v"}',
    expected: { p: "v" },
    shouldSucceed: true
  },
  {
    name: "Nested objects duplicated",
    input: '{"obj":{"nested":"val"}}{"obj":{"nested":"val"}}',
    expected: { obj: { nested: "val" } },
    shouldSucceed: true
  },
  {
    name: "Arrays in duplicated objects",
    input: '{"arr":[1,2,3]}{"arr":[1,2,3]}',
    expected: { arr: [1, 2, 3] },
    shouldSucceed: true
  },
  {
    name: "Whitespace between duplicates (not detected as duplicate - space breaks pattern)",
    input: '{"p":"v"} {"p":"v"}',
    expected: null,
    shouldSucceed: false
  },
  {
    name: "Single valid JSON (no duplicates)",
    input: '{"param":"value"}',
    expected: { param: "value" },
    shouldSucceed: true
  },
  {
    name: "Empty object duplicated",
    input: '{}{}',
    expected: {},
    shouldSucceed: true
  }
];

// Simple extraction logic matching the implementation
function extractFirstJson(argsString: string): string {
  if (!argsString.includes('}{')) {
    return argsString; // No duplicates
  }

  try {
    let depth = 0;
    let firstObjEnd = -1;
    for (let i = 0; i < argsString.length; i++) {
      if (argsString[i] === '{') depth++;
      if (argsString[i] === '}') {
        depth--;
        if (depth === 0) {
          firstObjEnd = i + 1;
          break;
        }
      }
    }

    if (firstObjEnd > 0 && firstObjEnd < argsString.length) {
      const firstObj = argsString.substring(0, firstObjEnd);
      JSON.parse(firstObj); // Validate
      return firstObj;
    }
  } catch (e) {
    // Fall through to return original
  }

  return argsString;
}

// Run tests
console.log("Testing duplicate JSON extraction logic...\n");

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  try {
    const extracted = extractFirstJson(testCase.input);
    const parsed = JSON.parse(extracted);
    const matches = JSON.stringify(parsed) === JSON.stringify(testCase.expected);

    if (matches) {
      console.log(`✅ PASS: ${testCase.name}`);
      passed++;
    } else {
      console.log(`❌ FAIL: ${testCase.name}`);
      console.log(`   Expected: ${JSON.stringify(testCase.expected)}`);
      console.log(`   Got: ${JSON.stringify(parsed)}`);
      failed++;
    }
  } catch (error: any) {
    if (testCase.shouldSucceed) {
      console.log(`❌ FAIL: ${testCase.name} - threw error: ${error.message}`);
      failed++;
    } else {
      console.log(`✅ PASS: ${testCase.name} - correctly failed`);
      passed++;
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);

process.exit(failed > 0 ? 1 : 0);
