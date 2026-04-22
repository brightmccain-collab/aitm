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

app.get('/favicon.ico', (req, res) => res.status(204).end());

const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

io.on('connection', (socket) => {
    console.log(`[WS] Connection Established: ${socket.id}`);
    startSession(io, socket);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SYSTEM] Live on Port ${PORT}`);
});
