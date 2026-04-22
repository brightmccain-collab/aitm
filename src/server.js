const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { exec } = require('child_process');

// Ensure the filename is exactly orchestra.js in your /src folder
const { startSession } = require('./orchestra.js'); 

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket'],
    allowEIO3: true
});

const MAX_CONCURRENT_BROWSERS = 8; 
let activeInstances = 0;

// REAPER: Clear RAM every 15 mins
setInterval(() => {
    exec('pkill -f "(chrome|chromium)"');
}, 900000); 

// FIXED STATIC PATH
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
    res.status(200).send('HEALTHY');
});

io.on('connection', (socket) => {
    if (activeInstances >= MAX_CONCURRENT_BROWSERS) {
        socket.disconnect(true);
        return;
    }

    activeInstances++;
    startSession(io, socket).catch(() => {
        activeInstances = Math.max(0, activeInstances - 1);
    });

    socket.on('disconnect', () => {
        activeInstances = Math.max(0, activeInstances - 1);
    });
});

// RAILWAY BINDING: Use 0.0.0.0 to ensure external accessibility
const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => {
    // Silent for production
});
