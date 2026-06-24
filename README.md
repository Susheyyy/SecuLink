# SecuLink

SecuLink is a full-stack web application that provides a secure, expiring file sharing platform. It enables users to upload, encrypt, and share files, notes, or documents with custom expiration leases, password protection, geofencing, IP restrictions, email verification, and view-only permissions.

### ⚝ Features
- **Private & Secure Storage**: Files and text notes are encrypted inside your browser before uploading. The server never sees your passwords or unencrypted files.
- **Self-Destructing Links**: Set sharing links to automatically expire after a few minutes or hours.
- **Password Locked**: Secure files with custom access passwords so only authorized people can view them.
- **One-Time Downloads (Burn-on-Read)**: Make sharing links destroy themselves immediately after the file is downloaded once.
- **Country & Time Limits (Geofencing)**: Restrict file downloads to specific countries (e.g., India, Singapore, USA) or set active hours of the day when the link is available.
- **IP Address Lock**: Ensure only specific IP addresses can open your shared links.
- **Email Passcode Verification (OTP)**: Send a secure verification code directly to the recipient's email before letting them open the file.
- **Mobile QR Codes**: Instantly scan dynamic QR codes to access files securely from a smartphone.
- **Secure View-Only Mode**: Display documents directly in the browser with disabled download buttons, disabled right-click, and custom watermarks showing the recipient's IP.
- **Sensitive Data Scanner**: Scans and warns you automatically if you are uploading files containing credit cards, passwords, or API keys.
- **Activity & History Logs**: Track when sharing links are created, accessed, or shredded.
- **Emergency Wipe (System Nuke)**: A single click destroys all active file sharing allocations and wipes metadata from the database instantly.

### ⚝ Tech Stack
- Frontend: React.js, TypeScript, Custom Vanilla CSS, Lucide Icons
- Backend: Node.js, Express, Multer
- Database: SQLite, PostgreSQL, Sequelize ORM
- File Storage: Local Filesystem, Firebase Cloud Storage

### ⚝ System Architecture <br>
SecuLink is designed around zero-knowledge security and access control. The system is divided into five high-level areas:
- Frontend: The client-side application handles user interface rendering, theme management, local file previews, and browser-side encryption. Keys are derived locally in the browser using PBKDF2/WebCrypto APIs so that plain text payloads are never transmitted across the network.
- Encryption Layer: This layer manages the encryption and decryption processes. Payloads are encrypted using AES-256-GCM client-side. The metadata security envelopes are stored in the database, optionally encrypted with a server-managed master secret.
- Backend API: A Node.js Express server validates access constraints (expiry, IP boundaries, active time windows, country restrictions). It also coordinates automated malware scanning, SMTP email alerts, and the ephemeral chat messages.
- Database: Managed via Sequelize ORM, the database stores file records, expiration leases, chat histories, and audit logs. It supports SQLite for local testing and PostgreSQL for production.
- File Storage: Manages physical file assets. Files are written locally to the server's uploads folder using stream-based operations, or pushed to a Firebase Cloud Storage bucket.

```
SecuLink/
├── backend/                  # Node.js + Express backend 
│   ├── src/
│   │   ├── config/
│   │   │   └── database.ts   # Sequelize database connection configuration
│   │   ├── models/           
│   │   │   ├── file.ts       # File metadata schema & constraints
│   │   │   ├── index.ts      # Database connection & associations initializer
│   │   │   ├── log.ts        # Audit trails & logs schema
│   │   │   └── message.ts    # Secure ephemeral chat messages schema
│   │   ├── routes/
│   │   │   └── vault.ts      # Express routes for upload, challenge verification, download, and nuke
│   │   ├── services/         # Application core services
│   │   │   ├── cleanupService.ts # Cron-like service for purging expired files
│   │   │   ├── cryptoService.ts  # Verification helpers & secure envelopes
│   │   │   ├── databaseService.ts # DB operations manager for files, logs, and wipe operations
│   │   │   ├── emailService.ts   # SMTP service for sending OTP passcodes
│   │   │   ├── storageService.ts # Storage backend wrapper (Local & Firebase Storage)
│   │   │   └── virusScanService.ts # ClamAV/Sensitive data scanner (PII, API keys)
│   │   ├── server.ts         # Main entry point for backend API server
│   │   └── verify.ts         # Helper methods for security checks (IP, country, time, email OTP)
│   ├── package.json          # Node dependencies & scripts
│   └── tsconfig.json         # TypeScript compiler configurations
├── frontend/                 # React + TypeScript + Vite frontend 
│   ├── src/
│   │   ├── components/       
│   │   │   ├── ConsolePanel.tsx      # System console log dashboard & emergency wipe control
│   │   │   ├── DownloadChallenge.tsx # Verification gateway, decryption, & secure view-only mode
│   │   │   ├── UploadPanel.tsx       # File dropzone & security policy configuration panel
│   │   │   └── VaultStatus.tsx       # Live status tracker for active files & audit histories
│   │   ├── utils/
│   │   │   └── cryptoWorker.ts       # Web Worker for client-side PBKDF2/AES-256-GCM crypto
│   │   ├── App.css           
│   │   ├── App.tsx           
│   │   ├── index.css         
│   │   └── main.tsx          
│   ├── package.json          # Frontend dependencies & scripts
│   └── vite.config.ts        # Vite build tool and dev server config
└── README.md                 # Project documentation
```

### ⚝ Installation & Setup
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
   Create a .env file in the /backend folder:
   ```env
   PORT=5000
   NODE_ENV=development
   SECRET_KEY=your_32_character_master_secret_here
   FIREBASE_STORAGE_BUCKET=
   FIREBASE_SERVICE_ACCOUNT_KEY=
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your_email@gmail.com
   SMTP_PASS=your_app_specific_password_here
   EMAIL_FROM=noreply@seculink.com
   ```
   Run the backend server:
   ```bash
   npm run dev
   ```
3. Frontend Setup
   ```bash
   cd ../frontend
   npm install
   npm run dev
   ```

### ⚝ How to Use
- Upload Files: Drag and drop files or write a secure text note in the uploader dashboard.
- Configure Access Rules: Choose the expiration duration (compulsory) and customize other settings under Advanced Security Options (password, geofencing, IP lock, or OTP verification).
- Generate Secure Link: Click "Generate Link" to encrypt the file, create the database record, and display the private URL or dynamic QR code.
- Recipient Verification: The recipient accesses the private link, completes the password or OTP challenge, and downloads or views the file securely.
- Monitor and Purge: Track active allocations in the "Active Shares" panel, view audit logs, or trigger "Purge All Shares" to wipe everything immediately.

### ⚝ Live Demo

If you have feedback or ideas, feel free to reach out! <br>
If you like this project, consider giving it a star!
