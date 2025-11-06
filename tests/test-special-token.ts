import { TokenCounter } from '../dist/utils/token-counter.js';

const counter = new TokenCounter();
const text = "Hello <|endoftext|> world";

try {
  const count = counter.countTokens(text);
  if (count > 0) {
    console.log("PASS: Token count returned:", count);
    process.exit(0);
  } else {
    console.log("FAIL: Token count is 0");
    process.exit(1);
  }
} catch (error) {
  console.log("FAIL: Error thrown:", error.message);
  process.exit(1);
}
