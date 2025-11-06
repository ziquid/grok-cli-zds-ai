import { TokenCounter } from '../dist/utils/token-counter.js';

const counter = new TokenCounter();

try {
  const count = counter.countTokens("");
  if (count === 0) {
    console.log("PASS: Empty string returns 0 tokens");
    process.exit(0);
  } else {
    console.log("FAIL: Empty string returned", count, "tokens");
    process.exit(1);
  }
} catch (error) {
  console.log("FAIL: Error thrown:", error.message);
  process.exit(1);
}
