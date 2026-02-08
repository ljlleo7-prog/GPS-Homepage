# Geeks Production Studio (GPS) Homepage

Official homepage for Geeks Production Studio, a modern web platform featuring a gamified community economy, mission systems, and integrated support markets. Built with React, Vite, and Supabase.

## 🚀 Features

### 💎 Economy System
- **Dual Currency**: 
  - **Tokens (TKN)**: Transferable currency for trading and rewards.
  - **Reputation (REP)**: Non-transferable score tracking community contribution.
- **Wallet**: Integrated wallet system with real-time balance tracking.
- **Ledger**: Append-only audit trail for all transactions.
- **Daily Login Bonus**: Earn tokens daily based on your current reputation tier.

### 🎮 Gamification & Missions
- **Mission Center**: Complete community tasks (Feedback, Playtests, Ideas) to earn rewards.
- **Variable Rewards**: Dynamic token rewards with developer-authorized payouts.
- **Reputation Gating**: 
  - **>30 REP**: Access to Missions.
  - **>50 REP**: Access to Support Markets and Ticket Trading.
  - **>70 REP**: Ability to launch User Campaigns and create markets.

### 📈 Markets
- **Support Markets**: Invest in community outcomes via Bonds, Index Funds, and Milestone instruments.
- **Ticket Market**: Peer-to-peer trading of outcome tickets with atomic transactions and password protection.
- **User Campaigns**: High-reputation users can launch their own betting markets or missions.

### 🌐 Community & Content
- **Bilingual Support**: Full English and Chinese (Simplified) localization.
- **Forum**: Community discussions with developer-sponsored rewards (Rep > 50 to post).
- **News & Updates**: Integrated news feed with comment system.
- **SSO**: Cross-subdomain Single Sign-On for seamless access across DeltaDash and other GPS services.

## 🛠 Tech Stack

- **Frontend**: React 18, Vite, TypeScript
- **Styling**: Tailwind CSS, Framer Motion, Lucide React
- **Backend / Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth with Custom SSO
- **State Management**: Zustand, React Context
- **Internationalization**: i18next

## 📦 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/gps-homepage.git
   cd gps-homepage
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   Create a `.env` file in the root directory with your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

4. **Run Development Server**
   ```bash
   npm run dev
   ```

## 🗄️ Database Setup

The project uses Supabase as the backend. SQL migrations are located in the `supabase/migrations` directory.

Key schemas include:
- `wallets`, `ledger_entries` (Economy)
- `missions`, `submissions` (Mission Control)
- `support_instruments`, `positions` (Markets)
- `forum_posts`, `forum_comments` (Community)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

© 2026 Geeks Production Studio. All Rights Reserved.
