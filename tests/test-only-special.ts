import { TokenCounter } from '../dist/utils/token-counter.js';

const counter = new TokenCounter();

try {
  const count = counter.countTokens("<|endoftext|>");
  if (count > 0) {
    console.log("PASS: Special token only returns count:", count);
    process.exit(0);
  } else {
    console.log("FAIL: Special token returned 0 tokens");
    process.exit(1);
  }
} catch (error) {
  console.log("FAIL: Error thrown:", error.message);
  process.exit(1);
}
