// server.js
import { spawn } from "child_process";
import WebSocket, { WebSocketServer } from "ws";

const PORT = 8080;

// spawn ffmpeg to read raw RGBA frames from stdin
const ffmpeg = spawn("ffmpeg", [
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-s:v", "4096x2048", // must match canvas size
    "-r", "30",        // must match send rate
    "-i", "-",         // stdin
    // ProRes encoding, compatible with 8-bit RGBA input
    "-c:v", "prores_ks",
    "-profile:v", "4", // 4444 XQ (highest quality, supports alpha)
    "-pix_fmt", "yuva444p", // 8-bit with alpha, matches browser RGBA
    // Basic HDR metadata (remove if errors persist)
    "-color_primaries", "9", // BT.2020
    "-color_trc", "16", // SMPTE2084 (PQ)
    "-colorspace", "9", // BT.2020nc
    "output.mov"
]);

ffmpeg.stderr.on("data", data => {
    console.error(data.toString());
});

const wss = new WebSocketServer({ port: PORT });
console.log(`WebSocket listening on ws://localhost:${PORT}`);

wss.on("connection", ws => {
    console.log("Client connected");
    ws.on("message", msg => {
        // msg is a raw RGBA frame buffer
        ffmpeg.stdin.write(msg);
    });
    ws.on("close", () => {
        console.log("Client disconnected");
        ffmpeg.stdin.end();
    });
});
