const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

let activePorts = {};
let pendingAcks = {}; // Store pending ACKs for each port

const openPort = (portName, baudRate) => {
    if (activePorts[portName]) {
        console.log(`${portName} is already open.`);
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
        serialPort.on("data", (data) => {
            // Add serial port data handling logic
        });

        serialPort.on("error", (err) => {
            console.error(`Error on ${portName}:`, err.message);
        });

        serialPort.on("close", () => {
            console.log(`Serial port ${portName} closed`);
            delete activePorts[portName];
        });

        activePorts[portName] = serialPort;
        return serialPort;
    } catch (error) {
        console.error(`Failed to open ${portName}:`, error.message);
        return null;
    }
};

const closePort = (portName) => {
    if (activePorts[portName]) {
        activePorts[portName].close(() => {
            console.log(`Closed ${portName}`);
            delete activePorts[portName];
        });
    }
};

module.exports = { openPort, closePort, activePorts };
