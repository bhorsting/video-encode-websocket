// server_hdr.js
import { spawn } from "child_process";
import WebSocket, { WebSocketServer } from "ws";

const PORT = 8080;

// To support float16 RGBA input from browser, use 'rgba16le' and convert with format filter.
const PIX_FMT = "gbrpf32le"; // planar float32 RGB for HDR

// spawn ffmpeg to read raw RGBA frames from stdin (HDR color space)
const ffmpeg = spawn("ffmpeg", [
    "-y", // Overwrite output file without asking
    "-f", "rawvideo",
    "-pix_fmt", PIX_FMT, // matches client pixel format
    "-s:v", "4096x2048", // must match canvas size
    "-r", "30",        // must match send rate
    "-i", "-",         // stdin
    // Convert float16 RGBA to ProRes HDR
    "-vf", "format=yuva444p10le",
    // ProRes HDR encoding
    "-c:v", "prores_ks",
    "-profile:v", "4", // 4444 XQ (highest quality, supports alpha)
    // HDR metadata
    "-color_primaries", "9", // BT.2020
    "-color_trc", "16", // SMPTE2084 (PQ)
    "-colorspace", "9", // BT.2020nc
    "output_hdr.mov"
]);

ffmpeg.stderr.on("data", data => {
    console.error(data.toString());
});
ffmpeg.on('exit', (code, signal) => {
    console.error(`ffmpeg exited with code ${code}, signal ${signal}`);
});

const wss = new WebSocketServer({ port: PORT });
console.log(`WebSocket listening on ws://localhost:${PORT}`);

// Precompute float16 to float32 lookup table
const float16LUT = new Float32Array(65536);
for (let i = 0; i < 65536; i++) {
    float16LUT[i] = decodeFloat16(i);
}

wss.on("connection", ws => {
    console.log("Client connected");
    ws.on("message", msg => {
        // msg is a raw float16 RGBA frame buffer
        const float16 = new Uint16Array(msg.buffer);
        const numPixels = float16.length / 4;
        // Convert float16 RGBA to planar float32 RGB for ffmpeg using LUT
        const planar = new Float32Array(numPixels * 3);
        for (let i = 0; i < numPixels; i++) {
            // Correct channel order for gbrpf32le: G, B, R
            let r = Math.max(0, float16LUT[float16[i * 4]]);
            let g = Math.max(0, float16LUT[float16[i * 4 + 1]]);
            let b = Math.max(0, float16LUT[float16[i * 4 + 2]]);
            planar[i] = g;
            planar[i + numPixels] = b;
            planar[i + numPixels * 2] = r;
        }

        ffmpeg.stdin.write(Buffer.from(planar.buffer));
    });
    ws.on("close", () => {
        console.log("Client disconnected");
        ffmpeg.stdin.end();
    });
});
// Helper to decode float16 to float32
function decodeFloat16(h) {
    const s = (h & 0x8000) >> 15;
    const e = (h & 0x7C00) >> 10;
    const f = h & 0x03FF;
    if (e === 0) {
        return (s ? -1 : 1) * Math.pow(2, -14) * (f / Math.pow(2, 10));
    } else if (e === 0x1F) {
        return f ? NaN : ((s ? -1 : 1) * Infinity);
    }
    return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / Math.pow(2, 10));
}
