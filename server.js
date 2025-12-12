import express from "express";
import axios from "axios";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import cors from "cors";
import mysql from "mysql2/promise";

const db = await mysql.createPool({
  host: "http://srv684.hstgr.io",
  user: "HA",
  password: "Shreyas@1234%",   // your MySQL password
  database: "HAB_practo"
});

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/* EMAIL VALIDATION */
function isValidEmail(email) {
  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return regex.test(email);
}

/* ZOOM ACCESS TOKEN */
async function getZoomAccessToken() {
  const response = await axios.post(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${process.env.ZOOM_ACCOUNT_ID}`,
    {},
    {
      auth: {
        username: process.env.ZOOM_CLIENT_ID,
        password: process.env.ZOOM_CLIENT_SECRET,
      },
    }
  );

  return response.data.access_token;
}

/* SMTP (GMAIL) */
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

/* CREATE MEETING API */
app.post("/create-meeting", async (req, res) => {
  try {
    const {
      patientName,
      patientEmail,
      patientPhone,
      doctorName,
      doctorEmail,
      companyEmail,
      appointmentDate,
      appointmentTime,
      sessionType,        // Always provided by PaymentModal
      therapyType,        // Hypnotherapy OR Naturopathy
      message,
      transactionId,
    } = req.body;

    /* REQUIRED FIELD VALIDATION */
    if (!patientName) return res.status(400).json({ error: "Patient name missing" });
    if (!patientEmail) return res.status(400).json({ error: "Patient email missing" });
    if (!doctorName) return res.status(400).json({ error: "Doctor name missing" });
    if (!doctorEmail) return res.status(400).json({ error: "Doctor email missing" });
    if (!companyEmail) return res.status(400).json({ error: "Company email missing" });
    if (!appointmentDate) return res.status(400).json({ error: "Appointment date missing" });
    if (!appointmentTime) return res.status(400).json({ error: "Appointment time missing" });
    if (!sessionType || sessionType.trim() === "")
      return res.status(400).json({ error: "Session type missing" });

    /* TRANSACTION VALIDATION */
    if (!transactionId) return res.status(400).json({ error: "Transaction ID missing" });
    if (!/^\d+$/.test(transactionId))
      return res.status(400).json({ error: "Transaction ID must be numeric" });

    /* EMAIL VALIDATION */
    if (!isValidEmail(patientEmail))
      return res.status(400).json({ error: "Invalid patient email" });

    if (!isValidEmail(doctorEmail))
      return res.status(400).json({ error: "Invalid doctor email" });

    if (!isValidEmail(companyEmail))
      return res.status(400).json({ error: "Invalid company email" });

    /* ZOOM MEETING TIME FORMAT */
    const startTime = new Date(
      `${appointmentDate} ${appointmentTime}`
    ).toISOString();

    /* GET ZOOM TOKEN */
    const accessToken = await getZoomAccessToken();

    /* CREATE ZOOM MEETING */
    const meetingRes = await axios.post(
      "https://api.zoom.us/v2/users/me/meetings",
      {
        topic: `${therapyType} Consultation`,
        type: 2,
        start_time: startTime,
        duration: 45,
        timezone: "Asia/Kolkata",
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const meetingLink = meetingRes.data.join_url;

    /* SEND EMAIL TO ALL RECIPIENTS */
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: [patientEmail, doctorEmail, companyEmail],
      subject: `${therapyType} Appointment Confirmation`,
      html: `
        <h2>Appointment Confirmed ✅</h2>

        <h3>Patient Details</h3>
        <p><b>Name:</b> ${patientName}</p>
        <p><b>Email:</b> ${patientEmail}</p>
        <p><b>Phone:</b> ${patientPhone || "Not Provided"}</p>

        <h3>Appointment Details</h3>
        <p><b>Therapy Type:</b> ${therapyType}</p>
        <p><b>Doctor:</b> ${doctorName}</p>
        <p><b>Session Type:</b> ${sessionType}</p>
        <p><b>Date:</b> ${appointmentDate}</p>
        <p><b>Time:</b> ${appointmentTime}</p>

        <h3>Payment Information</h3>
        <p><b>Transaction ID:</b> ${transactionId}</p>

        <h3>Patient Message</h3>
        <p>${message || "No additional message"}</p>

        <h3>Zoom Meeting Link</h3>
        <p><a href="${meetingLink}">${meetingLink}</a></p>
      `,
    });
    await db.query(
  "INSERT INTO booked_slots (appointment_date, appointment_time) VALUES (?, ?)",
  [appointmentDate, appointmentTime]
);


    /* SUCCESS */
    res.json({
      success: true,
      meetingLink,
    });

  } catch (error) {
    console.error("❌ SERVER ERROR:", error.response?.data || error.message);
    res.status(500).json({ error: "Zoom meeting creation failed" });
  }
});
app.post("/get-booked-slots", async (req, res) => {
  try {
    const { date } = req.body;

    if (!date) return res.status(400).json({ error: "Date is required" });

    // Query correct table + correct columns
    const [rows] = await db.query(
      "SELECT appointment_time FROM booked_slots WHERE appointment_date = ?",
      [date]
    );

    const bookedSlots = rows.map((row) => row.appointment_time);

    console.log("BOOKED FROM DB:", bookedSlots);

    res.json({ bookedSlots });

  } catch (err) {
    console.error("Error fetching booked slots:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});



/* START SERVER */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`✅ Server running at https://hsb-black.vercel.app/`)
);
export default app;
