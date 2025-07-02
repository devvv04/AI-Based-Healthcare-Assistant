import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import serviceAccount from './serviceAccountKey.json' assert { type: 'json' };
import axios from 'axios';

// Initialize Express
const app = express();
app.use(cors());
app.use(express.json());

// Firebase Admin SDK (for secure server operations)
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
});

// Middleware to verify Firebase ID token
async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send('Unauthorized');
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.userId = decodedToken.uid;
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    res.status(401).send('Unauthorized');
  }
}

// Routes
app.post('/diagnose', authenticateToken, async (req, res) => {
  try {
    const { symptoms } = req.body;
    console.log('Received symptoms:', symptoms);
    const userId = req.userId;

    // Ensure symptoms is an array
    let symptomsArray = symptoms;
    if (typeof symptoms === 'string') {
      symptomsArray = symptoms.split(',').map(s => s.trim());
    }
    console.log('Symptoms array to send:', symptomsArray);

    // Call ML API for prediction
    const response = await axios.post('http://localhost:8000/predict', {
      symptoms: symptomsArray
    });
    console.log('ML API response:', response.data);

    const result = {
      prediction: response.data.prediction,
      confidence: response.data.confidence,
      timestamp: new Date().toISOString()
    };

    // Add near your other routes
    const predictionRoutes = require('./routes/prediction');
    app.use('/api/prediction', predictionRoutes);

    // Save to Firestore
    await admin.firestore()
      .collection('diagnoses')
      .doc(userId)
      .collection('history')
      .add(result);

    res.json(result);
  } catch (error) {
    console.error('Diagnosis error:', error);

    // Check if error response from ML API exists and send detailed error
    if (error.response && error.response.data) {
      const errorMessage = error.response.data.detail || error.response.data.error || 'Diagnosis failed';
      res.status(error.response.status || 500).json({ error: errorMessage });
    } else {
      res.status(500).json({ error: 'Diagnosis failed' });
    }
  }
});

app.post('/chatbot', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Simple rule-based chatbot responses
    const lowerMessage = message.toLowerCase();

    let botResponse = "Sorry, I don't understand that. Can you please rephrase?";

    if (lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
      botResponse = 'Hello! How can I assist you with your health today?';
    } else if (lowerMessage.includes('fever')) {
      botResponse = 'If you have a fever, make sure to stay hydrated and rest. If it persists, consider seeing a doctor.';
    } else if (lowerMessage.includes('headache')) {
      botResponse = 'For headaches, try to rest in a quiet, dark room and stay hydrated.';
    } else if (lowerMessage.includes('thank')) {
      botResponse = "You're welcome! Let me know if you have any other questions.";
    }

    res.json({ response: botResponse });
  } catch (error) {
    console.error('Chatbot error:', error);
    res.status(500).json({ error: 'Chatbot failed' });
  }
});

// Get diagnosis history
app.get('/history/diagnoses', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const snapshot = await admin.firestore()
      .collection('diagnoses')
      .doc(userId)
      .collection('history')
      .orderBy('timestamp', 'desc')
      .get();

    const diagnoses = snapshot.docs.map(doc => doc.data());
    res.json(diagnoses);
  } catch (error) {
    console.error('Failed to fetch diagnosis history:', error);
    res.status(500).send('Failed to fetch diagnosis history');
  }
});

// Get appointment history
app.get('/history/appointments', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const snapshot = await admin.firestore()
      .collection('appointments')
      .doc(userId)
      .collection('history')
      .orderBy('date', 'desc')
      .get();

    const appointments = snapshot.docs.map(doc => doc.data());
    res.json(appointments);
  } catch (error) {
    console.error('Failed to fetch appointment history:', error);
    res.status(500).send('Failed to fetch appointment history');
  }
});

// Save appointment
app.post('/appointments', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const appointmentData = req.body;

    console.log('Saving appointment for user:', userId, 'Data:', appointmentData);

    if (!appointmentData.date || !appointmentData.time) {
      return res.status(400).json({ error: 'Date and time are required' });
    }

    // Validate doctor field presence
    if (!appointmentData.doctor) {
      return res.status(400).json({ error: 'Doctor selection is required' });
    }

    await admin.firestore()
      .collection('appointments')
      .doc(userId)
      .collection('history')
      .add({
        ...appointmentData,
        timestamp: new Date().toISOString()
      });

    // Also save appointment under doctor's collection for doctor to know
    const doctorName = appointmentData.doctor;
    await admin.firestore()
      .collection('doctors')
      .doc(doctorName)
      .collection('appointments')
      .add({
        userId,
        ...appointmentData,
        timestamp: new Date().toISOString()
      });

    console.log('Appointment saved successfully for user:', userId);

    res.status(201).json({ message: 'Appointment saved successfully' });
  } catch (error) {
    console.error('Failed to save appointment:', error);
    res.status(500).send('Failed to save appointment');
  }
});

// Admin: Get all appointments
app.get('/admin/appointments', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;

    // Simple admin check: replace with your admin user ID or email
    const adminUserId = 'your-admin-user-id-or-email';
    if (userId !== adminUserId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const appointmentsSnapshot = await admin.firestore()
      .collection('appointments')
      .get();

    const allAppointments = [];

    for (const doc of appointmentsSnapshot.docs) {
      const userAppointmentsSnapshot = await doc.ref.collection('history').get();
      userAppointmentsSnapshot.forEach((appointmentDoc) => {
        allAppointments.push({
          userId: doc.id,
          appointmentId: appointmentDoc.id,
          ...appointmentDoc.data(),
        });
      });
    }

    res.json(allAppointments);
  } catch (error) {
    console.error('Failed to fetch all appointments:', error);
    res.status(500).send('Failed to fetch all appointments');
  }
});

// Simple GET route for /appointments to clarify usage
app.get('/appointments', (req, res) => {
  res.status(200).json({ message: 'Use POST /appointments to save an appointment or GET /history/appointments to fetch your appointments.' });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
