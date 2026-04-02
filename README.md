# 🔐 SecureChat — Encrypted Messaging App

A WhatsApp-like secure messaging application with end-to-end encryption, message integrity scoring, and tamper detection.

## Features

- **End-to-End Encryption** — RSA-2048 + AES-256-GCM hybrid encryption
- **Digital Signatures** — SHA-256 message signing & verification
- **SHA-256 Fingerprinting** — Cryptographic message fingerprints
- **Message Integrity Score (0–100)** — Real-time security badge per message
- **Tamper Detection** — Hash mismatch detection with red alert UI
- **Security Monitoring Panel** — Live security logs with event history
- **Real-time messaging** — Socket.IO with typing indicators & online status
- **OTP Authentication** — Email/SMS one-time password login

## Quick Start

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)

### 1. Backend Setup
```bash
cd Backend
cp .env.demo .env
# Fill in your .env values (MongoDB URI, JWT secret, email credentials)
npm install
npm run dev
```

### 2. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:3000`  
Backend runs at `http://localhost:5000`

## Easy Hosting

This repo now supports a single-service deployment shape:

- Build the frontend with `npm run build`
- Serve the compiled frontend from the backend in production
- Deploy the whole app as one Node service on Render or with Docker

### Render

`render.yaml` is included. Set these env vars in Render:

```env
NODE_ENV=production
PORT=5000
CLIENT_URL=https://your-render-domain.onrender.com
MONGO_URI=...
JWT_SECRET=...
RESEND_API_KEY=...
EMAIL_FROM=SecureChat <onboarding@resend.dev>
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE=...
GEMINI_API_KEY=...
```

### Docker

Build and run:

```bash
docker build -t secure-messaging-app .
docker run -p 5000:5000 --env-file Backend/.env secure-messaging-app
```

## Architecture

```
Backend (Node.js / Express)
├── REST API (auth, messages, users, security)
├── Socket.IO (real-time messaging, typing, presence)
├── MongoDB (users, messages, conversations, OTPs, security logs)
└── Crypto utils (RSA, AES, SHA-256, digital signatures)

Frontend (React + Vite)
├── Auth flow (OTP via email/SMS)
├── Chat UI (WhatsApp-style sidebar + message window)
├── Web Crypto API (browser-side encryption)
├── Security Panel (tamper alerts, integrity scores)
└── Socket client (real-time events)
```

## Message Integrity Score

Each message receives a score from 0–100:
| Check | Points |
|---|---|
| Digital Signature valid | +40 |
| SHA-256 Fingerprint matches | +30 |
| AES-GCM Auth Tag present | +30 |

- **100 = 🔒 SECURE**
- **60–99 = ⚠ WARNING**  
- **< 60 = 🚨 TAMPERED**

## Environment Variables

```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/secure_messaging
JWT_SECRET=your_secret_here
RESEND_API_KEY=re_your_resend_api_key
EMAIL_FROM=SecureChat <onboarding@resend.dev>
TWILIO_ACCOUNT_SID=...  (optional, for SMS)
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE=+1234567890
```
