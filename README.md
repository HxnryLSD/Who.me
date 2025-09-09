# Who.Me

Who.Me is a personal website with a dashboard UI, login/registration, and customizable user profile pages. Users can add their info (full name, birthday, city, workplace, bio) and curate a grid of links that render with DuckDuckGo favicons to look like app icons. Public profiles are available under `/u/:username`.

## Stack
- Node.js + Express
- EJS templates
- Passport (Local) authentication
- better-sqlite3 for persistent storage
- express-session with SQLite store
- Helmet for security headers

## Features
- Registration, Login, Logout
- Dashboard to edit profile and manage links (drag to reorder)
- Public profile page with link grid and favicons from DuckDuckGo
- Simple modern styling

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Run the app in development mode:
```bash
npm run dev
```

3. Open the app:
- http://localhost:3000
- After registering and logging in, visit your public page at `/u/<username>`

## Configuration
Environment variables (optional):
- `PORT` - default `3000`
- `SESSION_SECRET` - secret for sessions (defaults to a dev value). Set this in production.

## Data Storage
SQLite database and session store files are created in the `data/` directory.

## Security Notes
- Helmet enforces CSP allowing images from `https://icons.duckduckgo.com` for favicons.
- Passwords are hashed using bcrypt.

## License
Apache-2.0 license
