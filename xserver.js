const express = require("express");
const { SerialPort } = require("serialport");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { ReadlineParser } = require("@serialport/parser-readline");
const crc = require("crc");
const mgrs = require('mgrs');
const geohash = require('ngeohash');
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
    if (data.length < 4) return false;
    const message = data.slice(0, -4);
    const receivedCRC = data.slice(-4);
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
        socket.emit("port_opened", { portName });
        if (activePorts[portName]) {
            console.log(`${portName} is already open.`);
            return;
        }
        // dataBits: 8,
        // stopBits: 2,
        // parity: "none",
        // rtscts: true,
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
                    const decodeGeo = geohash.decode(dataGeo);
                    console.log(`decodeGeo = lat:${decodeGeo.latitude} , lon:${decodeGeo.longitude}`);
                    const dataMgrs = mgrs.forward([decodeGeo.longitude, decodeGeo.latitude]); 
                    console.log(`toMgrs :${dataMgrs}`);
                    //sendAck();
                    socket.emit("serial_data", { portName, data: dataMgrs });
                }else {
                    checkCRC(data)
                    socket.emit("serial_data", { portName, data: data.slice(0, -4) });
                    console.log("✅ Data CRC check passed");
                    const ackMessage = "ACK";
                    const ackWithCRC = addCRC(ackMessage)
                        if (!data.includes("ACK")) {
                            activePorts[portName].write(`${ackWithCRC}\n`)
                            console.log("🔵 Send ACK...");
                            //ตอบ ACK ไป websocket
                            socket.emit("ack", { portName });
                        }else {
                    const nackMessage = "NACK";
                    const nackWithCRC = addCRC(nackMessage)
                    if (!data.includes("NACK")) {
                    //ตอบ NACK
                    activePorts[portName].write(`${nackWithCRC}\n`)}
                    console.log("❌ CRC failed, sending NACK");
                    socket.emit("nack", { portName });
                }
            }});

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

    isUploading = {};
    socket.on("send_geo", async ({ portName, message, chunkSize = 96 }) => {
        if (!activePorts[portName]) {
            socket.emit("send_error", { portName, error: "Port not open" });
            return;
        }
        try {
                let latLong;
                try {
                    latLong = mgrs.toPoint(message);
                } catch (error) {
                    console.error("MGRS conversion failed:", error.message);
                    return; // หรือส่งค่า default เช่น null หรือค่าพิกัดเริ่มต้น
                }

                // ใช้งาน latLong ต่อไปถ้าการแปลงสำเร็จ
                if (latLong) {
                    console.log("Converted MGRS to Lat/Lon:", latLong);
                }
        const geohashValue = geohash.encode(latLong[0], latLong[1]);
        console.log(geohashValue);
        const port = activePorts[portName];
        const dataBuffer = Buffer.from(message,"utf-8");
        let sentBytes = 0;
        const totalLength = dataBuffer.length;
        const maxRetries = 3;
        isUploading[portName] = true;

        while (sentBytes < totalLength &&  isUploading[portName]) {
            
            const progress = Math.floor((sentBytes / totalLength) * 100);
            socket.emit("send_progress", { portName, progress, sent: sentBytes, total: totalLength });
            const chunk = dataBuffer.slice(sentBytes, sentBytes + chunkSize).toString();
            const chunkWithCRC = addCRC(chunk);
            let ackReceived = false;
            let retires = 0
            for ( retries = 0; retries < maxRetries; retries++) {
                try {

                    // if (activePorts[portName]) {
                    //     activePorts[portName].write(chunkWithCRC);
                    //     console.log(`Sent to ${portName}: ${chunkWithCRC}`);
                    //   }else {console.log(`cannot sent because port not active`)}
                   await new Promise((resolve, reject) => {
                        port.write(`${geohashValue}|geo\n`, (err) => {
                            console.log(`Try ${retries}`);
                            if (err) {
                                console.log(err);
                                reject(err);
                            } else {
                                console.log(`✅ Sent chunk to ${portName}: ${geohashValue}`);
                                console.log(`⏳ Waiting for ACK...`);
                                resolve();
                            }
                        });
                   });
            
                    socket.emit("send_progress", { portName, sent: sentBytes, total: dataBuffer.length });
                        // รอ ACK พร้อม timeout (5 วินาที)
                        ackReceived = new Promise((resolve) => {
                            pendingAcks[portName] = resolve;
                            console.log(`🟢 Set pendingAcks[${portName}]`);
                        
                            setTimeout(() => {
                                if (pendingAcks[portName]) {
                                    console.warn(`❌ ACK Timeout for ${portName}`); 
                                    delete pendingAcks[portName];
                                    resolve(false);
                                }
                            }, 2000);
                        });
            
                    if (await ackReceived) break; // ถ้าได้รับ ACK ให้ออกจาก loop
                    console.warn(`Retry ${retries + 1}/${maxRetries} for ${portName}`);
                    
                } catch (error) {
                    console.error(`Error sending data: ${error.message}`);
                    if (retries === maxRetries - 1) {
                        socket.emit("send_error", { portName, error: "ACK timeout" });
                        return;
                    }
                }
            }  if (retries === maxRetries) {
                retires = 0;
                socket.emit("send_error", { portName, error: "ACK timeout" });
                console.warn('❌ Stoped send ACK no response! ')
            }

            if (!ackReceived) {
                console.error(`❌ Failed to send chunk after ${maxRetries} retries.`);
                socket.emit("send_error", { portName, error: "ACK timeout" });
                return;
            }

            sentBytes += chunk.length;
        }
    } catch (error) {
        console.error(`Error sending to ${portName}:`, error);
        socket.emit("send_error", { portName, error: error.message });
    } finally {
        isUploading[portName] = false; // รีเซ็ตสถานะเมื่อส่งเสร็จ หรือถูกยกเลิก
    }

        // socket.emit("send_error", { portName, totalSent: sentBytes });
        // console.log(`Completed sending to ${portName}`);
    });


    socket.on("send_data", async ({ portName, message, chunkSize = 96 }) => {
        if (!activePorts[portName]) {
            socket.emit("send_error", { portName, error: "Port not open" });
            return;
        }
        try {
        console.log(message);
        const port = activePorts[portName];
        const dataBuffer = Buffer.from(message,"utf-8");
        let sentBytes = 0;
        const totalLength = dataBuffer.length;
        const maxRetries = 3;
        isUploading[portName] = true;

        while (sentBytes < totalLength &&  isUploading[portName]) {
            
            const progress = Math.floor((sentBytes / totalLength) * 100);
            socket.emit("send_progress", { portName, progress, sent: sentBytes, total: totalLength });

            const chunk = dataBuffer.slice(sentBytes, sentBytes + chunkSize).toString();
            const chunkWithCRC = addCRC(chunk);
            let ackReceived = false;
            let retires = 0
            for ( retries = 0; retries < maxRetries; retries++) {

                //console.log(`for loop : ${chunkWithCRC}`);
                try {

                    // if (activePorts[portName]) {
                    //     activePorts[portName].write(chunkWithCRC);
                    //     console.log(`Sent to ${portName}: ${chunkWithCRC}`);
                    //   }else {console.log(`cannot sent because port not active`)}
                   
                   await new Promise((resolve, reject) => {
                        port.write(chunkWithCRC, (err) => {
                            console.log(`Try ${retries}`);
                            if (err) {
                                console.log(err);
                                reject(err);
                            } else {
                                console.log(`✅ Sent chunk to ${portName}: ${chunkWithCRC}`);
                                console.log(`⏳ Waiting for ACK...`);
                                resolve();
                            }
                        });
                   });
            
                    socket.emit("send_progress", { portName, sent: sentBytes, total: dataBuffer.length });
            
                        // รอ ACK พร้อม timeout (5 วินาที)
                        ackReceived = new Promise((resolve) => {
                            pendingAcks[portName] = resolve;
                            console.log(`🟢 Set pendingAcks[${portName}]`);
                        
                            setTimeout(() => {
                                if (pendingAcks[portName]) {
                                    console.warn(`❌ ACK Timeout for ${portName}`); 
                                    delete pendingAcks[portName];
                                    resolve(false);
                                }
                            }, 2000);
                        });
            
                    if (await ackReceived) break; // ถ้าได้รับ ACK ให้ออกจาก loop
                    console.warn(`Retry ${retries + 1}/${maxRetries} for ${portName}`);
                    
                } catch (error) {
                    console.error(`Error sending data: ${error.message}`);
                    if (retries === maxRetries - 1) {
                        socket.emit("send_error", { portName, error: "ACK timeout" });
                        return;
                    }
                }
            }  if (retries === maxRetries) {
                retires = 0;
                socket.emit("send_error", { portName, error: "ACK timeout" });
                console.warn('❌ Stoped send ACK no response! ')
            }

            if (!ackReceived) {
                console.error(`Failed to send chunk after ${maxRetries} retries.`);
                socket.emit("send_error", { portName, error: "ACK timeout" });
                return;
            }

            sentBytes += chunk.length;
        }
    } catch (error) {
        console.error(`Error sending to ${portName}:`, error);
        socket.emit("send_error", { portName, error: error.message });
    } finally {
        isUploading[portName] = false; // รีเซ็ตสถานะเมื่อส่งเสร็จ หรือถูกยกเลิก
    }

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

        // 📌 ฟังก์ชันสำหรับยกเลิกการส่งข้อมูล
        socket.on("cancel_upload", ({ portName }) => {
      
            if (!portName) {
                console.error("portName is missing in cancel_upload event");
                return;
            }
        
            if (isUploading[portName]) {
                isUploading[portName] = false; // หยุดการอัปโหลด
                socket.emit("send_canceled", { portName });
                console.log(`Upload to ${portName} was canceled by client.`);
            } else {
                console.warn(`No ongoing upload found for ${portName}`);
            }
        });
        
    

    socket.on("disconnect", () => {
        console.log("WebSocket disconnected");
    });

    function sendAck(){
        const ackMessage = "ACK";
        const ackWithCRC = addCRC(ackMessage)
        if (!data.includes("ACK")) {
        activePorts[portName].write(`${ackWithCRC}\n`)
        }
    }
});

// Start server
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
