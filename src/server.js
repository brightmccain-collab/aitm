const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { startSession } = require('./orchestrator');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io with strict WebSocket transport to avoid Railway 400 errors
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket'] 
});

// Suppress favicon 404s
app.get('/favicon.ico', (req, res) => res.status(204).end());

const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

io.on('connection', (socket) => {
    console.log(`[WS] Connection established: ${socket.id}`);
    startSession(io, socket);
    
    socket.on('disconnect', () => {
        console.log(`[WS] Connection closed: ${socket.id}`);
    });
});

app.use((req, res) => {
    console.warn(`[404] Not Found: ${req.url}`);
    res.status(404).send('Not Found');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[READY] Server live on port ${PORT}`);
});
