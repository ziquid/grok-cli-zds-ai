import { TokenCounter } from '../dist/utils/token-counter.js';

const counter = new TokenCounter();
const specialTokens = [
  "<|endoftext|>",
  "<|startoftext|>",
  "<|im_start|>",
  "<|im_end|>"
];

let allPassed = true;

for (const token of specialTokens) {
  try {
    const count = counter.countTokens(token);
    console.log(`Token "${token}": ${count} tokens`);
    if (count === 0) {
      allPassed = false;
    }
  } catch (error) {
    console.log(`FAIL: Error with token "${token}":`, error.message);
    allPassed = false;
  }
}

process.exit(allPassed ? 0 : 1);
