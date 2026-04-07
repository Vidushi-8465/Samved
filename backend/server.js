import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";
import twilio from "twilio";
dotenv.config();

const twilioSid = process.env.TWILIO_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhone = process.env.TWILIO_PHONE;
const defaultRecipient = process.env.MY_PHONE;

const client = twilio(twilioSid, twilioAuthToken);

const app = express();
app.use(cors());
app.use(express.json());

app.post("/ai-analysis", async (req, res) => {
  try {
    const { prompt } = req.body;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const data = await response.json();

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response";

    res.json({ result: text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI failed" });
  }
});

app.post("/send-alert", async (req, res) => {
  try {
    const { message, recipients = [], alertType, workerName, zone, alertId } = req.body || {};

    if (!twilioSid || !twilioAuthToken || !twilioPhone) {
      return res.status(500).json({ success: false, error: "Twilio is not configured" });
    }

    const fallbackMessage = [
      "SMC LiveMonitor emergency alert",
      `Type: ${alertType || "UNKNOWN"}`,
      `Worker: ${workerName || "Unknown"}`,
      `Zone: ${zone || "Unknown"}`,
      alertId ? `Alert ID: ${alertId}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const smsBody = typeof message === "string" && message.trim().length > 0 ? message.trim() : fallbackMessage;
    const destinationNumbers = Array.from(new Set([defaultRecipient, ...recipients].filter(Boolean)));

    if (destinationNumbers.length === 0) {
      return res.status(400).json({ success: false, error: "No recipients configured" });
    }

    const results = await Promise.all(
      destinationNumbers.map((to) =>
        client.messages.create({
          body: smsBody,
          from: twilioPhone,
          to,
        })
      )
    );

    res.json({ success: true, sentTo: destinationNumbers.length, sids: results.map((result) => result.sid) });
  } catch (error) {
    console.error("Twilio Error:", error);
    res.status(500).json({ success: false, error: "SMS failed" });
  }
});

app.listen(5000, () => {
  console.log("✅ Backend running on http://localhost:5000");
}); 