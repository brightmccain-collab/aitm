const { startSession } = require('./orchestrator'); // Must use curly braces
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');


const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket']
});

// 1. Resolve the absolute path to the frontend folder
const frontendPath = path.resolve(__dirname, '..', 'frontend');
console.log(`[SYSTEM] Attempting to serve static files from: ${frontendPath}`);

// 2. Serve the static files
app.use(express.static(frontendPath));

// 3. Root Route Fallback (If static serving fails)
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'), (err) => {
        if (err) {
            console.error(`[ERROR] Could not find index.html at ${frontendPath}`);
            res.status(404).send(`Server is live, but index.html is missing at ${frontendPath}`);
        }
    });
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

io.on('connection', (socket) => {
    console.log(`[WS] Connection Established: ${socket.id}`);
    startSession(io, socket);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SYSTEM] Production server listening on port ${PORT}`);
});
