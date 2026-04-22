const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { startSession } = require('./orchestrator');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static('../frontend'));

io.on('connection', (socket) => {
    console.log('New training session connection: ' + socket.id);
    startSession(io, socket);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`AiTM Research Server running on port ${PORT}`);
});
