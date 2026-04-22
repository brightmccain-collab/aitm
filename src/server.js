const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { startSession } = require('./orchestrator');

const app = express();
const server = http.createServer(app);

// Anchor Socket.io to the HTTP server correctly
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket']
});

// Mute favicon 404 noise
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Use process.cwd() for absolute pathing in Railway containers
const frontendPath = path.resolve(process.cwd(), 'frontend');
console.log(`[SYSTEM] Serving UI from: ${frontendPath}`);
app.use(express.static(frontendPath));

// Explicit root route
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

io.on('connection', (socket) => {
    console.log(`[WS] Connection Established: ${socket.id}`);
    startSession(io, socket);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SYSTEM] Production server listening on port ${PORT}`);
});
