const express = require("express");
const { SerialPort } = require("serialport");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { ReadlineParser } = require("@serialport/parser-readline");
const crc = require("crc");

const app = express();
const server = createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let activePorts = {};

const addCRC = (chunk) => {
    const checksum = crc.crc16ccitt(chunk).toString(16).padStart(4, "0");
    return `${chunk}${checksum}\n`; // เพิ่ม \n ในทุก chunk
};

const checkCRC = (data) => {
    if (data.length < 5) return false; // ต้องมี CRC + \n
    const message = data.slice(0, -5); // ตัด \n ออกก่อนตรวจสอบ
    const receivedCRC = data.slice(-5, -1); // ตัด \n ทิ้ง
    const calculatedCRC = crc.crc16ccitt(message).toString(16).padStart(4, "0");
    return receivedCRC === calculatedCRC;
};

io.on("connection", (socket) => {
    console.log("WebSocket connected");

    socket.on("get_ports", async () => {
        try {
            const ports = await SerialPort.list();
            socket.emit("ports_list", ports.map((port) => port.path));
        } catch (error) {
            console.error("Error listing serial ports:", error);
            socket.emit("ports_list", []);
        }
    });

    socket.on("open_port", ({ portName, baudRate }) => {
        if (activePorts[portName]) {
            console.log(`${portName} is already open.`);
            return;
        }

        const serialPort = new SerialPort({
            path: portName,
            baudRate: parseInt(baudRate),
            dataBits: 8,
            stopBits: 2,
            parity: "none",
            rtscts: true,
        });

        const parser = serialPort.pipe(new ReadlineParser({ delimiter: "\n" }));

        parser.on("data", (data) => {
            console.log(`Received from ${portName}: ${data}`);
            if (checkCRC(data)) {
                socket.emit("serial_data", { portName, data: data.slice(0, -5) });
                socket.emit("ack", { portName });
            } else {
                socket.emit("nack", { portName });
            }
        });

        activePorts[portName] = serialPort;
        console.log(`Opened ${portName} at ${baudRate} baud`);
    });

    socket.on("send_data", async ({ portName, message, chunkSize = 128 }) => {
        if (!activePorts[portName]) {
            socket.emit("send_error", { portName, error: "Port not open" });
            return;
        }

        const port = activePorts[portName];
        const dataBuffer = Buffer.from(message);
        let sentBytes = 0;
        let retries = 0;
        const maxRetries = 3;

        while (sentBytes < dataBuffer.length) {
            const chunk = dataBuffer.slice(sentBytes, sentBytes + chunkSize).toString();
            const chunkWithCRC = addCRC(chunk);
            let ackReceived = false;

            for (retries = 0; retries < maxRetries; retries++) {
                await new Promise((resolve, reject) => {
                    port.write(chunkWithCRC, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                console.log(`Sent chunk to ${portName}: ${chunkWithCRC}`);
                socket.emit("send_progress", { portName, sent: sentBytes, total: dataBuffer.length });

                ackReceived = await new Promise((resolve) => {
                    socket.once("ack", () => resolve(true));
                    socket.once("nack", () => resolve(false));
                    setTimeout(() => resolve(false), 500);
                });

                if (ackReceived) break; // ออกจาก loop หากได้รับ ACK
            }

            if (!ackReceived) {
                console.error(`Failed to send chunk after ${maxRetries} retries.`);
                socket.emit("send_error", { portName, error: "ACK timeout" });
                return;
            }

            sentBytes += chunk.length;
        }

        socket.emit("send_complete", { portName, totalSent: sentBytes });
        console.log(`Completed sending to ${portName}`);
    });

    socket.on("close_port", (portName) => {
        if (activePorts[portName]) {
            activePorts[portName].close(() => {
                console.log(`Closed ${portName}`);
                delete activePorts[portName];
            });
        }
    });

    socket.on("disconnect", () => {
        console.log("WebSocket disconnected");
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
