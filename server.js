//server.js基ファイル
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static('public'));

io.on('connection', (socket) => {
  // Chat functionality (for index.html)
  socket.on('user connected', (clientId) => {
    socket.clientId = clientId;
    console.log(clientId + ' connected');
    socket.emit('welcome', clientId);
    socket.broadcast.emit('user joined', clientId);
  });

  socket.on('chat message', (msg) => {
    io.emit('chat message', msg);
  });
  
  // Room functionality (for sensor apps)
  socket.on('join', (room) => {
    socket.join(room);
    console.log(`Client joined room: ${room}`);
  });
  
  // Sensor data handling
  socket.on('sensor', (data) => {
    // センサーデータを'game'ルームにいる他のクライアントに送信する
    socket.to('game').emit('sensor', data);
  });

  socket.on('disconnect', () => {
    if (socket.clientId) {
      console.log(socket.clientId + ' disconnected');
      io.emit('user left', socket.clientId);
    } else {
      console.log('Client disconnected');
    }
  });
});

server.listen(8080, () => {
  console.log('listening on *:8080');
});