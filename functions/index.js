
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const twilio = require("twilio");

admin.initializeApp();

const client = twilio(
  functions.config().twilio.sid,
  functions.config().twilio.token
);

exports.sendEmergencySMS = functions.firestore
  .document("alerts/{alertId}")
  .onCreate(async (snap) => {
    const alert = snap.data();

    // Only send SMS for SOS or dangerous gas levels
    if (alert.type !== "SOS" && alert.gasLevel <= 100) return null;

    const message = `🚨 SMC EMERGENCY ALERT
Worker: ${alert.workerName || "Unknown"}
Zone: ${alert.zone || "Unknown"}
Type: ${alert.type}
Gas Level: ${alert.gasLevel ?? "N/A"}
Heart Rate: ${alert.heartRate ?? "N/A"}
Time: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
Location: Solapur Municipal Corporation`;

    try {
      await client.messages.create({
        body: message,
        from: functions.config().twilio.from,
        to: functions.config().twilio.to, // manager's number
      });
      console.log("✅ Emergency SMS sent!");
    } catch (err) {
      console.error("❌ SMS failed:", err);
    }

    return null;
  });