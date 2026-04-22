const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { startSession } = require('./orchestra.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket']
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    console.log('Session Start Requested');
    startSession(io, socket).catch(err => console.log("Session Error:", err));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
});
