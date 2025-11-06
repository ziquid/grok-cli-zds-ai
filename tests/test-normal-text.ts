import { TokenCounter } from '../dist/utils/token-counter.js';

const counter = new TokenCounter();
const tests = [
  { text: "Hello world", min: 2, max: 4 },  // Short text
  { text: "The quick brown fox jumps over the lazy dog. This is a medium-length sentence for testing.", min: 15, max: 25 },  // Medium text
];

let allPassed = true;

for (const test of tests) {
  try {
    const count = counter.countTokens(test.text);
    console.log(`Text length ${test.text.length} chars: ${count} tokens`);

    if (count >= test.min && count <= test.max) {
      console.log("  PASS: Token count in expected range");
    } else {
      console.log(`  FAIL: Token count ${count} outside expected range ${test.min}-${test.max}`);
      allPassed = false;
    }
  } catch (error) {
    console.log("  FAIL: Error thrown:", error.message);
    allPassed = false;
  }
}

process.exit(allPassed ? 0 : 1);
