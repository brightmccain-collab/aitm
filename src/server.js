const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { exec } = require('child_process');

// Ensure the filename here matches your actual file (orchestra.js vs orchestrator.js)
const { startSession } = require('./orchestra.js'); 

const app = express();
const server = http.createServer(app);

// Socket.io Configuration for Production
const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket'],
    allowEIO3: true
});

// --- SCALING & RAM MANAGEMENT ---
const MAX_CONCURRENT_BROWSERS = 8; 
let activeInstances = 0;

// REAPER: Clears zombie chrome processes every 15 mins
setInterval(() => {
    exec('pkill -f "(chrome|chromium)"', (err) => {
        // Silent in production
    });
}, 900000); 

// --- STATIC ASSETS (The 404 Fix) ---
// This assumes your structure is: src/server.js and src/public/index.html
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
    res.status(200).send('HEALTHY');
});

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    if (activeInstances >= MAX_CONCURRENT_BROWSERS) {
        socket.emit('error', 'SERVER_FULL');
        socket.disconnect(true);
        return;
    }

    activeInstances++;

    // Launch Puppeteer via orchestra.js
    startSession(io, socket).catch((err) => {
        activeInstances = Math.max(0, activeInstances - 1);
    });

    socket.on('disconnect', () => {
        activeInstances = Math.max(0, activeInstances - 1);
    });
});

// --- START ---
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    // Console logs removed for production stealth
});
