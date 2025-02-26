const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const socketHandler = require(__dirname + "/src/routes/socketHandler");
const app = express();
const server = createServer(app);
const io = new Server(server);

app.use(express.static("public"));
io.on("connection", socketHandler);

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/public/index.html");
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
