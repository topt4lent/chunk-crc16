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
let pendingAcks = {}; // Store pending ACKs for each port

// Helper function to add CRC
const addCRC = (chunk) => {
    const checksum = crc.crc16ccitt(chunk).toString(16).padStart(4, "0");
    return `${chunk}${checksum}\n`; 
};

// Helper function to check CRC
const checkCRC = (data) => {
    if (data.length < 5) return false;
    const message = data.slice(0, -5);
    const receivedCRC = data.slice(-5, -1);
    const calculatedCRC = crc.crc16ccitt(message).toString(16).padStart(4, "0");
    return receivedCRC === calculatedCRC;
};

// WebSocket connection
io.on("connection", (socket) => {
    console.log("WebSocket connected");

    // Get available serial ports
    socket.on("get_ports", async () => {
        try {
            const ports = await SerialPort.list();
            socket.emit("ports_list", ports.map((port) => port.path));
        } catch (error) {
            console.error("Error listing serial ports:", error);
            socket.emit("ports_list", []);
        }
    });

    // Open serial port
    socket.on("open_port", ({ portName, baudRate }) => {
        if (activePorts[portName]) {
            console.log(`${portName} is already open.`);
            socket.emit("port_opened", { portName });
            return;
        }

        try {
            const serialPort = new SerialPort({
                path: portName,
                baudRate: parseInt(baudRate),
                dataBits: 8,
                stopBits: 2,
                parity: "none",
                rtscts: true,
            });

            const parser = serialPort.pipe(new ReadlineParser({ delimiter: "\n" }));

            // Listen for incoming data
            parser.on("data", (data) => {
                console.log(`Received from ${portName}: ${data}`);
                if (checkCRC(data)) {
                    socket.emit("serial_data", { portName, data: data.slice(0, -5) });

                    // Notify the sender if they are waiting for an ACK
                    if (pendingAcks[portName]) {
                        pendingAcks[portName](true);
                        delete pendingAcks[portName];
                    }

                    socket.emit("ack", { portName });
                } else {
                    socket.emit("nack", { portName });

                    // Notify sender if waiting for ACK
                    if (pendingAcks[portName]) {
                        pendingAcks[portName](false);
                        delete pendingAcks[portName];
                    }
                }
            });

            serialPort.on("error", (err) => {
                console.error(`Error on ${portName}:`, err.message);
                socket.emit("port_error", { portName, error: err.message });
            });

            serialPort.on("close", () => {
                console.log(`Serial port ${portName} closed`);
                delete activePorts[portName];
            });

            activePorts[portName] = serialPort;
            console.log(`Opened ${portName} at ${baudRate} baud`);
            socket.emit("port_opened", { portName });
        } catch (error) {
            console.error(`Failed to open ${portName}:`, error.message);
            socket.emit("port_error", { portName, error: error.message });
        }
    });

    // Send data with CRC and wait for ACK
    socket.on("send_data", async ({ portName, message, chunkSize = 128 }) => {
        if (!activePorts[portName]) {
            socket.emit("send_error", { portName, error: "Port not open" });
            return;
        }

        const port = activePorts[portName];
        const dataBuffer = Buffer.from(message);
        let sentBytes = 0;
        const maxRetries = 3;

        while (sentBytes < dataBuffer.length) {
            const chunk = dataBuffer.slice(sentBytes, sentBytes + chunkSize).toString();
            const chunkWithCRC = addCRC(chunk);
            let ackReceived = false;

            for (let retries = 0; retries < maxRetries; retries++) {
                await new Promise((resolve, reject) => {
                    port.write(chunkWithCRC, (err) => {
                        if (err) {
                            reject(err);
                        } else {
                            console.log(`Sent chunk to ${portName}: ${chunkWithCRC}`);
                            resolve();
                        }
                    });
                });

                socket.emit("send_progress", { portName, sent: sentBytes, total: dataBuffer.length });

                // Wait for ACK
                ackReceived = await new Promise((resolve) => {
                    pendingAcks[portName] = resolve;
                    setTimeout(() => resolve(false), 500);
                });

                if (ackReceived) break;
                console.warn(`Retry ${retries + 1}/${maxRetries} for ${portName}`);
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

    // Close serial port
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

// Start server
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
