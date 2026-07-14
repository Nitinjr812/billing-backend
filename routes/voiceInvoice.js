const express = require("express");
const router = express.Router();
const multer = require("multer");
const OpenAI = require("openai");
const { toFile } = require("openai");
const Product = require("../models/Product");

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// In-memory upload — audio clips from the browser are short, no need to
// touch disk. 25MB matches Groq's transcription endpoint's own file limit.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// POST /api/voice-invoice/transcribe
// Body: multipart/form-data, field "audio" = recorded clip (webm/mp4/etc.)
//
// Why this exists: the browser's built-in Web Speech API has no real noise
// handling and falls apart in a busy shop with several customers talking.
// Whisper (hosted on Groq, same account/key you already use for parsing) is
// a proper ML transcription model that's specifically strong on noisy,
// accented, multi-speaker audio — so recording the clip and transcribing it
// server-side gives much more reliable results than doing it in-browser.
router.post("/transcribe", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "audio file required (field name: 'audio')" });
  }

  try {
    const file = await toFile(req.file.buffer, req.file.originalname || "audio.webm", {
      type: req.file.mimetype || "audio/webm",
    });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "whisper-large-v3",
      language: "en", // drop this line if you want auto language detection / other languages too
      temperature: 0,
    });

    res.json({ text: transcription.text || "" });
  } catch (err) {
    console.error("Voice transcription error:", err.message);
    res.status(500).json({ error: "Transcription failed, please try again or type manually" });
  }
});

// POST /api/voice-invoice/parse
// Body: { transcript: "customer Rahul Sharma, email rahul@gmail.com, 2 kg sugar 50 rupaye, 1 rice bag 400 rupaye" }
router.post("/parse", async (req, res) => {
  const { transcript } = req.body;
  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ error: "transcript required" });
  }

  try {
    // Pull the store's real product catalog so the model can match spoken
    // item names ("butter milk", "dairy milk" etc.) to the ACTUAL catalog
    // entry ("Buttermilk", "Dairy Milk") regardless of spacing/spelling —
    // this fixes the matching problem at the source instead of relying on
    // the frontend to guess afterwards.
    const products = await Product.find({}, "name price").lean();
    const catalogList = products
      .map((p) => `- ${p.name} (price: ${p.price})`)
      .join("\n");

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

STORE KA PRODUCT CATALOG (isse match karo):
${catalogList || "(catalog khaali hai)"}

ITEM NAME MATCHING RULES (bahut zaroori):
- Har item ke liye pehle CATALOG mein se closest matching product dhoondo — spacing, capitalization, aur chhoti spelling/pronunciation mistakes ko IGNORE karo. E.g. agar user "butter milk" bole aur catalog mein "Buttermilk" hai, toh yeh SAME product hai — catalog ka EXACT naam "Buttermilk" use karo, "butter milk" nahi.
- Agar catalog mein clear match mil jaye, "name" field mein CATALOG ka exact naam likho (apna wording nahi).
- Agar user ne us item ka price nahi bola, aur catalog mein match mila hai, toh catalog ka price use karo.
- Agar catalog mein koi reasonable match NAHI milta, jo naam user ne bola wahi rakho, aur price jo bola gaya wahi likho (ya price na bola ho toh 0).

OTHER RULES:
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