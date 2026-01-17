# 🎬 CottMV - Cottage Media Vault

A beginner-friendly home media vault for streaming your personal media collection. Inspired by Jellyfin but intentionally simpler and easier to understand.

## ✨ Features

- **Media Streaming** - Stream video, audio, and view images directly in the browser
- **On-Demand Transcoding** - Automatically converts incompatible formats using FFmpeg
- **Smart Caching** - Transcoded files are cached with configurable TTL
- **Cloud Backup** - Mirror your media to Cloudflare R2 for safekeeping
- **Clean UI** - Simple, modern interface built with Tailwind CSS
- **Admin Settings** - Configure everything through the web UI
- **GitHub OAuth** - Secure authentication with GitHub accounts
- **Role-Based Access** - Admin and user roles for access control
- **Media Filtering** - Filter by type (video, audio, image, document) and format
- **External Metadata** - Fetch metadata from TMDB, MusicBrainz, and Open Library

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | [Bun](https://bun.sh) |
| Language | TypeScript |
| Backend/Database | [Convex](https://convex.dev) |
| Web Framework | [Hono](https://hono.dev) |
| Video Processing | FFmpeg |
| Object Storage | Cloudflare R2 |
| Styling | Tailwind CSS |
| Authentication | GitHub OAuth |

## 📋 Prerequisites

Before you begin, make sure you have:

1. **Bun** installed ([install guide](https://bun.sh/docs/installation))
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Node.js 20+** (required for Convex CLI)
   ```bash
   # Using nvm (recommended)
   nvm install 20
   nvm use 20
   
   # Or download from nodejs.org
   ```

3. **FFmpeg** installed for video transcoding
   ```bash
   # Ubuntu/Debian
   sudo apt install ffmpeg
   
   # macOS
   brew install ffmpeg
   
   # Windows (with Chocolatey)
   choco install ffmpeg
   ```

4. **Convex account** (free tier available)
   - Sign up at [convex.dev](https://convex.dev)

5. **GitHub OAuth App** (for authentication)
   - Create at [github.com/settings/developers](https://github.com/settings/developers)

## 🚀 Quick Start

### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/yourusername/cottmv.git
cd cottmv

# Install dependencies
bun install
```

### 2. Set Up Convex

```bash
# Log in to Convex (opens browser)
bunx convex login

# Initialize Convex for this project
bunx convex dev --once
```

This creates a new Convex project and generates the `convex/_generated` folder.

### 3. Set Up GitHub OAuth

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in the details:
   - **Application name**: CottMV (or your preferred name)
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://localhost:3000/auth/github/callback`
4. Click "Register application"
5. Copy the **Client ID**
6. Generate a new **Client Secret** and copy it

### 4. Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your credentials:
# - CONVEX_URL (from Convex dashboard)
# - GITHUB_CLIENT_ID (from GitHub OAuth app)
# - GITHUB_CLIENT_SECRET (from GitHub OAuth app)
# - APP_URL (http://localhost:3000 for development)
```

### 5. Build CSS

```bash
# Build Tailwind CSS
bun run build:css
```

### 6. Start the Server

```bash
# Development mode (with hot reload)
bun run dev

# Or production mode
bun run build
bun run start
```

Visit `http://localhost:3000` to see your media vault!

## 📁 Project Structure

```
cottmv/
├── convex/                 # Convex backend
│   ├── schema.ts          # Database schema
│   ├── media.ts           # Media CRUD operations
│   ├── settings.ts        # Settings management
│   ├── cache.ts           # Cache tracking
│   ├── users.ts           # User management
│   └── sessions.ts        # Session management
├── src/
│   ├── server/            # Hono web server
│   │   ├── index.ts       # Server entry point
│   │   ├── routes/        # API and page routes
│   │   ├── auth/          # Authentication
│   │   │   ├── github.ts  # GitHub OAuth helpers
│   │   │   └── middleware.ts # Auth middleware
│   │   └── templates/     # HTML templates
│   ├── media/             # Media processing
│   │   ├── transcoder.ts  # FFmpeg transcoding
│   │   ├── cleanup.ts     # Cache cleanup
│   │   └── utils.ts       # Media type utilities
│   ├── metadata/          # External metadata APIs
│   │   ├── index.ts       # Unified metadata service
│   │   ├── tmdb.ts        # TheMovieDB integration
│   │   ├── musicbrainz.ts # MusicBrainz integration
│   │   └── openlibrary.ts # Open Library integration
│   └── storage/           # Storage integrations
│       └── r2.ts          # Cloudflare R2 client
├── public/                # Static files
│   └── css/               # Tailwind CSS
├── scripts/               # Utility scripts
│   └── cleanup.ts         # Cache cleanup script
└── media/                 # Your media files (gitignored)
```

## 🎯 Usage Guide

### Authentication

1. Visit the app and click "Sign in with GitHub"
2. Authorize the OAuth app
3. You'll be redirected back and logged in

### Admin Access

To grant admin access to a user:

1. Log in as an existing admin (first user is auto-admin)
2. Go to Settings → Admin Settings
3. Add GitHub usernames to the admin list (comma-separated)

### Adding Media

1. Place your media files in the `media/` directory (or configure a different path in settings)
2. Click "Scan for New Media" on the home page
3. Your files will appear in the library

### Filtering and Sorting

- Use the type tabs to filter by media type (Video, Audio, Image, etc.)
- Use the sort dropdown to order by title, date, size, or year
- Use the format dropdown to filter by file extension

### Fetching Metadata

1. Click "Fetch Metadata" on the library page to batch-fetch metadata for all items
2. Or click "Fetch Metadata" on individual media pages
3. Metadata is fetched from:
   - **TMDB** for movies and TV shows (requires API key)
   - **MusicBrainz** for music (no API key required)
   - **Open Library** for books/documents (no API key required)

### Streaming Videos

- Click any video to start watching
- Use the quality selector to choose between 480p, 720p, 1080p, or original
- Videos are automatically transcoded if needed for browser compatibility

### Admin Settings

Visit `/admin` (admin users only) to configure:

- **Media Directory** - Where to scan for media
- **Admin Usernames** - GitHub usernames with admin access
- **Metadata API Keys** - TMDB API key for movie/TV metadata
- **Cache Settings** - Max size and TTL for transcoded files
- **R2 Backup** - Cloudflare R2 credentials for cloud backup
- **Transcoding** - Default quality and format settings

### Cache Cleanup

Transcoded files are automatically cleaned up based on TTL. You can also:

- Run cleanup manually from the admin page
- Schedule automatic cleanup with cron:
  ```bash
  # Run cleanup every hour
  0 * * * * cd /path/to/cottmv && bun run cleanup
  ```

## ☁️ Cloudflare R2 Setup (Optional)

To enable cloud backup:

1. Create a Cloudflare account and enable R2
2. Create an R2 bucket
3. Generate API tokens with R2 read/write permissions
4. Enter credentials in the admin settings

## 🔧 Configuration Options

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `CONVEX_URL` | Convex deployment URL | Required |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID | Required |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret | Required |
| `APP_URL` | Application URL | `http://localhost:3000` |
| `TMDB_API_KEY` | TheMovieDB API key | Optional |

### Settings (via Admin UI)

| Setting | Description | Default |
|---------|-------------|---------|
| `media_directory` | Path to scan for media | `./media` |
| `admin_usernames` | GitHub usernames with admin access | First user |
| `cache_max_size_gb` | Maximum cache size | `10` GB |
| `cache_ttl_hours` | Cache expiration time | `24` hours |
| `default_video_quality` | Default transcode quality | `720p` |
| `transcode_format` | Output format | `mp4` |

## 📊 Supported Media Types

| Type | Extensions |
|------|------------|
| Video | .mp4, .mkv, .avi, .mov, .wmv, .flv, .webm, .m4v |
| Audio | .mp3, .wav, .flac, .aac, .ogg, .m4a, .wma |
| Image | .jpg, .jpeg, .png, .webp, .bmp, .tiff |
| GIF | .gif |
| Document | .pdf, .epub, .mobi |

## 📚 Understanding the Code

This project is designed to be beginner-friendly. Here's how to explore:

1. **Start with the schema** - `convex/schema.ts` defines the data structure
2. **Follow the routes** - `src/server/routes/` shows how requests are handled
3. **Understand transcoding** - `src/media/transcoder.ts` explains FFmpeg usage
4. **Learn about R2** - `src/storage/r2.ts` demonstrates S3-compatible storage
5. **Explore auth** - `src/server/auth/` shows GitHub OAuth implementation
6. **Check metadata** - `src/metadata/` shows external API integrations

Each file includes detailed comments explaining:
- What the code does
- Why it's structured that way
- Key concepts for beginners

## 🐛 Troubleshooting

### "Cannot find module 'convex/_generated/api'"

Run `bunx convex dev --once` to generate the Convex types.

### GitHub OAuth errors

- Verify your callback URL matches exactly: `http://localhost:3000/auth/github/callback`
- Check that client ID and secret are correct
- Ensure APP_URL matches your actual URL

### Videos won't play

- Check that FFmpeg is installed: `ffmpeg -version`
- Ensure the video file exists and is readable
- Check browser console for errors

### Transcoding is slow

- Transcoding is CPU-intensive; first-time playback may take a while
- Once cached, subsequent plays are instant
- Consider pre-transcoding popular videos

### R2 connection fails

- Verify your endpoint URL format: `https://ACCOUNT_ID.r2.cloudflarestorage.com`
- Check that API tokens have correct permissions
- Ensure bucket name is correct

### Metadata not fetching

- For movies/TV: Ensure TMDB_API_KEY is set in environment or admin settings
- For music: MusicBrainz has rate limiting (1 request/second)
- Check that filenames are parseable (e.g., "Movie Name (2023).mp4")

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with clear comments
4. Submit a pull request

## 📄 License

MIT License - feel free to use this for personal or commercial projects.

## 🙏 Acknowledgments

- [Jellyfin](https://jellyfin.org) for inspiration
- [Convex](https://convex.dev) for the excellent backend platform
- [Hono](https://hono.dev) for the lightweight web framework
- [Tailwind CSS](https://tailwindcss.com) for beautiful styling utilities
- [TheMovieDB](https://www.themoviedb.org) for movie/TV metadata
- [MusicBrainz](https://musicbrainz.org) for music metadata
- [Open Library](https://openlibrary.org) for book metadata
