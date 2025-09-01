// server.js
import { spawn, exec } from "child_process";
import WebSocket, { WebSocketServer } from "ws";
import http from "http";
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import express from "express";
import mime from "mime-types";

const PORT = 8080;
const HTTP_PORT = 8081;

// Configure MIME types for AVIF
mime.types['avif'] = 'image/avif';

// Kill any existing process on port 8080
function killExistingProcess(port) {
    return new Promise((resolve) => {
        exec(`lsof -ti:${port}`, (err, stdout) => {
            if (stdout.trim()) {
                const pids = stdout.trim().split('\n');
                pids.forEach(pid => {
                    exec(`kill -9 ${pid}`, () => {});
                });
                console.log(`Killed existing processes on port ${port}: ${pids.join(', ')}`);
                setTimeout(resolve, 1000); // Wait a second for cleanup
            } else {
                resolve();
            }
        });
    });
}

// Start servers after killing existing processes
async function startServers() {
    await killExistingProcess(PORT);

    // spawn ffmpeg to read raw RGBA frames from stdin
    const ffmpeg = spawn("ffmpeg", [
        "-y", // Overwrite output file without asking
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

    const app = express();

    // Serve images statically from /images with proper MIME types
    app.use("/images", express.static(path.join(process.cwd(), "images"), {
        setHeaders: (res, path) => {
            if (path.endsWith('.avif')) {
                res.setHeader('Content-Type', 'image/avif');
            }
        }
    }));

    // Serve index.html at root
    app.get("/", (req, res) => {
        res.sendFile(path.join(process.cwd(), "index.html"));
    });

    app.listen(HTTP_PORT, async () => {
        console.log(`Express server listening on http://localhost:${HTTP_PORT}/`);
        // Launch Chrome with Puppeteer with comprehensive flags for localhost development
        const browser = await puppeteer.launch({
            headless: false,
            args: [
                "--enable-experimental-web-platform-features",
                "--allow-running-insecure-content",
                "--disable-web-security",
                "--disable-features=VizDisplayCompositor",
                "--unsafely-treat-insecure-origin-as-secure=http://localhost:8080,http://localhost:8081",
                "--ignore-certificate-errors",
                "--ignore-ssl-errors",
                "--ignore-certificate-errors-spki-list",
                "--allow-insecure-localhost",
                "--reduce-security-for-testing",
                "--window-size=4096,2048"
            ]
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 4096, height: 2048 });
        await page.goto(`http://localhost:${HTTP_PORT}/`);
    });
}

startServers();
