const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { exec } = require('child_process');
const { startSession } = require('./orchestra.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket']
});

const MAX_CONCURRENT = 8;
let active = 0;

// REAPER: Clean zombie processes
setInterval(() => exec('pkill -f "(chrome|chromium)"'), 900000);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => res.send('HEALTHY'));

io.on('connection', (socket) => {
    if (active >= MAX_CONCURRENT) return socket.disconnect(true);
    active++;
    startSession(io, socket).catch(() => {}).finally(() => {
        socket.on('disconnect', () => { active = Math.max(0, active - 1); });
    });
});

server.listen(process.env.PORT || 8080, "0.0.0.0");
