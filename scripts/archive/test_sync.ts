const API_URL = 'http://localhost:3001/api/games/sync';

async function testSync() {
  console.log("Testing Sync with username 'Klarke'...");
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Klarke' }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (response.ok) {
      const result = await response.json();
      console.log("Sync Success:", result);
    } else {
      console.error("Sync Failed:", response.status, await response.text());
    }
  } catch (e) {
    console.error("Network Error:", e);
  }
}

testSync();
