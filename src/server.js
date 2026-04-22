const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { startSession } = require('./orchestrator');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('../frontend'));

io.on('connection', (socket) => {
    console.log('New training session connection: ' + socket.id);
    startSession(io, socket);
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`AiTM Research Server running on http://localhost:${PORT}`);
});
