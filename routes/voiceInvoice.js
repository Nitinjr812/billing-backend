const express = require("express");
const router = express.Router();
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// --- Deterministic fallbacks (don't rely on the LLM for these — regex is more reliable) ---

function extractEmailFallback(text) {
  const match = text.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].replace(/\s+/g, "") : "";
}

function extractPhoneFallback(text) {
  // Speech-to-text often splits a 10-digit number with stray spaces
  // e.g. "12345678 90" should become "1234567890"
  const digitGroups = text.match(/\d+/g) || [];
  for (let i = 0; i < digitGroups.length; i++) {
    if (digitGroups[i].length === 10) return digitGroups[i];
    if (i + 1 < digitGroups.length) {
      const combined = digitGroups[i] + digitGroups[i + 1];
      if (combined.length === 10) return combined;
    }
  }
  // fallback: any single run of exactly 10 digits after stripping spaces entirely
  const stripped = text.replace(/\D/g, "");
  const tenDigitMatch = stripped.match(/\d{10}/);
  return tenDigitMatch ? tenDigitMatch[0] : "";
}

// POST /api/voice-invoice/parse
// Body: { transcript: "customer Rahul Sharma, email rahul@gmail.com, 2 kg sugar 50 rupaye, 1 rice bag 400 rupaye" }
router.post("/parse", async (req, res) => {
  const { transcript } = req.body;
  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ error: "transcript required" });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "openai/gpt-oss-120b",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `Tum ek billing assistant ho. User bolke (ya type karke) ek poora bill describe karega — customer ka naam, email/phone (agar bola ho), aur items with quantity and price.

Tumhara kaam hai is spoken/typed text ko NEECHE DIYE GAYE EXACT JSON FORMAT mein convert karna. SIRF JSON return karo, koi extra text, explanation, ya markdown backticks nahi.

FORMAT:
{
  "customerName": "string or empty string if not mentioned",
  "customerEmail": "string or empty string if not mentioned",
  "customerPhone": "string or empty string if not mentioned",
  "items": [
    { "name": "string", "qty": number, "price": number }
  ]
}

RULES:
- "price" hamesha per-unit price honi chahiye (agar total bola ho toh qty se divide karke per-unit nikaalo)
- Agar quantity na bola ho, default 1 lagao
- Agar kisi item ka price bilkul bhi na bola gaya ho, us item ko KABHI drop mat karo — usse "price": 0 ke saath items array mein zaroor daalo, taaki user baad mein manually fill kar sake
- Agar transcript real speech-to-text se aaya hai (isliye messy/run-on ho sakta hai bina commas/labels ke), phir bhi customer ka naam/email/phone dhoondhne ki poori koshish karo — labels ("customer:", "email:") zaroori nahi hain
- Hindi/Hinglish numbers samjho (do, teen, paanch, wagera) aur digit mein convert karo
- Agar ek hi item ka naam baar-baar repeat ho raha hai bina koi explicit alag quantity bole ("2 piece", "do baar", etc.) — usse ek hi item maano (STT ka stutter/repeat), qty 4 mat bana do
- Speech mein beech mein aane wali filler/meta baatein jo bill se related nahi hain (jaise "yeh dekh", "sahi se kar rha hai", "yrrr") — unko ignore karo, item ya customer field mat banao
- Currency symbols mat likho, sirf number likho price mein
- Agar kuch samajh na aaye ya bilkul empty ho, items ko empty array [] rakho

EXAMPLE (messy, unlabelled, real-world transcript):
Input: "Rahul Sharma rahulsharma@gmail.com 98765 43210 do kilo chini 90 rupaye ek packet chawal oneplus mobile oneplus mobile yeh dekh sahi se nahi ho raha"
Output:
{
  "customerName": "Rahul Sharma",
  "customerEmail": "rahulsharma@gmail.com",
  "customerPhone": "9876543210",
  "items": [
    { "name": "chini", "qty": 2, "price": 45 },
    { "name": "chawal packet", "qty": 1, "price": 0 },
    { "name": "oneplus mobile", "qty": 1, "price": 0 }
  ]
}
(Note: "90 rupaye" was the total for 2 kg chini, so per-unit price = 45. "oneplus mobile" repeated twice with no separate price/qty was treated as ONE item. The filler phrase at the end was ignored entirely.)`,
        },
        { role: "user", content: transcript },
      ],
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0].message.content;
    const parsed = JSON.parse(raw);

    let customerEmail = parsed.customerEmail || "";
    let customerPhone = parsed.customerPhone || "";

    // Deterministic fallback — if the LLM missed a clearly-present email/phone, catch it here
    if (!customerEmail) customerEmail = extractEmailFallback(transcript);
    if (!customerPhone) customerPhone = extractPhoneFallback(transcript);

    res.json({
      customerName: parsed.customerName || "",
      customerEmail,
      customerPhone,
      items: Array.isArray(parsed.items)
        ? parsed.items.map((it) => ({
            name: it.name || "Item",
            qty: Number(it.qty) || 1,
            price: Number(it.price) || 0,
          }))
        : [],
    });
  } catch (err) {
    console.error("Voice invoice parse error:", err.message);
    res.status(500).json({ error: "Parsing failed, please try manual entry" });
  }
});

module.exports = router;