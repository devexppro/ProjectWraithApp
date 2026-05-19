import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import axios from "axios";
import session from "express-session";
import cookieParser from "cookie-parser";

dotenv.config();

/**
 * Project Wraith - Stealth AI Command Interface
 * Server Entry Point - STABLE BUILD 1.0.4
 */

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());
  
  // Configure session for AI Studio Iframe
  // Must use SameSite: 'none' and Secure: true for cross-origin stability
  app.use(session({
    secret: process.env.SESSION_SECRET || "wraith-stealth-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,      // Required for SameSite=None
      sameSite: 'none',  // Required for cross-origin iframe
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));

  // --- DISCORD OAUTH CONFIGURATION ---

  const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
  
  // FIXED: Hardcoded to match your Discord Dashboard Redirect URI
  const REDIRECT_URI = "https://wraith-test5.run.app/auth/callback";

  app.get("/api/auth/discord/url", (req, res) => {
    if (!DISCORD_CLIENT_ID) {
      return res.status(500).json({ error: "DISCORD_CLIENT_ID not configured" });
    }

    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "identify email",
    });

    const authUrl = `https://discord.com/api/oauth2/authorize?${params}`;
    res.json({ url: authUrl });
  });

  app.get(["/auth/callback", "/auth/callback/"], async (req, res) => {
    const { code } = req.query;
    
    if (!code) {
      return res.status(400).send("No code provided");
    }

    try {
      // 1. Exchange code for token
      const tokenResponse = await axios.post(
        "https://discord.com/api/oauth2/token",
        new URLSearchParams({
          client_id: DISCORD_CLIENT_ID!,
          client_secret: DISCORD_CLIENT_SECRET!,
          grant_type: "authorization_code",
          code: code as string,
          redirect_uri: REDIRECT_URI,
        }).toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      const { access_token } = tokenResponse.data;

      // 2. Fetch user profile
      const userResponse = await axios.get("https://discord.com/api/users/@me", {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      });

      const discordUser = userResponse.data;
      
      // Store user in session
      // @ts-ignore
      req.session.user = {
        id: discordUser.id,
        username: discordUser.username,
        avatar: discordUser.avatar,
        discriminator: discordUser.discriminator,
        email: discordUser.email,
        avatarUrl: discordUser.avatar 
          ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/${parseInt(discordUser.discriminator) % 5}.png`
      };

      // Send success message to window.opener and close
      res.send(`
        <html>
          <body style="background: #030014; color: white; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh;">
            <div style="text-align: center;">
              <h2 style="background: linear-gradient(90deg, #5865F2, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: bold;">AUTHENTICATION SUCCESSFUL</h2>
              <p style="color: #888;">Synchronizing with Wraith Core...</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                  window.close();
                } else {
                  window.location.href = '/';
                }
              </script>
            </div>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error("Discord Auth Error:", error.response?.data || error.message);
      res.status(500).send("Authentication failed");
    }
  });

  app.get("/api/auth/me", (req, res) => {
    // @ts-ignore
    res.json(req.session.user || null);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  // --- GEMINI API PROXY ---

  app.post("/api/chat", async (req, res) => {
    try {
      const { message } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
      }

      // FIXED: New SDK Initialization Syntax
      // @ts-ignore
      const genAI = new GoogleGenAI(apiKey);
      // @ts-ignore
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const result = await model.generateContent(message);
      const response = await result.response;
      const text = response.text();

      res.json({ text });
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- TACTICAL DATA ENDPOINTS ---
  
  app.get("/api/tactical", (req, res) => {
    res.json({
      timestamp: new Date().toISOString(),
      threatLevel: "Low",
      activeAgents: 12,
      gridStatus: "Operational",
      nodes: [
        { id: "NZ-01", status: "Active", load: 24 },
        { id: "EU-04", status: "Standby", load: 12 },
        { id: "US-09", status: "Active", load: 88 },
      ]
    });
  });

  // --- STATIC ASSET SERVING ---

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Project Wraith] Core active at http://localhost:${PORT}`);
    console.log(`[AUTH] Force-using Redirect URI: ${REDIRECT_URI}`);
  });
}

startServer();