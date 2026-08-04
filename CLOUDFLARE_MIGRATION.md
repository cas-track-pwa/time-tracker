# Cloudflare Workers Migration

This branch contains the migration path for moving the Time Tracker from IndexedDB-only to Cloudflare Workers with D1 database and KV storage.

## Architecture Overview

### Current (main branch)
- IndexedDB only (client-side storage)
- No user authentication
- Data is device-specific

### New (this branch)
- Cloudflare Workers (API layer)
- D1 Database (SQLite for logs and users)
- KV Storage (session tokens)
- User authentication (email/password)
- Cross-device sync

## Deployment Steps

### 1. Set up Cloudflare Account
```bash
# Install Wrangler
npm install -g @cloudflare/wrangler

# Authenticate
wrangler login
```

### 2. Create D1 Database
```bash
# Create database
wrangler d1 create time-tracker

# Apply schema
wrangler d1 execute time-tracker --local < migrations/001_initial.sql
```

### 3. Create KV Namespace
```bash
# Create namespace
wrangler kv:namespace create "TIME_TRACKER_KV"
```

### 4. Configure wrangler.toml
Update `wrangler.toml` with your:
- Account ID
- Zone ID (if using custom domain)
- D1 database ID
- KV namespace ID

### 5. Deploy
```bash
# Deploy to workers.dev
wrangler deploy

# Or deploy to custom domain
wrangler deploy --zone yourdomain.com
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login existing user
- `POST /api/auth/logout` - Logout user

### Logs
- `GET /api/logs` - Get all logs for authenticated user
- `POST /api/logs` - Create new log
- `GET /api/logs/:id` - Get specific log
- `PUT /api/logs/:id` - Update log
- `DELETE /api/logs/:id` - Delete log

## Client-Side Changes Required

### 1. Update API Base URL
```javascript
// In app.js
const API_BASE = 'https://your-worker-subdomain.workers.dev';
```

### 2. Add Authentication Flow
```javascript
// Login flow
async function login(email, password) {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (data.token) {
        localStorage.setItem('authToken', data.token);
    }
    return data;
}
```

### 3. Add Authorization Header
```javascript
// All API requests
const token = localStorage.getItem('authToken');
const response = await fetch(url, {
    headers: {
        'Authorization': `Bearer ${token}`
    }
});
```

### 4. Replace IndexedDB with API Calls
```javascript
// Instead of:
// const transaction = db.transaction(["logs"], "readwrite");
// const store = transaction.objectStore("logs");

// Use:
// await fetch(`${API_BASE}/api/logs`, { method: 'POST', body: JSON.stringify(logData) });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Secret key for JWT token signing |
| `TIME_TRACKER_KV` | KV namespace binding |
| `DB` | D1 database binding |

## Cost Estimate (2 users, ~10 entries/day)

| Service | Free Tier | Estimated Usage | Cost |
|---------|-----------|-----------------|------|
| Workers | 100K req/day | ~500 req/day | $0 |
| D1 | 500K queries/month | ~9K queries/month | $0 |
| KV | 1M reads/day | Minimal | $0 |
| Bandwidth | 10GB/month | ~100MB/month | $0 |

**Total: $0/month**

## Security Considerations

1. **Password Hashing**: Replace placeholder with bcrypt/argon2
2. **JWT Security**: Use proper JWT library with HS256/RS256
3. **HTTPS**: All traffic is encrypted by default on Cloudflare
4. **CORS**: Configure allowed origins in wrangler.toml
5. **Rate Limiting**: Add rate limiting middleware

## Testing Locally

```bash
# Start local development
wrangler dev

# Run database migrations locally
wrangler d1 execute time-tracker --local < migrations/001_initial.sql
```

## Production Checklist

- [ ] Update JWT_SECRET to a secure random value
- [ ] Configure custom domain (optional)
- [ ] Set up SSL certificate (automatic with Cloudflare)
- [ ] Configure CORS for your domain
- [ ] Add rate limiting
- [ ] Set up monitoring/alerts
- [ ] Test authentication flow
- [ ] Test data sync between devices
- [ ] Update privacy policy for cloud storage