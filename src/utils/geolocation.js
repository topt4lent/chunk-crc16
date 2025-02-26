const mgrs = require('mgrs');
const geohash = require('ngeohash');

const encodeGeo = (lat, lon) => geohash.encode(lat, lon);
const decodeGeo = (geo) => geohash.decode(geo);
const toMgrs = (lat, lon) => mgrs.forward([lon, lat]);

module.exports = { encodeGeo, decodeGeo, toMgrs };
