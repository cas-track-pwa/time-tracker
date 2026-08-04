-- Initial schema for Time Tracker
-- Run this in Cloudflare D1

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Logs table
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    client TEXT NOT NULL,
    start DATETIME NOT NULL,
    end DATETIME NOT NULL,
    arrival DATETIME,
    startMs INTEGER,
    endMs INTEGER,
    arrivalMs INTEGER,
    duration TEXT,
    durationMs INTEGER,
    decimalHours TEXT,
    notes TEXT,
    parts TEXT,
    billableTime TEXT,
    arrivalTime TEXT,
    travelDurationMs INTEGER,
    onSiteDurationMs INTEGER,
    startMileage REAL,
    arrivalMileage REAL,
    travelMileage REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_start ON logs(start);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);