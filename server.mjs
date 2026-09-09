import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8"
};

// Connected SSE clients for live reload
const clients = new Set();

function broadcastChange(type = "change") {
  for (const res of clients) {
    try {
      res.write(`data: ${JSON.stringify({ type, timestamp: Date.now() })}\n\n`);
    } catch {
      clients.delete(res);
    }
  }
}

// Watch README.md, data/, and assets/ for changes
const watchPaths = [
  path.join(__dirname, "README.md"),
  path.join(__dirname, "data"),
  path.join(__dirname, "assets")
];

for (const wp of watchPaths) {
  if (fs.existsSync(wp)) {
    fs.watch(wp, { recursive: true }, (eventType, filename) => {
      broadcastChange(filename || eventType);
    });
  }
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  // SSE endpoint
  if (pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    res.write(": keepalive\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  // API endpoint to get README markdown
  if (pathname === "/api/readme" && req.method === "GET") {
    try {
      const readmePath = path.join(__dirname, "README.md");
      const content = fs.readFileSync(readmePath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ markdown: content, modified: fs.statSync(readmePath).mtime }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API endpoint to save README markdown
  if (pathname === "/api/readme" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { markdown } = JSON.parse(body);
        if (typeof markdown !== "string") {
          throw new Error("Invalid markdown payload");
        }
        const readmePath = path.join(__dirname, "README.md");
        fs.writeFileSync(readmePath, markdown, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API endpoint for featured projects
  if (pathname === "/api/projects" && req.method === "GET") {
    try {
      const pPath = path.join(__dirname, "data", "featured-projects.json");
      if (fs.existsSync(pPath)) {
        const data = fs.readFileSync(pPath, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(data);
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("[]");
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API endpoint to trigger hero generation script
  if (pathname === "/api/generate-hero" && req.method === "POST") {
    const script = path.join(__dirname, "scripts", "generate-agent-hero.mjs");
    exec(`node "${script}"`, (error, stdout, stderr) => {
      if (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message, stderr }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, stdout }));
      }
    });
    return;
  }

  // Static files handling
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, "");
  if (safePath === "/" || safePath === "\\") {
    safePath = "/public/index.html";
  }

  // Check if file is in public/ or directly in root (like assets/)
  let filePath = path.join(__dirname, safePath);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, "public", safePath);
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": "no-cache"
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found: " + pathname);
});

server.listen(PORT, () => {
  console.log(`Preview server running at http://localhost:${PORT}`);
});
