'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { register } = require('./src/server/socketHandlers');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Service worker must not be cached so browsers always get the latest version
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public/sw.js'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/game', (req, res) => res.sendFile(path.join(__dirname, 'public/game.html')));

register(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`티츄 서버 실행 중: http://localhost:${PORT}`));
