const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
// Ensure the path and name match your export in orchestra.js
const { startSession } = require('./orchestra');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
    res.send('Server is running');
});

io.on('connection', (socket) => {
    console.log("Session Start Requested - ID:", socket.id);

    // Safeguard to prevent 'startSession is not a function' crash
    if (typeof startSession === 'function') {
        startSession(io, socket).catch(err => {
            console.error("Internal Session Error:", err);
            socket.emit('error', 'Critical script failure');
        });
    } else {
        console.error("EXPORT ERROR: startSession is not defined in orchestra.js");
        socket.emit('error', 'Module import failure');
    }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
