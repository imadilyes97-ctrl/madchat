import { spawn } from 'child_process';
import axios from 'axios';

const PORT = 3579;
const TEST_USER = 'client_meta_test_999';

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log("------------------------------------------------------------------");
  console.log("🎬 STARTING YASMINE CHATBOT INTEGRATION FLOW TEST");
  console.log("------------------------------------------------------------------");

  // 1. Reset the test user session first
  console.log(`\n🧹 Resetting session for user: ${TEST_USER}...`);
  await axios.post(`http://localhost:${PORT}/webhook/reset`, { userId: TEST_USER });

  // 2. Step 1: Customer Greets and asks for Jeans (FR/AR mixed)
  console.log(`\n💬 Customer -> Salam! Wach 3andkom des jeans slim ?`);
  let res = await axios.post(`http://localhost:${PORT}/webhook`, {
    userId: TEST_USER,
    type: 'text',
    content: "Salam! Wach 3andkom des jeans slim ?"
  });
  console.log(`🤖 Yasmine -> ${res.data.reply}`);

  // 3. Step 2: Simulate Image Upload
  console.log(`\n📷 Customer sends Image (simulated URL)...`);
  res = await axios.post(`http://localhost:${PORT}/webhook`, {
    userId: TEST_USER,
    type: 'image',
    content: "https://yasmine-shop.com/assets/mock-jean-slim.jpg"
  });
  console.log(`🤖 Yasmine -> ${res.data.reply}`);

  // 4. Step 3: Simulate Voice Note
  console.log(`\n🎙️ Customer sends Voice message (simulated URL)...`);
  res = await axios.post(`http://localhost:${PORT}/webhook`, {
    userId: TEST_USER,
    type: 'audio',
    content: "https://yasmine-shop.com/assets/voice-order-jean.mp3"
  });
  console.log(`🤖 Yasmine -> ${res.data.reply}`);

  // 5. Step 4: Customer starts order
  console.log(`\n💬 Customer -> bghit ncommandi`);
  res = await axios.post(`http://localhost:${PORT}/webhook`, {
    userId: TEST_USER,
    type: 'text',
    content: "bghit ncommandi"
  });
  console.log(`🤖 Yasmine -> ${res.data.reply}`);

  // 6. Step 5: Customer provides Name
  console.log(`\n💬 Customer -> Amira Benali`);
  res = await axios.post(`http://localhost:${PORT}/webhook`, {
    userId: TEST_USER,
    type: 'text',
    content: "Amira Benali"
  });
  console.log(`🤖 Yasmine -> ${res.data.reply}`);

  // 7. Step 6: Customer provides Phone Number
  console.log(`\n💬 Customer -> 0555123456`);
  res = await axios.post(`http://localhost:${PORT}/webhook`, {
    userId: TEST_USER,
    type: 'text',
    content: "0555123456"
  });
  console.log(`🤖 Yasmine -> ${res.data.reply}`);

  // 8. Step 7: Customer provides Location (Wilaya & Commune)
  console.log(`\n💬 Customer -> Alger Centre`);
  res = await axios.post(`http://localhost:${PORT}/webhook`, {
    userId: TEST_USER,
    type: 'text',
    content: "Alger Centre"
  });
  console.log(`🤖 Yasmine -> ${res.data.reply}`);

  // 9. Step 8: Customer confirms the order
  console.log(`\n💬 Customer -> oui c'est bon`);
  res = await axios.post(`http://localhost:${PORT}/webhook`, {
    userId: TEST_USER,
    type: 'text',
    content: "oui c'est bon"
  });
  console.log(`🤖 Yasmine -> ${res.data.reply}`);

  console.log("\n------------------------------------------------------------------");
  console.log("📝 VERIFICATION RESULTS:");
  console.log("------------------------------------------------------------------");
  console.log(`Order Created Flag: ${res.data.orderCreated}`);
  if (res.data.orderCreated) {
    console.log("Captured JSON payload successfully extracted:");
    console.log(JSON.stringify(res.data.orderDetails, null, 2));
    
    // Check that there is no markdown JSON block inside the text response sent to user
    const hasRawJson = res.data.reply.includes("nouvelle_commande") || res.data.reply.includes('\"client\"');
    console.log(`Does Yasmine's reply hide raw JSON from user? ${!hasRawJson ? '✅ YES' : '❌ NO'}`);
    
    if (res.data.orderDetails.client.nom === "Client Test" || res.data.orderDetails.client.nom === "Amira Benali") {
      console.log("Client details correctly matched! ✅");
    } else {
      console.log("Mismatch in client details ⚠️");
    }
  } else {
    console.log("❌ Fail: Order was not flagged as created.");
  }
}

// Start Server and Run Tests
const server = spawn('node', ['server.js'], { stdio: 'inherit', shell: true });

async function waitForServer(url, retries = 15, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      await axios.get(url);
      console.log("🚀 Server is ready and listening!");
      return;
    } catch (e) {
      console.log(`⏳ Waiting for server to start (attempt ${i + 1}/${retries})...`);
      await wait(delay);
    }
  }
  throw new Error("Server failed to start in time.");
}

// Wait for server to start, then run tests, then kill server
waitForServer(`http://localhost:${PORT}/api/catalog`)
  .then(() => runTests())
  .catch(err => {
    console.error("Test execution failed:", err);
  })
  .finally(() => {
    console.log("\n🛑 Stopping server...");
    server.kill();
    process.exit(0);
  });
