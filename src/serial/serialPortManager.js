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
           console.log(`Received from ${portName}: ${data}`);
                           //ถ้าเป็น ACK ไม่ต้อง ตอบ
                           if (data.trim() === "ACK") {
                               console.log("✅ Received ACK!");
                               if (pendingAcks[portName]) {
                                   console.log("🔵 Resolving pending ACK...");
                                   pendingAcks[portName](true);
                                   delete pendingAcks[portName];
                               }
                               return;
                           }
                           if (data.includes('|geo')){
                               const dataGeo = data.slice(0, -4);
                               console.log(`dataGeo:${dataGeo}`)
                               const decodeGeo = geohash.decode(decodeGeo);
                               console.log(`decodeGeo = lat:${decodeGeo.latitude} , lon:${decodeGeo.longitude}`);
                               const dataMgrs = mgrs.forward([decodeGeo.longitude, decodeGeo.latitude]); 
                               console.log(`toMgrs :${dataMgrs}`);
                               sendAck();
                               socket.emit("serial_data", { portName, data: dataMgrs });
                           }else if (checkCRC(data)) {
                               socket.emit("serial_data", { portName, data: data.slice(0, -4) });
                               console.log("✅ Data CRC check passed");
                               const ackMessage = "ACK";
                               const ackWithCRC = addCRC(ackMessage)
                                   if (!data.includes("ACK")) {
                                       activePorts[portName].write(`${ackWithCRC}\n`)
                                       console.log("🔵 Send ACK...");
                                       //ตอบ ACK ไป websocket
                                       socket.emit("ack", { portName });
                                   }  
                           } else {
                               const nackMessage = "NACK";
                               const nackWithCRC = addCRC(nackMessage)
                               if (!data.includes("NACK")) {
                               //ตอบ NACK
                               activePorts[portName].write(`${nackWithCRC}\n`)}
                               console.log("❌ CRC failed, sending NACK");
                               socket.emit("nack", { portName });
                           }
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
