import { TokenCounter } from '../dist/utils/token-counter.js';

const counter = new TokenCounter();
const text = "Hello world <|endoftext|> More text here";

try {
  const count = counter.countTokens(text);
  console.log("Mixed content token count:", count);

  // Should have tokens for "Hello world", special token, and "More text here"
  if (count > 5) {  // At least a few tokens expected
    console.log("PASS");
    process.exit(0);
  } else {
    console.log("FAIL: Token count too low:", count);
    process.exit(1);
  }
} catch (error) {
  console.log("FAIL: Error thrown:", error.message);
  process.exit(1);
}
