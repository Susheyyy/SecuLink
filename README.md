# SecuLink

SecuLink is a full-stack web application that provides a Zero-Knowledge Ephemeral File Vault. It allows users to securely encrypt, share, and auto-shred sensitive files (up to 50MB) with password protection and automated link expiration.

⚝ Features
- **Zero-Knowledge Envelope Encryption**: Payloads are encrypted locally using AES-256-GCM. File keys are encrypted using AES-256-CBC via a server-side Master Secret and stored in database envelopes.
- **Expiring Share Links**: Custom expiration leases (minutes or hours) that auto-invalidate links once exceeded.
- **Password Gatekeeper**: Access challenge using salted and hashed password protection via bcrypt.
- **Burn on Read Mode**: Optional single-download mode that shreds the payload immediately after the first successful download.
- **Security Audit Logs**: High-fidelity records tracking link creation, failed/successful accesses, and shred actions.
- **System Nuke**: Instant system-wide purge control to shred all active file shares and redact metadata immediately.
- **Auto-Delete Scheduler**: Background cron job scanning and unlinking expired resources from disk every 60 seconds.

⚝ Tech Stack:
- **Frontend**: React, TypeScript, Vanilla CSS
- **Backend**: Node.js, Express, Sequelize ORM
- **Database**: SQLite, PostgreSQL

⚝ Installation:
1. Clone the Repository
```bash
git clone https://github.com/Susheyyy/SecuLink.git
cd SecuLink
```
2. Backend Setup
```bash
cd backend
npm install
```
Create a `.env` file in the `/backend` folder:
```env
PORT=5000
SECRET_KEY=your_32_character_master_secret_here
# DATABASE_URL=your_production_postgres_connection_string
```
Start backend:
```bash
npm run dev
```
3. Frontend Setup
```bash
cd ../frontend
npm install
npm run dev
```

⚝ How to Use
- **Upload File**: Drag and drop or browse files (up to 50MB) inside the dashboard.
- **Customize Parameters**: Adjust the expiration lease duration, set an access password, or enable one-time download (Burn on Read).
- **Generate Link**: Click "Generate Link" to encrypt and save the payload, generating a unique sharing URL.
- **Monitor Shares**: Track files, copy active sharing links, or view their security logs on the "Active Shares" tab.
- **View Activity Log**: Access developer logs of all system transactions on the "Activity Log" tab.
- **Emergency Wipe**: Trigger "Purge All Shares" in the active shares panel to shred all active payloads and redact records instantly.

If you have feedback or ideas, feel free to reach out!
If you like this project, consider giving it a star!
