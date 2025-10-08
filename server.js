// server.js — Realtime (tab audio) + JD-tailored answers (TEXT replies only)
import express from "express";
import fetch from "node-fetch";
import "dotenv/config";
import fs from "fs";

const app = express();
app.use(express.static("public"));
app.use(express.json({ limit: "1mb" })); // for /set-jd

/* Load resume (optional but recommended) */
let resume = "";
let assignment = "";
try {
  resume = fs.readFileSync("./resume.txt", "utf8");
  console.log("ℹ️  Loaded resume.txt");
} catch {
  console.log("ℹ️  No resume.txt found (optional).");
}
try {
  assignment = fs.readFileSync("./assignment.txt", "utf8");
  console.log("ℹ️  Loaded assignment.txt");
} catch {
  console.log("ℹ️  No assignment.txt found (optional).");
}
/* Store JD in memory (resets when you restart the server) */
let JOB_DESC = "";

/* Paste/Update JD from the browser */
app.post("/set-jd", (req, res) => {
  const jd = (req.body?.jd || "").toString();
  JOB_DESC = jd.slice(0, 20000); // simple size guard
  return res.json({ ok: true, length: JOB_DESC.length });
});

/* Mint ephemeral session token for the browser */
app.post("/session", async (_req, res) => {
  try {
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview",

        // ✅ We want audio IN (from your tab) but TEXT OUT only.
        // Realtime accepts your audio track via WebRTC regardless; limiting
        // modalities to ["text"] stops TTS/audio responses.
        modalities: ["text"],

        // Ensure PCM16 audio framing and server-side speech detection.
        input_audio_format: "pcm16",
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 1200, // a hair longer = cleaner turn splits
          create_response: true,
          interrupt_response: true,
        },

        // ✅ Use realtime-native transcription so we get clean transcript events.
        input_audio_transcription: { model: "gpt-4o-transcribe" },

        // ***** Tailoring instructions (JD + Resume) *****
       instructions: `
You are my live interview coach. I have uploaded my resume and HR screening call script, and you must read and memorize everything in them. Every answer you give should be as if you are me (Sam Oswald), always in first person, sounding confident, natural, and human-like — never robotic or AI-like. I will only give you keywords or short prompts instead of full questions during interview prep (for example, “intro” or “GA4”), and you must instantly understand the intended question and reply with a direct, detailed, ready-to-read answer that I can speak out loud in an interview. Priorities (top → bottom):

1) JOB DESCRIPTION (tailor to this first) and RESUME (use for concrete examples)
2) ASSIGNMENT (use when relevant)

If I ask for project examples, they must come from my resume but also be blended with the job description I provide, making them sound like live, real projects with clear business impact and measurable results so the interviewer has no doubts. Project answers should highlight my expertise in GA4 migration, SQL automation, Power BI dashboards, A/B testing, campaign optimization, churn prediction modeling, attribution frameworks, and cross-functional stakeholder collaboration. All answers must stay aligned with my resume and the job description I give you, showing my skills in data solutions, campaign analysis, dashboarding, and customer-centric analytics. You must also remember and reflect my voice style, including natural pauses and conversational fillers (“ahh,” “hmm”) where they fit, keeping the tone confident, friendly, and approachable. Whenever the interviewer asks me to “explain,” “walk me through,” or “get me through” something, or if the question is technical or related to the job description, always give a long, detailed, and clearly structured answer.

JOB DESCRIPTION (highest priority):
${JOB_DESC || "(JD not provided — give a strong general answer for the role based on resume)"}

RESUME (second priority for concrete evidence and examples):
${resume || "(no resume provided)"}

ASSIGNMENT (use if relevant, e.g., if interviewer asks about slides, deliverables, or project report):
${assignment || "(no assignment provided)"}
`.trim(),


      }),
    });

    const session = await r.json();
    res.json(session);
  } catch (e) {
    console.error("Session error:", e);
    res.status(500).json({ error: String(e) });
  }
});

app.listen(3000, () => {
  console.log("✅ Realtime server at http://localhost:3000");
  console.log("   Paste a JD in the UI (Save JD) to tailor answers.");
});
