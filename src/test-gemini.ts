import dotenv from "dotenv";
dotenv.config();

const key = process.env.GEMINI_API_KEY;

async function bruteForce() {
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
  const json = await resp.json();
  const models = json.models || [];
  
  const toTry = [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash-exp",
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash",
    "gemini-1.5-flash-001",
    "gemini-1.5-flash-002",
    "gemini-2.0-flash-001"
  ];
  
  // Also add everything from the list that says "flash"
  models.forEach(m => {
    const name = m.name.split("/")[1];
    if (name.includes("flash") && !toTry.includes(name)) {
      toTry.push(name);
    }
  });

  console.log(`Will try ${toTry.length} models...`);

  for (const model of toTry) {
    process.stdout.write(`Testing ${model}... `);
    try {
      const tResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] })
        }
      );
      if (tResp.status === 200) {
        console.log("✅ SUCCESS!");
        process.exit(0);
      } else {
        const body = await tResp.json();
        const reason = body.error?.message?.slice(0, 50) || "Unknown error";
        console.log(`❌ FAIL (${tResp.status}): ${reason}`);
      }
    } catch (e) {
      console.log(`❌ ERROR: ${e.message}`);
    }
  }
}

bruteForce();
