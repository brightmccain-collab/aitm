const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { startSession } = require('./orchestrator');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io with broad CORS for the research lab
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

/**
 * FIX: Absolute Pathing
 * Railway executes the 'start' command from the root folder.
 * __dirname ensures we point to /src, and '../frontend' points to the sibling folder.
 */
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

console.log(`[INIT] Serving static files from: ${frontendPath}`);

io.on('connection', (socket) => {
    console.log(`[WS] New training session connection: ${socket.id}`);
    
    // Start the Puppeteer orchestrator for this specific socket
    startSession(io, socket);
    
    socket.on('disconnect', () => {
        console.log(`[WS] User disconnected: ${socket.id}`);
    });
});

// Debug middleware to help identify missing files in the Railway logs
app.use((req, res) => {
    console.warn(`[404] Resource not found: ${req.url}`);
    res.status(404).send('Resource not found. Check the Railway console logs.');
});

/**
 * FIX: Network Binding
 * Railway requires listening on 0.0.0.0 and using the dynamic process.env.PORT
 */
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[READY] AiTM Research Server live on port ${PORT}`);
});
