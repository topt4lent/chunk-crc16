const { addCRC, checkCRC } = require("../utils/crc");
const { encodeGeo, decodeGeo, toMgrs } = require("../utils/geolocation");
const { openPort, closePort, activePorts } = require("../serial/serialPortManager");
const {SerialPort}= require("serialport");

module.exports = function (socket){
    console.log("websoscket Connected");
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
        const serialPort = openPort(portName, baudRate);
        if (serialPort) {
            socket.emit("port_opened", { portName });
        } else {
            socket.emit("port_error", { portName, error: "Failed to open port" });
        }
    });

    socket.on("close_port", (portName) => {
        closePort(portName);
        socket.emit("port_closed", { portName });
    });

    // Other socket event handlers for sending data, processing CRC, etc.
};


