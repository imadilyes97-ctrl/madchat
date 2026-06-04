import { OpenAI } from 'openai';
import dotenv from 'dotenv';

dotenv.config();

console.log("OPENCODE_API_KEY:", process.env.OPENCODE_API_KEY);
console.log("OPENCODE_BASE_URL:", process.env.OPENCODE_BASE_URL);
console.log("OPENCODE_MODEL:", process.env.OPENCODE_MODEL);

const client = new OpenAI({
  apiKey: process.env.OPENCODE_API_KEY,
  baseURL: process.env.OPENCODE_BASE_URL,
});

async function main() {
  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENCODE_MODEL || 'opencode/zen:deepseek v4 flash free',
      messages: [
        { role: 'user', content: 'Say hello in Darija' }
      ]
    });
    console.log("API Response:", JSON.stringify(response, null, 2));
  } catch (error) {
    console.error("API Call Error:", error);
  }
}

main();
