const crc = require("crc");

const addCRC = (chunk) => {
    const checksum = crc.crc16ccitt(chunk).toString(16).padStart(4, "0");
    return `${chunk}${checksum}\n`;
};

const checkCRC = (data) => {
    if (data.length < 4) return false;
    const message = data.slice(0, -4);
    const receivedCRC = data.slice(-4);
    const calculatedCRC = crc.crc16ccitt(message).toString(16).padStart(4, "0");
    return receivedCRC === calculatedCRC;
};

module.exports = { addCRC, checkCRC };
