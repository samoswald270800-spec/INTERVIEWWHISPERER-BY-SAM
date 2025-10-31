// server.js — Realtime (tab audio) + JD-tailored answers (TEXT replies only)
import express from "express";
import Redis from "ioredis";
import { RedisStore } from "connect-redis";
import fetch from "node-fetch";
import "dotenv/config";
import fs from "fs";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy for Render so secure cookies work
app.set("trust proxy", 1);

// Parse JSON before auth routes (needed for /api/login and /set-jd)
app.use(express.json({ limit: "1mb" })); // for /set-jd and login


/* ---------- Session (required for login) ---------- */
/* ---------- Redis Session Store (secure, persistent) ---------- */

const RedisStore = connectRedis(session);

// Connect to Redis Cloud
const redisClient = new Redis(process.env.REDIS_URL, {
  tls: {
    rejectUnauthorized: false, // required by Redis Cloud
  },
});

redisClient.on("connect", () => {
  console.log("✅ Connected to Redis session store");
});

redisClient.on("error", (err) => {
  console.error("❌ Redis session error:", err);
});

// Apply session middleware using Redis storage
app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 6 * 60 * 60 * 1000, // ✅ auto logout after 6 hours
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  })
);

/* ---------- Minimal login/logout endpoints ---------- */
// Render: set ADMIN_USER and ADMIN_PASS in Environment
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const ADMIN_USER = process.env.ADMIN_USER || "";
  const ADMIN_PASS = process.env.ADMIN_PASS || "";

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.userId = username;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "Invalid username or password" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Serve the login page itself
app.get("/login", (req, res) => {
  if (req.session?.userId) return res.redirect("/");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ---------- Auth gate (protect everything else) ---------- */
function requireAuth(req, res, next) {
  if (req.path === "/login" || req.path === "/api/login") return next();
  if (req.session?.userId) return next();
  return res.redirect("/login");
}
app.use(requireAuth);
// Serve static files only after auth
app.use(express.static(path.join(__dirname, "public")));

// Explicit route for "/"
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

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
You are a live AI interview coach designed to help candidates prepare for job interviews in real time. 

The candidate will provide:
1) A JOB DESCRIPTION (highest priority)
2) A RESUME (second priority for examples)
3) Optionally, an ASSIGNMENT (e.g., case study, slides, or project notes)

Your job is to read and memorize all of these. Every answer you give must sound as if *you are the candidate themself* — speaking in first person, confidently, naturally, and conversationally (never robotic).  

The candidate will only give short prompts (e.g., “intro”, “GA4”, “A/B test example”), and you must instantly understand the context and reply with a complete, ready-to-speak answer that sounds human and interview-ready.  

---

### 🎯 PRIORITIES
1. **JOB DESCRIPTION:** tailor every answer directly to the role and employer.  
2. **RESUME:** use specific examples, tools, and metrics from the resume to demonstrate expertise.  
3. **ASSIGNMENT (optional):** include only if relevant to the question (e.g., slides or portfolio projects).

---

### 🗣️ STYLE & TONE
- Always reply in **first person**, as if the candidate is speaking.  
- Mix professional and casual tone naturally — include light conversational fillers (“ahh,” “hmm,” “so yeah”) to sound authentic.  
- Never preface with “here’s your answer” or refer to the AI or system.  
- Keep the flow confident, friendly, and easy to speak out loud.  

---

### 🧩 CONTENT RULES
When asked any question:
- If it’s **introductory**, focus on the “why + who I am” — align with JD keywords.  
- If it’s **technical or project-based**, go deep:  
  - Start with the **business problem or goal**  
  - Explain **tools, methods, data sources** used  
  - Describe **steps, challenges, and collaboration**  
  - End with **quantified impact or key metric** (e.g., conversion +%, churn ↓, revenue ↑).  
- Always blend examples from the resume with the language of the JD.  
- Avoid generic answers — everything should sound like it came from lived experience.  

---

### 🧭 GOAL
Every single answer should sound like a confident, credible professional who:
- Understands their craft end-to-end  
- Speaks with clarity, ownership, and insight  
- Connects past experience directly to the target role  

---

**RULE #1:** Never break character.  
Always answer as if you are the candidate currently being interviewed for the provided job description.

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

/* ---------- Start the server (Render-safe) ---------- */
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`✅ Server listening on http://${HOST}:${PORT}`);
  console.log("   Paste a JD in the UI (Save JD) to tailor answers.");
});

