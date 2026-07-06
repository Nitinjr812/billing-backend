const express = require("express");
const router = express.Router();
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// POST /api/voice-invoice/parse
// Body: { transcript: "customer Rahul Sharma, email rahul@gmail.com, 2 kg sugar 50 rupaye, 1 rice bag 400 rupaye" }
router.post("/parse", async (req, res) => {
  const { transcript } = req.body;
  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ error: "transcript required" });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
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
- Hindi/Hinglish numbers samjho (do, teen, paanch, wagera) aur digit mein convert karo
- Currency symbols mat likho, sirf number likho price mein
- Agar kuch samajh na aaye ya bilkul empty ho, items ko empty array [] rakho`,
        },
        { role: "user", content: transcript },
      ],
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0].message.content;
    const parsed = JSON.parse(raw);

    // Safety defaults
    res.json({
      customerName: parsed.customerName || "",
      customerEmail: parsed.customerEmail || "",
      customerPhone: parsed.customerPhone || "",
      items: Array.isArray(parsed.items) ? parsed.items.map((it) => ({
        name: it.name || "Item",
        qty: Number(it.qty) || 1,
        price: Number(it.price) || 0,
      })) : [],
    });
  } catch (err) {
    console.error("Voice invoice parse error:", err.message);
    res.status(500).json({ error: "Parsing failed, please try manual entry" });
  }
});

module.exports = router;