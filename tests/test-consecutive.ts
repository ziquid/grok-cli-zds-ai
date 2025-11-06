import { TokenCounter } from '../dist/utils/token-counter.js';

const counter = new TokenCounter();

try {
  const count = counter.countTokens("<|endoftext|><|endoftext|><|startoftext|>");
  if (count > 0) {
    console.log("PASS: Consecutive special tokens return count:", count);
    process.exit(0);
  } else {
    console.log("FAIL: Consecutive tokens returned 0");
    process.exit(1);
  }
} catch (error) {
  console.log("FAIL: Error thrown:", error.message);
  process.exit(1);
}
