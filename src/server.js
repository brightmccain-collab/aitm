const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { exec } = require('child_process');
const { startSession } = require('./orchestra'); // Ensure path is correct

const app = express();
const server = http.createServer(app);

// PRODUCTION CONFIG: 
// Force WebSocket transport for Railway stability
const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket'],
    allowEIO3: true
});

// --- SCALING CONFIG ---
const MAX_CONCURRENT_BROWSERS = 8; // Increased from 2 to handle traffic spikes
let activeInstances = 0;

/**
 * THE REAPER: Every 15 minutes, force-kill any ghost Chrome processes 
 * that didn't close properly to reclaim locked RAM.
 */
setInterval(() => {
    exec('pkill -f "(chrome|chromium)"', (err) => {
        if (!err) {
            // Silently log only if you are monitoring the dashboard
            // console.log('[REAPER] Memory Purged');
        }
    });
}, 900000); 

// --- STATIC ASSETS ---
app.use(express.static('public'));

app.get('/health', (req, res) => {
    res.status(200).send('NODE_ACTIVE');
});

// --- SOCKET HANDLER ---
io.on('connection', (socket) => {
    // Memory Safeguard
    if (activeInstances >= MAX_CONCURRENT_BROWSERS) {
        // console.log('[REJECTED] Capacity Reached');
        socket.emit('error', 'SERVER_BUSY');
        socket.disconnect(true);
        return;
    }

    activeInstances++;
    // console.log(`[WS] New Client: ${socket.id} | Active: ${activeInstances}`);

    // Delegate session logic to orchestra.js
    startSession(io, socket).catch(() => {
        activeInstances = Math.max(0, activeInstances - 1);
    });

    socket.on('disconnect', () => {
        activeInstances = Math.max(0, activeInstances - 1);
        // console.log(`[WS] Client Exit. Remaining: ${activeInstances}`);
    });
});

// --- START SERVER ---
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    // console.log(`[SYSTEM] Production Node Listening on ${PORT}`);
});
