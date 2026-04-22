const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { startSession } = require('./orchestrator');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket']
});

// RESOURCE CONTROL: Railway 512MB/1GB RAM cannot handle many browsers.
let activeSessions = 0;
const MAX_SESSIONS = 6; 

app.get('/favicon.ico', (req, res) => res.status(204).end());

const frontendPath = path.resolve(process.cwd(), 'frontend');
app.use(express.static(frontendPath));

app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

io.on('connection', (socket) => {
    if (activeSessions >= MAX_SESSIONS) {
        console.log("[REJECTED] Memory Safeguard: Max browser instances reached.");
        socket.emit('error', 'Server busy. Try again in a minute.');
        socket.disconnect();
        return;
    }

    activeSessions++;
    console.log(`[WS] Connected: ${socket.id} | Active Browsers: ${activeSessions}`);
    
    startSession(io, socket);

    socket.on('disconnect', () => {
        activeSessions--;
        console.log(`[WS] Disconnected: ${socket.id} | Remaining: ${activeSessions}`);
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SYSTEM] Server listening on port ${PORT}`);
});
