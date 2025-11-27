# Interview Whisperer

A professional AI-powered interview assistant built with React and Node.js.

## Features

- 🎙️ Real-time audio capture and transcription
- 🤖 AI-powered interview answers (Smart Mode & God Mode)
- 📊 Screen analysis with AI
- 💼 Job description tailoring
- 🎨 Modern glassmorphic UI with dark mode
- ⚡ Lightning-fast React frontend

## Tech Stack

- **Frontend**: React 18, Framer Motion, Vite
- **Backend**: Node.js, Express
- **AI**: OpenAI GPT-4 Realtime API
- **Storage**: Redis
- **Deployment**: Ready for Render, Vercel, Railway

## Quick Deploy

### Deploy to Render

1. Push to GitHub
2. Connect to Render
3. Set environment variables (see below)
4. Deploy!

### Environment Variables Required

```env
OPENAI_API_KEY=your_openai_api_key
REDIS_URL=your_redis_url
SESSION_SECRET=your_random_secret
ADMIN_USER=admin
ADMIN_PASS=your_password
PORT=3000
NODE_ENV=production
```

## Local Development

```bash
# Install dependencies
npm install

# Create .env file (copy from .env.example)
cp .env.example .env

# Start development server
npm run dev
```

Visit http://localhost:3000

## Build for Production

```bash
npm run build
npm start
```

## License

MIT
